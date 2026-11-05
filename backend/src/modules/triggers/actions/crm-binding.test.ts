import { describe, expect, it } from 'vitest';
import { bizprocDocumentId, parseCrmBinding, parseSessionId, primaryEntity } from './crm-binding';

describe('vínculo do diálogo com o CRM', () => {
  it.each([
    // Portal real (2026-10-01, docs/bitrix-observado.md).
    [
      'LEAD|0|COMPANY|39964|CONTACT|9448|DEAL|27134',
      { company: 39964, contact: 9448, deal: 27134 },
    ],
    // Exemplo da documentação de imopenlines.dialog.get.
    ['LEAD|1209|COMPANY|0|CONTACT|0|DEAL|0', { lead: 1209 }],
    ['LEAD|0|COMPANY|7|CONTACT|31|DEAL|88', { company: 7, contact: 31, deal: 88 }],
    ['', {}],
    [null, {}],
    ['LEAD|abc|DEAL|5|SPA|9', { deal: 5 }],
  ])('%s', (entityData2, expected) => {
    expect(parseCrmBinding(entityData2)).toEqual(expected);
  });

  it('entidade principal: negócio, lead, contato, empresa', () => {
    expect(primaryEntity({ lead: 1, deal: 2 })).toEqual({ type: 'deal', id: 2 });
    expect(primaryEntity({ contact: 3, company: 4 })).toEqual({ type: 'contact', id: 3 });
    expect(primaryEntity({})).toBeNull();
  });

  it('documento do business process', () => {
    expect(bizprocDocumentId('lead', 777)).toEqual(['crm', 'CCrmDocumentLead', 'LEAD_777']);
    expect(bizprocDocumentId('deal', 5)).toEqual(['crm', 'CCrmDocumentDeal', 'DEAL_5']);
    expect(bizprocDocumentId('company', 9)).toEqual(['crm', 'CCrmDocumentCompany', 'COMPANY_9']);
  });
});

describe('sessão da Linha Aberta', () => {
  it.each([
    // Portal real (2026-10-30, docs/bitrix-observado.md): sempre a sessão mais recente do chat.
    ['Y|DEAL|39808|N|N|2008|1793305311|0|0|0', '2008'],
    ['Y|LEAD|51484|N|N|2004|1793304462|0|0|0', '2004'],
    ['N|NONE|0|N|N|0|0|0|0|0', null],
    ['Y|DEAL|1', null],
    [null, null],
  ])('%s', (entityData1, expected) => {
    expect(parseSessionId(entityData1)).toBe(expected);
  });
});
