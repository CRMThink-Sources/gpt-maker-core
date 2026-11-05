import { normalizeCrmFields, normalizePipelines } from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import type { CrmMetadata } from './field-catalog.service';
import {
  FieldChoices,
  MAX_VALUE_LENGTH,
  stageOf,
  translateRecord,
  type TranslationContext,
  userIdsIn,
} from './semantic-translator';

const metadata: CrmMetadata = {
  fields: {
    lead: [],
    company: [],
    contact: normalizeCrmFields('contact', {
      NAME: { type: 'string', title: 'Nome' },
      ASSIGNED_BY_ID: { type: 'user', title: 'Responsável' },
      PHONE: { type: 'crm_multifield', title: 'Telefone', isMultiple: true },
      OPENED: { type: 'char', title: 'Disponível para todos' },
      COMMENTS: { type: 'string', title: 'Comentário' },
      UF_CRM_ORIGEM: {
        type: 'enumeration',
        title: 'UF_CRM_ORIGEM',
        formLabel: 'Origem do lead',
        items: [
          { ID: 45, VALUE: 'Instagram' },
          { ID: 46, VALUE: 'Indicação' },
        ],
      },
      UF_CRM_VIP: { type: 'boolean', title: 'UF_CRM_VIP', formLabel: 'Cliente VIP' },
      UF_CRM_INTERESSES: {
        type: 'enumeration',
        title: 'UF_CRM_INTERESSES',
        formLabel: 'Interesses',
        isMultiple: true,
        items: [
          { ID: 1, VALUE: 'CRM' },
          { ID: 2, VALUE: 'Telefonia' },
        ],
      },
      UF_CRM_LIMITE: { type: 'money', title: 'UF_CRM_LIMITE', formLabel: 'Limite de crédito' },
    }),
    deal: normalizeCrmFields('deal', {
      TITLE: { type: 'string', title: 'Nome do negócio' },
      OPPORTUNITY: { type: 'double', title: 'Valor' },
      CURRENCY_ID: { type: 'crm_currency', title: 'Moeda' },
      UF_CRM_MARGEM: { type: 'double', title: 'UF_CRM_MARGEM', formLabel: 'Margem interna' },
    }),
  },
  pipelines: normalizePipelines([{ id: 3, name: 'Vendas B2B' }], {
    3: [
      { STATUS_ID: 'C3:PREPARATION', NAME: 'Proposta enviada', SORT: 20 },
      { STATUS_ID: 'C3:WON', NAME: 'Fechado', SORT: 90, SEMANTICS: 'S' },
    ],
  }),
  loadedAt: '2026-10-15T00:00:00.000Z',
};

function context(
  choices: Array<[string, string, boolean, string?]> = [],
  users: Record<string, string> = { '7': 'Ana Vendas' },
): TranslationContext {
  return {
    metadata,
    choices: new FieldChoices(
      new Map(
        choices.map(([entity, code, exposed, description]) => [
          `${entity}:${code}`,
          { exposed, description: description ?? '' },
        ]),
      ),
    ),
    users: new Map(Object.entries(users)),
  };
}

const contact = {
  NAME: 'Maria',
  ASSIGNED_BY_ID: '7',
  PHONE: [{ VALUE: '+55 43 99999-0000', VALUE_TYPE: 'WORK' }],
  OPENED: 'Y',
  UF_CRM_ORIGEM: '46',
  UF_CRM_VIP: '1',
  UF_CRM_INTERESSES: ['1', '2'],
  UF_CRM_LIMITE: '5000|BRL',
};

