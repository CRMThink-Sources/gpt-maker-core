import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeCrmPortal } from '../../../test/support/crm-portal';
import { FakeRedis } from '../../../test/support/fake-redis';
import type { Env } from '../../config/env';
import type { Database } from '../../shared/database/database.module';
import { BitrixError } from '../bitrix';
import {
  FieldCatalogService,
  type FieldChoice,
  FieldChoices,
  type FieldSettingsService,
  UserNamesService,
} from '../semantic';
import type { CrmCaller } from './crm-access.guard';
import { CrmToolsService, MAX_DEALS } from './crm-tools.service';

const caller: CrmCaller = { tenantId: 'tenant-a', agentId: 'agent-1', installationId: 101 };
const CHAT = `public-api-gm1-${caller.tenantId}:chat55`;

/** Só o `update(...).set(...).where(...)` do `last_call_at`. */
const fakeDb = {
  update: () => ({ set: () => ({ where: async () => undefined }) }),
} as unknown as Database;

function setup(choices: Array<[string, string, FieldChoice]> = [], ratePerMinute = 60) {
  const crm = new FakeCrmPortal();
  const redis = new FakeRedis();
  const settings = {
    forTenant: async () =>
      new FieldChoices(
        new Map(choices.map(([entity, code, choice]) => [`${entity}:${code}`, choice])),
      ),
  } as unknown as FieldSettingsService;
  const client = crm.asClient();
  const service = new CrmToolsService(
    client,
    new FieldCatalogService(client, redis.asRedis()),
    settings,
    new UserNamesService(client, redis.asRedis()),
    fakeDb,
    redis.asRedis(),
    {
      DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      CRM_TOOLS_RATE_PER_MINUTE: ratePerMinute,
    } as Env,
  );

  crm.records.contact['12'] = {
    ID: '12',
    NAME: 'Maria',
    LAST_NAME: 'Souza',
    COMPANY_ID: '30',
    ASSIGNED_BY_ID: '7',
    PHONE: [{ VALUE: '+55 43 99999-0000' }],
    UF_CRM_ORIGEM: '46',
  };
  crm.records.company['30'] = { ID: '30', TITLE: 'ACME Ltda' };
  const deal = (id: number, stage: string, semantic: string, created: string, extra = {}) => {
    crm.records.deal[String(id)] = {
      ID: String(id),
      TITLE: `Negócio ${id}`,
      CONTACT_ID: '12',
      CATEGORY_ID: '3',
      STAGE_ID: stage,
      STAGE_SEMANTIC_ID: semantic,
      OPPORTUNITY: '1500.00',
      CURRENCY_ID: 'BRL',
      ASSIGNED_BY_ID: '7',
      DATE_CREATE: created,
      UF_CRM_MARGEM: '35',
      UF_CRM_PLANO: '11',
      ...extra,
    };
  };
  deal(1, 'C3:PREPARATION', 'P', '2026-10-10T10:00:00+03:00');
  deal(2, 'C3:NEW', 'P', '2026-10-12T10:00:00+03:00');
  deal(3, 'C3:WON', 'S', '2026-09-01T10:00:00+03:00');
  crm.dialogs.chat55 = 'LEAD|0|COMPANY|30|CONTACT|12|DEAL|1';
  return { crm, redis, service, deal };
}

