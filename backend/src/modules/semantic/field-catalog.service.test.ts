import { describe, expect, it } from 'vitest';
import { FakeCrmPortal } from '../../../test/support/crm-portal';
import { FakeRedis } from '../../../test/support/fake-redis';
import { BitrixError } from '../bitrix';
import { FieldCatalogService } from './field-catalog.service';

const portal = { tenantId: 't1', installationId: 101 };

function setup() {
  const crm = new FakeCrmPortal();
  const redis = new FakeRedis();
  const service = new FieldCatalogService(crm.asClient(), redis.asRedis());
  return { crm, redis, service };
}

describe('FieldCatalogService', () => {
  it('traduz campos, listas, funis e etapas do portal', async () => {
    const { service } = setup();
    const metadata = await service.load(portal);

    const origem = metadata.fields.contact.find((field) => field.code === 'UF_CRM_ORIGEM');
    expect(origem).toMatchObject({ label: 'Origem do lead', custom: true });
    expect(origem!.options!.map((option) => option.label)).toEqual(['Instagram', 'Indicação']);

    const status = metadata.fields.lead.find((field) => field.code === 'STATUS_ID');
    expect(status!.options).toEqual([
      { id: 'NEW', label: 'Não tratado' },
      { id: 'IN_PROCESS', label: 'Em atendimento' },
    ]);

    // O funil geral entra mesmo quando `crm.category.list` não o lista.
    expect(metadata.pipelines.map((pipeline) => pipeline.name)).toEqual(['Geral', 'Vendas B2B']);
    expect(metadata.pipelines[1]!.stages.map((stage) => [stage.name, stage.semantic])).toEqual([
      ['Primeiro contato', 'process'],
      ['Proposta enviada', 'process'],
      ['Fechado', 'success'],
      ['Desistiu', 'failure'],
    ]);
    // Funil e etapa não viram campos: as ferramentas os entregam à parte.
    expect(metadata.fields.deal.map((field) => field.code)).not.toContain('STAGE_ID');
  });

  it('usa o cache e relê após invalidar', async () => {
    const { crm, service } = setup();
    await service.load(portal);
    await service.load(portal);
    expect(crm.count('crm.deal.fields')).toBe(1);

    crm.statuses.DEAL_STAGE_3!.push({ STATUS_ID: 'C3:NEGOTIATION', NAME: 'Negociação', SORT: 30 });
    await service.invalidate(portal.tenantId);
    const metadata = await service.load(portal);
    expect(crm.count('crm.deal.fields')).toBe(2);
    expect(metadata.pipelines[1]!.stages.map((stage) => stage.name)).toContain('Negociação');
  });

  it('lê do portal ignorando o cache quando pedido', async () => {
    const { crm, service } = setup();
    await service.load(portal);
    await service.load(portal, { fresh: true });
    expect(crm.count('crm.contact.fields')).toBe(2);
  });

  it('separa o cache por tenant', async () => {
    const { crm, service } = setup();
    await service.load(portal);
    await service.load({ tenantId: 't2', installationId: 202 });
    expect(crm.count('crm.lead.fields')).toBe(2);
  });

  it('falha quando o Bitrix recusa os metadados', async () => {
    const { crm, service } = setup();
    crm.failing.set(
      'crm.deal.fields',
      new BitrixError('API_ERROR', 'crm.deal.fields', 'ACCESS_DENIED', 'sem acesso'),
    );
    await expect(service.load(portal)).rejects.toBeInstanceOf(BitrixError);
  });

  it('segue sem cache quando o Redis cai', async () => {
    const { redis, service } = setup();
    redis.failing = true;
    await expect(service.load(portal)).resolves.toHaveProperty('pipelines');
  });
});
