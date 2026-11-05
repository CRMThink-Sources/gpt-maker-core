import type { CrmFieldView } from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import { buildAgentPreview } from './crm';

function field(overrides: Partial<CrmFieldView>): CrmFieldView {
  return {
    entity: 'contact',
    code: 'UF_CRM_1',
    label: 'Campo',
    type: 'string',
    custom: true,
    options: [],
    exposed: true,
    description: '',
    available: true,
    ...overrides,
  };
}

// Prévia "O que o agente recebe" (spec crm-semantic-layer, "Configuração pelo painel").
describe('buildAgentPreview', () => {
  it('usa o primeiro valor aceito de uma lista e leva a descrição', () => {
    const preview = buildAgentPreview([
      field({
        label: 'Origem do lead',
        type: 'enumeration',
        options: ['Instagram', 'Indicação', 'Site'],
        description: ' Canal pelo qual o cliente chegou ',
      }),
    ]);
    expect(preview).toEqual([
      {
        label: 'Origem do lead',
        example: 'Instagram',
        description: 'Canal pelo qual o cliente chegou',
      },
    ]);
  });

  it('usa um valor fictício pelo tipo e "…" para tipo desconhecido', () => {
    const preview = buildAgentPreview([
      field({ label: 'Ativo', type: 'boolean' }),
      field({ label: 'Valor', type: 'money' }),
      field({ label: 'Outro', type: 'iblock_element' }),
    ]);
    expect(preview.map((line) => line.example)).toEqual(['Sim', 'R$ 1.500,00', '…']);
    expect(preview.every((line) => line.description === '')).toBe(true);
  });

  it('campo padrão conhecido usa valor próprio; personalizado de texto continua "Exemplo"', () => {
    const preview = buildAgentPreview([
      field({ label: 'Sobrenome', code: 'LAST_NAME', custom: false }),
      field({ label: 'Nome da empresa', entity: 'company', code: 'TITLE', custom: false }),
      field({ label: 'Título', entity: 'deal', code: 'TITLE', custom: false }),
      field({ label: 'Apelido', code: 'LAST_NAME', custom: true }),
    ]);
    expect(preview.map((line) => line.example)).toEqual([
      'Souza',
      'ACME Ltda',
      'Implantação do CRM',
      'Exemplo',
    ]);
  });

  it('deixa de fora campos não expostos e os que sumiram do portal', () => {
    const preview = buildAgentPreview([
      field({ label: 'Exposto' }),
      field({ label: 'Não exposto', exposed: false }),
      field({ label: 'Sumiu', available: false }),
    ]);
    expect(preview.map((line) => line.label)).toEqual(['Exposto']);
  });
});
