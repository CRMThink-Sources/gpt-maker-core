import { describe, expect, it } from 'vitest';
import {
  crmFieldSettingInputSchema,
  dealStageEntityId,
  exposedByDefault,
  normalizeCrmFields,
  normalizePipelines,
  normalizeStatusList,
  type RawCrmField,
  stageSemantic,
  statusTypesOf,
} from './crm';

/** Recorte de `crm.contact.fields` de um portal real. */
const contactFields: Record<string, RawCrmField> = {
  ID: { type: 'integer', title: 'ID' },
  NAME: { type: 'string', title: 'Nome' },
  LAST_NAME: { type: 'string', title: 'Sobrenome' },
  PHONE: { type: 'crm_multifield', title: 'Telefone', isMultiple: true },
  COMPANY_ID: { type: 'crm_company', title: 'Empresa' },
  SOURCE_ID: { type: 'crm_status', title: 'Fonte', statusType: 'SOURCE' },
  ASSIGNED_BY_ID: { type: 'user', title: 'Responsável' },
  PHOTO: { type: 'file', title: 'Foto' },
  UF_CRM_1712345678: {
    type: 'enumeration',
    title: 'UF_CRM_1712345678',
    formLabel: 'Origem do lead',
    listLabel: 'Origem',
    items: [
      { ID: 45, VALUE: 'Instagram' },
      { ID: 46, VALUE: 'Indicação' },
      { ID: 47, VALUE: 'Site' },
    ],
  },
  UF_CRM_VIP: { type: 'boolean', title: 'UF_CRM_VIP', listLabel: 'Cliente VIP' },
  UF_CRM_SEM_ROTULO: { type: 'string', title: 'UF_CRM_SEM_ROTULO' },
};

describe('normalizeCrmFields', () => {
  const fields = normalizeCrmFields('contact', contactFields, {
    SOURCE: [
      { id: 'CALL', label: 'Ligação' },
      { id: 'WEB', label: 'Site' },
    ],
  });
  const byCode = Object.fromEntries(fields.map((field) => [field.code, field]));

  it('traz o rótulo do usuário nos campos personalizados e os itens da lista', () => {
    expect(byCode.UF_CRM_1712345678).toMatchObject({
      label: 'Origem do lead',
      type: 'enumeration',
      custom: true,
      options: [
        { id: '45', label: 'Instagram' },
        { id: '46', label: 'Indicação' },
        { id: '47', label: 'Site' },
      ],
    });
    expect(byCode.UF_CRM_VIP).toMatchObject({
      label: 'Cliente VIP',
      options: [
        { id: '1', label: 'Sim' },
        { id: '0', label: 'Não' },
      ],
    });
    expect(byCode.UF_CRM_SEM_ROTULO!.label).toBe('UF_CRM_SEM_ROTULO');
  });

  it('resolve listas de status pelo tipo', () => {
    expect(byCode.SOURCE_ID!.options).toEqual([
      { id: 'CALL', label: 'Ligação' },
      { id: 'WEB', label: 'Site' },
    ]);
  });

  it('deixa de fora campos técnicos e tipos sem valor em texto', () => {
    expect(Object.keys(byCode)).not.toEqual(expect.arrayContaining(['ID']));
    for (const code of ['ID', 'COMPANY_ID', 'PHOTO']) expect(byCode[code]).toBeUndefined();
    expect(byCode.PHONE).toMatchObject({ type: 'crm_multifield', multiple: true });
  });

  it('ordena padrão antes de personalizado', () => {
    const firstCustom = fields.findIndex((field) => field.custom);
    expect(fields.slice(firstCustom).every((field) => field.custom)).toBe(true);
  });

  it('lista os tipos de status a ler', () => {
    expect(statusTypesOf(contactFields)).toEqual(['SOURCE']);
  });
});

describe('etapas e funis', () => {
  it('semântica pela letra ou pelo EXTRA', () => {
    expect(stageSemantic({ STATUS_ID: 'WON', NAME: 'Ganho', SEMANTICS: 'S' })).toBe('success');
    expect(
      stageSemantic({ STATUS_ID: 'L', NAME: 'Perdido', EXTRA: { SEMANTICS: 'failure' } }),
    ).toBe('failure');
    expect(stageSemantic({ STATUS_ID: 'NEW', NAME: 'Novo', SEMANTICS: null })).toBe('process');
  });

  it('lista de etapas por funil', () => {
    expect(dealStageEntityId(0)).toBe('DEAL_STAGE');
    expect(dealStageEntityId(3)).toBe('DEAL_STAGE_3');
  });

  it('funis com etapas em ordem, padrão primeiro', () => {
    const pipelines = normalizePipelines(
      [
        { id: 3, name: 'Vendas B2B', sort: 200, isDefault: 'N' },
        { id: 0, name: 'Geral', sort: 100, isDefault: 'Y' },
      ],
      {
        3: [
          { STATUS_ID: 'C3:WON', NAME: 'Fechado', SORT: 900, SEMANTICS: 'S' },
          { STATUS_ID: 'C3:PREPARATION', NAME: 'Proposta enviada', SORT: 20 },
          { STATUS_ID: 'C3:NEW', NAME: 'Novo', SORT: 10 },
        ],
      },
    );
    expect(pipelines.map((p) => p.name)).toEqual(['Geral', 'Vendas B2B']);
    expect(pipelines[1]!.stages.map((s) => [s.name, s.semantic])).toEqual([
      ['Novo', 'process'],
      ['Proposta enviada', 'process'],
      ['Fechado', 'success'],
    ]);
    expect(pipelines[0]!.stages).toEqual([]);
  });

  it('itens de status na ordem do portal', () => {
    expect(
      normalizeStatusList([
        { STATUS_ID: 'B', NAME: 'Segundo', SORT: '20' },
        { STATUS_ID: 'A', NAME: 'Primeiro', SORT: '10' },
      ]),
    ).toEqual([
      { id: 'A', label: 'Primeiro' },
      { id: 'B', label: 'Segundo' },
    ]);
  });
});

describe('padrões e configuração', () => {
  it('expõe o conjunto mínimo e nunca personalizados, telefone ou e-mail', () => {
    expect(exposedByDefault('deal', 'OPPORTUNITY')).toBe(true);
    expect(exposedByDefault('contact', 'NAME')).toBe(true);
    expect(exposedByDefault('contact', 'PHONE')).toBe(false);
    expect(exposedByDefault('contact', 'EMAIL')).toBe(false);
    expect(exposedByDefault('deal', 'UF_CRM_1712345678')).toBe(false);
  });

  it('limita a descrição a 300 caracteres', () => {
    expect(
      crmFieldSettingInputSchema.safeParse({ exposed: true, description: 'x'.repeat(300) }).success,
    ).toBe(true);
    expect(
      crmFieldSettingInputSchema.safeParse({ exposed: true, description: 'x'.repeat(301) }).success,
    ).toBe(false);
    expect(crmFieldSettingInputSchema.parse({ exposed: false })).toEqual({
      exposed: false,
      description: '',
    });
  });
});
