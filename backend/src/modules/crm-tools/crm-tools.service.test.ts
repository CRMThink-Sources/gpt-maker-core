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
import type { TestConversations } from '../agent-test';
import type { CrmCaller } from './crm-access.guard';
import { CRM_GUIDANCE_DEFAULTS, type CrmGuidance } from './crm-guidance.defaults';
import type { CrmGuidanceService } from './crm-guidance.service';
import { CrmToolsService, MAX_DEALS } from './crm-tools.service';

const caller: CrmCaller = { tenantId: 'tenant-a', agentId: 'agent-1', installationId: 101 };
const CHAT = `public-api-gm1-${caller.tenantId}:chat55`;

/** Só o `update(...).set(...).where(...)` do `last_call_at`. */
const fakeDb = {
  update: () => ({ set: () => ({ where: async () => undefined }) }),
} as unknown as Database;

/** Conversas de teste: `<tenant>:<conversa>` ⇒ cliente simulado. */
const simulated = new Map<string, { type: 'contact' | 'lead' | 'company'; id: number }>();
const testConversations = {
  simulatedClient: async (tenantId: string, conversationId: string) =>
    simulated.get(`${tenantId}:${conversationId}`) ?? null,
} as unknown as TestConversations;

function setup(
  choices: Array<[string, string, FieldChoice]> = [],
  ratePerMinute = 60,
  edits: Partial<CrmGuidance> = {},
) {
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
    testConversations,
    { current: async () => ({ ...CRM_GUIDANCE_DEFAULTS, ...edits }) } as CrmGuidanceService,
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

describe('CrmToolsService.identifyClient em conversa de teste', () => {
  const conversation = '0a1b2c3d4e';
  const testChat = `public-api-gm1-${caller.tenantId}:t-${conversation}`;

  it('usa o cliente simulado, sem consultar a Linha Aberta', async () => {
    const { crm, service } = setup();
    simulated.set(`${caller.tenantId}:${conversation}`, { type: 'contact', id: 12 });
    const result = await service.identifyClient(caller, testChat);
    expect(result.outcome).toBe('ok');
    expect(result.body.cliente).toMatchObject({ nome: 'Maria Souza', tipo: 'contato' });
    expect(crm.count('imopenlines.dialog.get')).toBe(0);
  });

  it('sem cliente, de outro tenant ou com id inválido: não identificado', async () => {
    const { crm, service } = setup();
    simulated.clear();
    simulated.set(`tenant-b:${conversation}`, { type: 'contact', id: 12 });
    for (const chat of [testChat, `public-api-gm1-${caller.tenantId}:t-invalida`]) {
      expect((await service.identifyClient(caller, chat)).outcome).toBe('not_identified');
    }
    expect(crm.count('imopenlines.dialog.get')).toBe(0);
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

describe('CrmToolsService: o que o agente recebe', () => {
  it('valor não informado, fechamento só com a data e o que não está disponível', async () => {
    const { service, deal } = setup();
    deal(40, 'C3:WON', 'S', '2026-10-19T22:19:19+03:00', {
      OPPORTUNITY: '0.00',
      CLOSEDATE: '2026-10-19T03:00:00+03:00',
    });
    const ref = service.refs.issue(caller.tenantId, 'contact', 12);
    const result = await service.clientDeals(caller, ref, 'ganhos');
    const won = (result.body.negocios as Array<Record<string, unknown>>).find(
      (item) => item.titulo === 'Negócio 40',
    );
    expect(won).toMatchObject({ valor: 'não informado', fechamento_previsto: '2026-10-19' });
    expect(won!.criado_em).toBe('2026-10-19T22:19:19+03:00');
    expect(result.body.orientacao).toMatch(/não há acesso a histórico de atividades/i);

    const identified = await service.identifyClient(caller, CHAT);
    expect(identified.body.orientacao).toMatch(/não ofereça nem prometa/i);
  });
});

describe('CrmToolsService: orientações editadas no backoffice', () => {
  it('usa o texto editado seguido do escopo dos dados', async () => {
    const { service } = setup([], 60, {
      negocios_do_cliente: 'Responda só com estes negócios.',
      cliente_nao_identificado: 'Cliente sem cadastro.',
    });
    const ref = service.refs.issue(caller.tenantId, 'contact', 12);
    const result = await service.clientDeals(caller, ref, 'todos');
    expect(result.body.orientacao).toBe(
      `Responda só com estes negócios. ${CRM_GUIDANCE_DEFAULTS.escopo_dados}`,
    );

    const unknown = await service.identifyClient(caller, 'chat-sem-vinculo');
    expect(unknown).toMatchObject({
      outcome: 'not_identified',
      body: { mensagem: 'Cliente sem cadastro.' },
    });
  });
});

describe('CrmToolsService: funil e etapa escondidos', () => {
  it('etapa escondida some com a situação; funil continua', async () => {
    const { service } = setup([['deal', 'STAGE_ID', { exposed: false, description: '' }]]);
    const ref = service.refs.issue(caller.tenantId, 'contact', 12);
    const result = await service.clientDeals(caller, ref, 'em_andamento');
    const [deal] = result.body.negocios as Array<Record<string, unknown>>;
    expect(deal).toMatchObject({ funil: 'Vendas B2B' });
    expect(deal).not.toHaveProperty('etapa');
    expect(deal).not.toHaveProperty('situacao');
    expect(JSON.stringify(result.body)).not.toMatch(/Proposta enviada|Primeiro contato/);
  });

  it('funil escondido: some dos negócios e as etapas dos funis não são mostradas', async () => {
    const { service } = setup([['deal', 'CATEGORY_ID', { exposed: false, description: '' }]]);
    const identified = await service.identifyClient(caller, CHAT);
    const deals = identified.body.negocios_em_andamento as Array<Record<string, unknown>>;
    expect(deals[0]).not.toHaveProperty('funil');
    expect(deals[0]).toHaveProperty('etapa');

    const stages = await service.pipelineStages(caller);
    expect(stages).toMatchObject({ outcome: 'not_found' });
    expect(JSON.stringify(stages.body)).not.toContain('Vendas B2B');
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
