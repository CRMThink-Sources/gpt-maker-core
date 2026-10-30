import { describe, expect, it } from 'vitest';
import { spaFieldsFrom, suggestListLinks } from './crm-fields';

// Resposta real de `crm.item.fields` (SPA 1204, docs/bitrix-observado.md), reduzida.
const raw = {
  title: { type: 'string', title: 'Nome', isDynamic: false },
  stageId: { type: 'crm_status', title: 'Etapa', isDynamic: false },
  ufCrm136_1750943184955: { type: 'string', title: 'Descrição', isDynamic: true },
  ufCrm136_1771872592598: {
    type: 'enumeration',
    title: 'Resolvido?',
    isDynamic: true,
    items: [
      { ID: '198872', VALUE: 'sim' },
      { ID: '198874', VALUE: 'não' },
    ],
  },
  // Outros formatos de código do mesmo portal: também são do cliente.
  ufCrm_6712345: { type: 'string', title: 'Chamado externo', isDynamic: true },
  ufCrmCodigo: { type: 'double', title: 'Código', isDynamic: true },
  ufCrm136_9: { type: 'file', title: 'Anexo', isDynamic: true },
  ufCrm136_10: { type: 'string', title: 'Bloqueado', isReadOnly: true, isDynamic: true },
  ufCrm136_11: { type: 'string', title: 'Vários', isMultiple: true, isDynamic: true },
  ufCrmContactId: { type: 'crm', title: 'Contato', isDynamic: true },
};

describe('campos do SPA', () => {
  it('só personalizados (isDynamic, qualquer código), editáveis, de valor único e com texto, por nome', () => {
    expect(spaFieldsFrom(raw)).toEqual([
      { code: 'ufCrm_6712345', label: 'Chamado externo', type: 'string' },
      { code: 'ufCrmCodigo', label: 'Código', type: 'double' },
      { code: 'ufCrm136_1750943184955', label: 'Descrição', type: 'string' },
      {
        code: 'ufCrm136_1771872592598',
        label: 'Resolvido?',
        type: 'enumeration',
        options: [
          { id: '198872', label: 'sim' },
          { id: '198874', label: 'não' },
        ],
      },
    ]);
  });

  it('sugere o item da lista de mesmo texto', () => {
    expect(
      suggestListLinks(
        ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
        [
          { id: '101', label: 'low' },
          { id: '103', label: ' HIGH ' },
          { id: '104', label: 'Urgente' },
        ],
      ),
    ).toEqual({ LOW: 101, HIGH: 103 });
  });
});
