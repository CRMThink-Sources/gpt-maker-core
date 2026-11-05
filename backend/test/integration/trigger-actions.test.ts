import type { TemplateContext } from '@gptmaker/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BitrixClient } from '../../src/modules/bitrix/bitrix.client';
import { ActionError } from '../../src/modules/triggers/actions/action-error';
import type { ActionRotation } from '../../src/modules/triggers/actions/action-rotation';
import {
  type ActionContext,
  type ExecutableAction,
  TriggerActionExecutor,
} from '../../src/modules/triggers/actions/action-executor';
import { signPayload } from '../../src/modules/triggers/actions/outbound-webhook';
import { WireMock } from '../support/wiremock';

const rest = (method: string) => `/rest/${method}.json`;

// Ações dos gatilhos no portal (spec agent-triggers), WireMock no papel do Bitrix24.
describe('ações dos gatilhos', () => {
  let wiremock: WireMock;
  let executor: TriggerActionExecutor;

  const template: TemplateContext = {
    contact: { name: 'Maria', phone: '+55 11 99999-0000' },
    message: { text: 'Quero um orçamento', role: 'user' },
    agent: { id: 'a1', name: 'Ana' },
    event: { name: 'onFinishInteraction', date: '2026-10-01T17:26:56.376Z' },
    dialog: { id: 'chat9498' },
    interaction: { id: 'I1', protocol: '1005' },
    payload: { channel: 'API' },
  };
  const context = (overrides: Partial<ActionContext> = {}): ActionContext => ({
    installationId: 77,
    agentEventId: 'ev-1',
    dialogId: 'chat9498',
    template,
    ...overrides,
  });
  const action = (input: Omit<ExecutableAction, 'id' | 'secret'>, secret: string | null = null) =>
    ({ id: 'act-1', secret, ...input }) as ExecutableAction;

  async function stub(method: string, result: unknown, status = 200) {
    await wiremock.stub({
      request: { method: 'POST', urlPath: rest(method) },
      response:
        status === 200
          ? { status, jsonBody: { result } }
          : { status, jsonBody: { error: String(result), error_description: 'x' } },
    });
  }
  const stubBinding = (entityData2: string) =>
    stub('imopenlines.dialog.get', { dialog_id: 'chat9498', entity_data_2: entityData2 });
  const bodies = (method: string) =>
    wiremock.bodies('POST', rest(method)) as Promise<Array<Record<string, unknown>>>;

  beforeAll(async () => {
    wiremock = await WireMock.start();
    const bitrix = new BitrixClient(
      {
        get: async () => ({
          accessToken: 'portal-token',
          expiresAt: new Date(Date.now() + 3_600_000),
          endpoint: `${wiremock.baseUrl}/rest/`,
        }),
        refresh: async () => {
          throw new Error('não esperado');
        },
      },
      { timeoutMs: 5000, maxAttempts: 1, acquire: async () => {} },
    );
    // Rodízio em memória: a contagem no Redis tem teste próprio (action-rotation.test.ts).
    const turns = new Map<string, number>();
    const rotation = {
      next: async (actionId: string, ids: readonly number[]) => {
        const turn = turns.get(actionId) ?? 0;
        turns.set(actionId, turn + 1);
        return ids[turn % ids.length]!;
      },
    } as ActionRotation;
    executor = new TriggerActionExecutor(bitrix, rotation);
  }, 180_000);

  beforeEach(async () => {
    await wiremock.reset();
  });

  afterAll(async () => {
    await wiremock?.stop();
  });

  it('cria lead com os templates resolvidos e telefone no formato do CRM', async () => {
    await stub('crm.lead.add', 321);
    const result = await executor.execute(
      action({
        type: 'CREATE_LEAD',
        config: {
          fields: {
            TITLE: 'Lead de {{contact.name}}',
            NAME: '{{contact.name}}',
            PHONE: '{{contact.phone}}',
            COMMENTS: '{{message.text}}',
            EMAIL: '{{payload.email}}',
          },
        },
      }),
      context(),
    );
    expect(result).toEqual({ leadId: 321 });
    expect(await bodies('crm.lead.add')).toMatchObject([
      {
        fields: {
          TITLE: 'Lead de Maria',
          NAME: 'Maria',
          PHONE: [{ VALUE: '+55 11 99999-0000', VALUE_TYPE: 'WORK' }],
          COMMENTS: 'Quero um orçamento',
        },
        params: { REGISTER_SONET_EVENT: 'Y' },
      },
    ]);
    // Campo que ficou vazio não vai.
    expect((await bodies('crm.lead.add'))[0]!.fields).not.toHaveProperty('EMAIL');
  });

  describe('negócio', () => {
    const deal = action({
      type: 'UPSERT_DEAL',
      config: {
        categoryId: 3,
        stageId: 'C3:NEW',
        fields: { TITLE: 'Negócio de {{contact.name}}' },
      },
    });

    it('diálogo sem negócio: cria no funil e etapa, vinculado ao contato', async () => {
      await stubBinding('LEAD|0|COMPANY|0|CONTACT|31|DEAL|0');
      await stub('crm.deal.add', 88);
      await expect(executor.execute(deal, context())).resolves.toEqual({
        dealId: 88,
        created: true,
      });
      expect(await bodies('imopenlines.dialog.get')).toMatchObject([{ DIALOG_ID: 'chat9498' }]);
      expect(await bodies('crm.deal.add')).toMatchObject([
        {
          fields: { TITLE: 'Negócio de Maria', CATEGORY_ID: 3, STAGE_ID: 'C3:NEW', CONTACT_ID: 31 },
        },
      ]);
    });

    it('diálogo com negócio: atualiza etapa e campos', async () => {
      await stubBinding('LEAD|0|COMPANY|0|CONTACT|31|DEAL|88');
      await stub('crm.deal.update', true);
      await expect(executor.execute(deal, context())).resolves.toEqual({
        dealId: 88,
        created: false,
      });
      expect(await bodies('crm.deal.update')).toMatchObject([
        { id: 88, fields: { TITLE: 'Negócio de Maria', STAGE_ID: 'C3:NEW' } },
      ]);
      expect(await wiremock.count('POST', rest('crm.deal.add'))).toBe(0);
    });
  });

  it('comentário na timeline da entidade do diálogo (negócio antes de lead)', async () => {
    await stubBinding('LEAD|5|COMPANY|0|CONTACT|0|DEAL|88');
    await stub('crm.timeline.comment.add', 55);
    await expect(
      executor.execute(
        action({ type: 'TIMELINE_COMMENT', config: { text: 'Atendido por {{agent.name}}' } }),
        context(),
      ),
    ).resolves.toEqual({ commentId: 55, entityType: 'deal', entityId: 88 });
    expect(await bodies('crm.timeline.comment.add')).toMatchObject([
      { fields: { ENTITY_ID: 88, ENTITY_TYPE: 'deal', COMMENT: 'Atendido por Ana' } },
    ]);
  });

  it('diálogo sem entidade no CRM ou evento sem diálogo: falha definitiva', async () => {
    await stubBinding('LEAD|0|COMPANY|0|CONTACT|0|DEAL|0');
    const comment = action({ type: 'TIMELINE_COMMENT', config: { text: 'x' } });
    await expect(executor.execute(comment, context())).rejects.toMatchObject({
      transient: false,
      message: 'diálogo sem entidade vinculada no CRM',
    });
    await expect(executor.execute(comment, context({ dialogId: null }))).rejects.toMatchObject({
      transient: false,
      message: 'evento sem diálogo da Linha Aberta',
    });
  });

  it('tarefa vinculada à entidade do diálogo, com prazo', async () => {
    await stubBinding('LEAD|5|COMPANY|0|CONTACT|0|DEAL|0');
    await stub('tasks.task.add', { task: { id: '901' } });
    const before = Date.now();
    await expect(
      executor.execute(
        action({
          type: 'CREATE_TASK',
          config: {
            title: 'Retornar para {{contact.name}}',
            description: 'Pediu: {{message.text}}',
            responsibleId: 12,
            deadlineDays: 2,
          },
        }),
        context(),
      ),
    ).resolves.toEqual({ taskId: 901 });
    const [sent] = await bodies('tasks.task.add');
    expect(sent).toMatchObject({
      fields: {
        TITLE: 'Retornar para Maria',
        DESCRIPTION: 'Pediu: Quero um orçamento',
        RESPONSIBLE_ID: 12,
        UF_CRM_TASK: ['L_5'],
      },
    });
    const deadline = Date.parse((sent!.fields as { DEADLINE: string }).DEADLINE);
    expect(deadline - before).toBeGreaterThanOrEqual(2 * 86_400_000 - 1000);
  });

  it('tarefa com vários responsáveis: um por vez, em rodízio (D15)', async () => {
    await stub('tasks.task.add', { task: { id: 903 } });
    const task = action({
      type: 'CREATE_TASK',
      config: { title: 'x', responsibleId: [4, 6] },
    } as Omit<ExecutableAction, 'id' | 'secret'>);
    await executor.execute({ ...task, id: 'rodizio' }, context({ dialogId: null }));
    await executor.execute({ ...task, id: 'rodizio' }, context({ dialogId: null }));
    expect((await bodies('tasks.task.add')).map((body) => body.fields)).toMatchObject([
      { RESPONSIBLE_ID: 4 },
      { RESPONSIBLE_ID: 6 },
    ]);
  });

  it('tarefa sem diálogo: sem vínculo, sem consultar o CRM', async () => {
    await stub('tasks.task.add', { task: { id: 902 } });
    await executor.execute(
      action({ type: 'CREATE_TASK', config: { title: 'x', responsibleId: 1 } }),
      context({ dialogId: null }),
    );
    expect(await wiremock.count('POST', rest('imopenlines.dialog.get'))).toBe(0);
    expect((await bodies('tasks.task.add'))[0]!.fields).not.toHaveProperty('UF_CRM_TASK');
  });

  it('business process no documento do tipo configurado', async () => {
    await stubBinding('LEAD|5|COMPANY|0|CONTACT|0|DEAL|88');
    await stub('bizproc.workflow.start', '66e81a641752f8.56521481');
    await expect(
      executor.execute(
        action({
          type: 'START_BIZPROC',
          config: {
            templateId: 4,
            documentType: 'LEAD',
            parameters: { Cliente: '{{contact.name}}' },
          },
        }),
        context(),
      ),
    ).resolves.toEqual({ workflowId: '66e81a641752f8.56521481', entityType: 'lead', entityId: 5 });
    expect(await bodies('bizproc.workflow.start')).toMatchObject([
      {
        TEMPLATE_ID: 4,
        DOCUMENT_ID: ['crm', 'CCrmDocumentLead', 'LEAD_5'],
        PARAMETERS: { Cliente: 'Maria' },
      },
    ]);
  });

  it('business process sem a entidade daquele tipo: falha definitiva', async () => {
    await stubBinding('LEAD|5|COMPANY|0|CONTACT|0|DEAL|0');
    await expect(
      executor.execute(
        action({ type: 'START_BIZPROC', config: { templateId: 4, documentType: 'DEAL' } }),
        context(),
      ),
    ).rejects.toMatchObject({ transient: false, message: 'diálogo sem DEAL vinculado no CRM' });
  });

  it('erros do Bitrix: fora do ar tenta de novo, recusa não', async () => {
    await stub('crm.lead.add', 'INTERNAL', 503);
    const lead = action({ type: 'CREATE_LEAD', config: { fields: { TITLE: 'x' } } });
    const unavailable = await executor.execute(lead, context()).catch((e: unknown) => e);
    expect(unavailable).toBeInstanceOf(ActionError);
    expect((unavailable as ActionError).transient).toBe(true);

    await wiremock.reset();
    await stub('crm.lead.add', 'ACCESS_DENIED', 400);
    const denied = await executor.execute(lead, context()).catch((e: unknown) => e);
    expect((denied as ActionError).transient).toBe(false);
  });

  it('webhook de saída: corpo com o evento e assinatura do segredo da ação', async () => {
    const calls: Array<{ body: string; headers: Record<string, string> }> = [];
    executor.webhookDeps = {
      resolve: async () => ['93.184.216.34'],
      now: () => 1_700_000_000_000,
      fetchFn: (async (_url: URL, init: RequestInit) => {
        calls.push({ body: String(init.body), headers: init.headers as Record<string, string> });
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch,
    };
    await expect(
      executor.execute(
        action({ type: 'OUTBOUND_WEBHOOK', config: { url: 'https://hooks.exemplo.com/a' } }, 'seg'),
        context(),
      ),
    ).resolves.toEqual({ status: 200 });

    const body = JSON.parse(calls[0]!.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      event: 'onFinishInteraction',
      agentEventId: 'ev-1',
      dialogId: 'chat9498',
      contact: { name: 'Maria' },
      payload: { channel: 'API' },
    });
    expect(calls[0]!.headers['X-GPTMaker-Signature']).toBe(
      signPayload('seg', calls[0]!.body, 1_700_000_000),
    );
  });
  describe('item de SPA', () => {
    const fieldsMeta = {
      fields: {
        title: { type: 'string' },
        ufCrm136_1: { type: 'string' },
        ufCrm136_2: {
          type: 'enumeration',
          items: [
            { ID: '101', VALUE: 'LOW' },
            { ID: '102', VALUE: 'Normal' },
            { ID: '103', VALUE: 'Alta' },
          ],
        },
        ufCrm136_3: { type: 'string' },
        ufCrm136_4: { type: 'string' },
        ufCrm136_5: { type: 'string' },
      },
    };
    const spa = (overrides: Record<string, unknown> = {}) =>
      action({
        type: 'CREATE_SPA_ITEM',
        config: {
          entityTypeId: 1204,
          categoryId: 180,
          stageId: 'DT1204_180:NEW',
          title: 'Chamado de {{contact.name}}',
          fields: {
            ufCrm136_1: 'CHAT',
            ufCrm136_2: '{{fields.prioridade}}',
            ufCrm136_3: '{{dialog.chatId}}',
            ufCrm136_4: '{{dialog.id}}',
            ufCrm136_5: '{{dialog.sessionId}}',
          },
          lists: { ufCrm136_2: { HIGH: 103 } },
          ...overrides,
        },
      });
    const spaContext = (prioridade: string) =>
      context({
        template: {
          ...template,
          dialog: { id: 'chat9498', chatId: '9498' },
          fields: { prioridade },
        },
      });

    it('cria no funil e etapa, lista pela ligação do formulário, chat e sessão', async () => {
      await stub('imopenlines.dialog.get', {
        dialog_id: 'chat9498',
        entity_data_1: 'Y|DEAL|39808|N|N|2008|1793305311|0|0|0',
        entity_data_2: 'LEAD|0|COMPANY|0|CONTACT|0|DEAL|39808',
      });
      await stub('crm.item.fields', fieldsMeta);
      await stub('crm.item.add', { item: { id: 55 } });
      await expect(executor.execute(spa(), spaContext('HIGH'))).resolves.toEqual({
        itemId: 55,
        entityTypeId: 1204,
      });
      expect(await bodies('crm.item.fields')).toMatchObject([{ entityTypeId: 1204 }]);
      expect(await bodies('crm.item.add')).toMatchObject([
        {
          entityTypeId: 1204,
          fields: {
            title: 'Chamado de Maria',
            categoryId: 180,
            stageId: 'DT1204_180:NEW',
            ufCrm136_1: 'CHAT',
            ufCrm136_2: 103,
            ufCrm136_3: '9498',
            ufCrm136_4: 'chat9498',
            ufCrm136_5: '2008',
          },
        },
      ]);
    });

    it('lista pelo valor do item, sem diferenciar maiúsculas; sem sessão citada, não lê o diálogo', async () => {
      await stub('crm.item.fields', fieldsMeta);
      await stub('crm.item.add', { item: { id: 56 } });
      const fields = { ...(spa().config as { fields: Record<string, string> }).fields };
      delete fields.ufCrm136_5;
      await executor.execute(spa({ fields, lists: undefined }), spaContext('normal'));
      expect((await bodies('crm.item.add'))[0]!.fields).toMatchObject({ ufCrm136_2: 102 });
      expect(await bodies('imopenlines.dialog.get')).toEqual([]);
    });

    it('valor fora da lista: cria sem o campo e avisa', async () => {
      await stub('imopenlines.dialog.get', { entity_data_1: 'Y|DEAL|1|N|N|2008|0|0|0|0' });
      await stub('crm.item.fields', fieldsMeta);
      await stub('crm.item.add', { item: { id: 57 } });
      await expect(executor.execute(spa(), spaContext('URGENTE'))).resolves.toEqual({
        itemId: 57,
        entityTypeId: 1204,
        warnings: ['"URGENTE" não é um item da lista ufCrm136_2; o campo ficou vazio'],
      });
      expect((await bodies('crm.item.add'))[0]!.fields).not.toHaveProperty('ufCrm136_2');
    });

    it('recusa do Bitrix é definitiva', async () => {
      await stub('imopenlines.dialog.get', { entity_data_1: '' });
      await stub('crm.item.fields', fieldsMeta);
      await stub('crm.item.add', 'NOT_FOUND', 400);
      const error = await executor.execute(spa(), spaContext('HIGH')).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ActionError);
      expect((error as ActionError).transient).toBe(false);
    });
  });
});