describe('CrmToolsService.identifyClient', () => {
  it('devolve o contato vinculado à conversa com os negócios em andamento', async () => {
    const { service } = setup();
    const result = await service.identifyClient(caller, CHAT);
    expect(result.outcome).toBe('ok');
    const body = result.body as {
      cliente: Record<string, unknown>;
      negocios_em_andamento: Array<Record<string, unknown>>;
      ha_mais_negocios: boolean;
    };
    expect(body.cliente).toMatchObject({
      tipo: 'contato',
      nome: 'Maria Souza',
      empresa: 'ACME Ltda',
      responsavel: 'Ana Vendas',
    });
    expect(service.refs.verify(caller.tenantId, body.cliente.referencia)).toEqual({
      type: 'contact',
      id: 12,
    });
    expect(body.negocios_em_andamento.map((deal) => [deal.titulo, deal.etapa])).toEqual([
      ['Negócio 2', 'Primeiro contato'],
      ['Negócio 1', 'Proposta enviada'],
    ]);
    expect(body.negocios_em_andamento[1]).toMatchObject({
      funil: 'Vendas B2B',
      situacao: 'em andamento',
      valor: '1500.00 BRL',
    });
    expect(body.ha_mais_negocios).toBe(false);
  });

  it('só entrega campos expostos, traduzidos e sem códigos técnicos', async () => {
    const { service } = setup([
      ['contact', 'UF_CRM_ORIGEM', { exposed: true, description: 'Canal de chegada' }],
      ['deal', 'UF_CRM_PLANO', { exposed: true, description: '' }],
    ]);
    const result = await service.identifyClient(caller, CHAT);
    const json = JSON.stringify(result.body);
    expect(json).toContain(
      '"campo":"Origem do lead","valor":"Indicação","significado":"Canal de chegada"',
    );
    expect(json).toContain('"campo":"Plano contratado","valor":"Pro"');
    // Margem interna e telefone não foram expostos.
    expect(json).not.toMatch(/Margem|99999|UF_CRM|C3:/);
  });

  it('conversa sem vínculo, chat não preenchido ou de outro tenant: não identificado', async () => {
    const { crm, service } = setup();
    crm.dialogs.chat56 = 'LEAD|0|COMPANY|0|CONTACT|0|DEAL|0';
    for (const chat of [
      `public-api-gm1-${caller.tenantId}:chat56`,
      '{{chat_id}}',
      '',
      undefined,
      'public-api-gm1-tenant-b:chat55',
    ]) {
      const result = await service.identifyClient(caller, chat);
      expect(result.outcome).toBe('not_identified');
      expect(JSON.stringify(result.body)).not.toContain('Maria');
    }
    // Chat de outro tenant nem chega ao Bitrix.
    expect(crm.calls.filter((call) => call.params.DIALOG_ID === 'chat55')).toHaveLength(0);
  });

  it('só negócio vinculado: usa o contato do negócio', async () => {
    const { crm, service } = setup();
    crm.dialogs.chat55 = 'LEAD|0|COMPANY|0|CONTACT|0|DEAL|1';
    const result = await service.identifyClient(caller, CHAT);
    expect(result.body.cliente).toMatchObject({ nome: 'Maria Souza' });
  });

  it('Bitrix fora do ar: indisponível, sem detalhe interno', async () => {
    const { crm, service } = setup();
    crm.failing.set(
      'imopenlines.dialog.get',
      new BitrixError('UNAVAILABLE', 'imopenlines.dialog.get', 'TIMEOUT', 'segredo interno'),
    );
    const result = await service.identifyClient(caller, CHAT);
    expect(result.outcome).toBe('unavailable');
    expect(JSON.stringify(result.body)).not.toMatch(/segredo|TIMEOUT|imopenlines/);
  });

  it('limite por agente', async () => {
    const { service } = setup([], 2);
    expect((await service.identifyClient(caller, CHAT)).outcome).toBe('ok');
    expect((await service.pipelineStages(caller)).outcome).toBe('ok');
    const third = await service.identifyClient(caller, CHAT);
    expect(third.outcome).toBe('rate_limited');
    // Outro agente tem a própria cota.
    expect((await service.pipelineStages({ ...caller, agentId: 'agent-2' })).outcome).toBe('ok');
  });
});

describe('CrmToolsService.clientDeals', () => {
  it('filtra por situação a partir da referência', async () => {
    const { service } = setup();
    const ref = service.refs.issue(caller.tenantId, 'contact', 12);
    const won = await service.clientDeals(caller, ref, 'ganhos');
    expect(won.outcome).toBe('ok');
    expect(
      (won.body.negocios as Array<{ titulo: string; situacao: string }>).map((d) => [
        d.titulo,
        d.situacao,
      ]),
    ).toEqual([['Negócio 3', 'ganha']]);
    const all = await service.clientDeals(caller, ref);
    expect(all.count).toBe(3);
  });

  it('limita a 10 e informa que existem mais', async () => {
    const { service, deal } = setup();
    for (let id = 10; id < 35; id++)
      deal(id, 'C3:NEW', 'P', `2026-08-${String(id - 9).padStart(2, '0')}T00:00:00+03:00`);
    const ref = service.refs.issue(caller.tenantId, 'contact', 12);
    const result = await service.clientDeals(caller, ref, 'em_andamento');
    expect(result.body.negocios).toHaveLength(MAX_DEALS);
    expect(result.body).toMatchObject({ ha_mais: true, total: 27 });
  });

  it('referência adulterada ou de outro tenant: não encontrado, sem consultar o Bitrix', async () => {
    const { crm, service } = setup();
    const ref = service.refs.issue('tenant-b', 'contact', 12);
    for (const bad of [ref, 'c12', ref.replace('c12', 'c13')]) {
      const result = await service.clientDeals(caller, bad);
      expect(result.outcome).toBe('not_found');
    }
    expect(crm.count('crm.deal.list')).toBe(0);
  });
});

describe('CrmToolsService.pipelineStages', () => {
  it('etapas de um funil pelo nome, sem acento nem caixa', async () => {
    const { service } = setup();
    const result = await service.pipelineStages(caller, 'vendas b2b');
    expect(result.body).toEqual({
      funis: [
        {
          funil: 'Vendas B2B',
          etapas: [
            { etapa: 'Primeiro contato', situacao: 'em andamento' },
            { etapa: 'Proposta enviada', situacao: 'em andamento' },
            { etapa: 'Fechado', situacao: 'ganha' },
            { etapa: 'Desistiu', situacao: 'perdida' },
          ],
        },
      ],
    });
  });

  it('funil inexistente lista os existentes', async () => {
    const { service } = setup();
    const result = await service.pipelineStages(caller, 'Pós-venda');
    expect(result).toMatchObject({
      outcome: 'not_found',
      body: { funis_existentes: ['Geral', 'Vendas B2B'] },
    });
  });
});
