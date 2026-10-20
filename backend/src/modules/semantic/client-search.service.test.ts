import { describe, expect, it } from 'vitest';
import { FakeCrmPortal } from '../../../test/support/crm-portal';
import { ClientSearchService, commType } from './client-search.service';

const portal = { tenantId: 't1', installationId: 101 };

function setup() {
  const crm = new FakeCrmPortal();
  crm.records.company['30'] = { ID: '30', TITLE: 'ACME Ltda' };
  crm.records.contact['12'] = {
    ID: '12',
    NAME: 'Maria',
    LAST_NAME: 'Souza',
    COMPANY_ID: '30',
    PHONE: [{ VALUE: '+55 43 99999-0000' }],
    EMAIL: [{ VALUE: 'maria@acme.com' }],
  };
  crm.records.contact['13'] = { ID: '13', NAME: 'João', LAST_NAME: 'Mariano' };
  crm.records.lead['5'] = { ID: '5', TITLE: 'Lead da Maria', COMPANY_TITLE: 'Padaria' };
  crm.records.company['31'] = { ID: '31', TITLE: 'Mariana Doces' };
  return { crm, service: new ClientSearchService(crm.asClient()) };
}

describe('ClientSearchService', () => {
  it('por nome: contatos, leads e empresas, com a empresa do contato', async () => {
    const { service } = setup();
    const result = await service.search(portal, 'mari');
    expect(result).toEqual(
      expect.arrayContaining([
        { type: 'contact', id: 12, name: 'Maria Souza', company: 'ACME Ltda' },
        { type: 'contact', id: 13, name: 'João Mariano', company: null },
        { type: 'lead', id: 5, name: 'Lead da Maria', company: 'Padaria' },
        { type: 'company', id: 31, name: 'Mariana Doces', company: null },
      ]),
    );
    // Só nome e empresa: nada de telefone ou e-mail.
    expect(JSON.stringify(result)).not.toMatch(/99999|@acme/);
  });

  it('por telefone e por e-mail', async () => {
    const { service } = setup();
    expect(await service.search(portal, '(43) 99999-0000')).toEqual([
      { type: 'contact', id: 12, name: 'Maria Souza', company: 'ACME Ltda' },
    ]);
    expect(await service.search(portal, 'maria@acme.com')).toEqual([
      expect.objectContaining({ id: 12 }),
    ]);
    expect(await service.search(portal, '11 1111-1111')).toEqual([]);
  });

  it('busca curta não consulta o CRM', async () => {
    const { crm, service } = setup();
    expect(await service.search(portal, ' m ')).toEqual([]);
    expect(crm.calls).toEqual([]);
  });

  it('classifica a busca', () => {
    expect(commType('maria@acme.com')).toBe('EMAIL');
    expect(commType('+55 (43) 99999-0000')).toBe('PHONE');
    expect(commType('1234')).toBeNull();
    expect(commType('Maria')).toBeNull();
  });
});