describe('translateRecord', () => {
  it('por padrão entrega só os campos padrão mínimos', () => {
    expect(translateRecord('contact', contact, context())).toEqual([
      { campo: 'Nome', valor: 'Maria' },
      { campo: 'Responsável', valor: 'Ana Vendas' },
    ]);
  });

  it('traduz listas, sim/não, múltiplos e moeda dos campos expostos', () => {
    const values = translateRecord(
      'contact',
      contact,
      context([
        ['contact', 'UF_CRM_ORIGEM', true, 'Canal pelo qual o cliente chegou'],
        ['contact', 'UF_CRM_VIP', true],
        ['contact', 'UF_CRM_INTERESSES', true],
        ['contact', 'UF_CRM_LIMITE', true],
        ['contact', 'OPENED', true],
      ]),
    );
    expect(values).toEqual(
      expect.arrayContaining([
        {
          campo: 'Origem do lead',
          valor: 'Indicação',
          significado: 'Canal pelo qual o cliente chegou',
        },
        { campo: 'Cliente VIP', valor: 'Sim' },
        { campo: 'Interesses', valor: 'CRM, Telefonia' },
        { campo: 'Limite de crédito', valor: '5000 BRL' },
        { campo: 'Disponível para todos', valor: 'Sim' },
      ]),
    );
    // Nenhum código técnico na saída.
    expect(JSON.stringify(values)).not.toMatch(/UF_CRM|\b46\b/);
  });

  it('telefone só com marcação explícita', () => {
    expect(translateRecord('contact', contact, context()).map((v) => v.campo)).not.toContain(
      'Telefone',
    );
    expect(
      translateRecord('contact', contact, context([['contact', 'PHONE', true]])),
    ).toContainEqual({ campo: 'Telefone', valor: '+55 43 99999-0000' });
  });

  it('campo desmarcado some, mesmo sendo padrão', () => {
    expect(
      translateRecord('contact', contact, context([['contact', 'NAME', false]])).map(
        (v) => v.campo,
      ),
    ).toEqual(['Responsável']);
  });

  it('omite item de lista inexistente, usuário desconhecido e valor vazio', () => {
    const values = translateRecord(
      'contact',
      { ...contact, UF_CRM_ORIGEM: '99', ASSIGNED_BY_ID: '8', NAME: '' },
      context([['contact', 'UF_CRM_ORIGEM', true]]),
    );
    expect(values).toEqual([]);
  });

  it('valor com moeda e campo não exposto ausente no negócio', () => {
    const values = translateRecord(
      'deal',
      { TITLE: 'Plano Pro', OPPORTUNITY: '1500.00', CURRENCY_ID: 'BRL', UF_CRM_MARGEM: '35' },
      context(),
    );
    expect(values).toContainEqual({ campo: 'Valor', valor: '1500.00 BRL' });
    expect(values.map((v) => v.campo)).not.toContain('Margem interna');
  });

  it('corta textos longos', () => {
    const [value] = translateRecord(
      'contact',
      { COMMENTS: 'a'.repeat(MAX_VALUE_LENGTH + 50) },
      context([
        ['contact', 'COMMENTS', true],
        ['contact', 'NAME', false],
      ]),
    );
    expect(value!.valor).toHaveLength(MAX_VALUE_LENGTH + 1);
  });
});

describe('campos de data', () => {
  it('campo só de data perde o horário; data e hora fica igual', () => {
    const dated: CrmMetadata = {
      ...metadata,
      fields: {
        ...metadata.fields,
        deal: normalizeCrmFields('deal', {
          BEGINDATE: { type: 'date', title: 'Data de início' },
          DATE_CREATE: { type: 'datetime', title: 'Criado em' },
        }),
      },
    };
    const values = translateRecord(
      'deal',
      { BEGINDATE: '2026-10-19T03:00:00+03:00', DATE_CREATE: '2026-10-19T22:19:19+03:00' },
      { ...context(), metadata: dated },
    );
    expect(values).toEqual([
      { campo: 'Criado em', valor: '2026-10-19T22:19:19+03:00' },
      { campo: 'Data de início', valor: '2026-10-19' },
    ]);
  });
});

describe('funil e etapa', () => {
  it('traduz pelo nome e nunca entrega o id', () => {
    const withStage: CrmMetadata = {
      ...metadata,
      fields: {
        ...metadata.fields,
        deal: normalizeCrmFields('deal', {
          CATEGORY_ID: { type: 'crm_category', title: 'Pipeline' },
          STAGE_ID: { type: 'crm_status', title: 'Fase', statusType: 'DEAL_STAGE' },
        }),
      },
    };
    const values = translateRecord(
      'deal',
      { CATEGORY_ID: '3', STAGE_ID: 'C3:PREPARATION' },
      { ...context(), metadata: withStage },
    );
    expect(values).toEqual(
      expect.arrayContaining([
        { campo: 'Funil', valor: 'Vendas B2B' },
        { campo: 'Etapa', valor: 'Proposta enviada' },
      ]),
    );
    expect(JSON.stringify(values)).not.toMatch(/C3:|"3"/);
  });
});

describe('userIdsIn', () => {
  it('lista os responsáveis dos campos expostos, sem repetir', () => {
    expect(
      userIdsIn('contact', [contact, { ...contact }, { ASSIGNED_BY_ID: '0' }], context()),
    ).toEqual(['7']);
  });
});

describe('stageOf', () => {
  it('funil, etapa e situação pelo nome', () => {
    expect(stageOf(metadata.pipelines, '3', 'C3:PREPARATION')).toEqual({
      funil: 'Vendas B2B',
      etapa: 'Proposta enviada',
      situacao: 'em andamento',
    });
    expect(stageOf(metadata.pipelines, 3, 'C3:WON')!.situacao).toBe('ganha');
    expect(stageOf(metadata.pipelines, 9, 'X')).toBeNull();
  });
});
