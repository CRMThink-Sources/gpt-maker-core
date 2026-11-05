import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { FakeCrmPortal } from '../../../test/support/crm-portal';
import { FakeRedis } from '../../../test/support/fake-redis';
import { DomainError } from '../../shared/http/api-exception.filter';
import { BitrixError } from '../bitrix';
import { FieldCatalogService } from './field-catalog.service';
import type { FieldSettingsService } from './field-settings.service';
import { SemanticCatalogService } from './semantic-catalog.service';
import { type FieldChoice, FieldChoices } from './semantic-translator';

/** Escolhas em memória, por tenant (a tabela real tem a chave tenant + entidade + código). */
class MemorySettings {
  readonly rows = new Map<string, Map<string, FieldChoice>>();

  async forTenant(tenantId: string) {
    return new FieldChoices(new Map(this.rows.get(tenantId) ?? []));
  }

  async save(tenantId: string, entity: string, code: string, choice: FieldChoice) {
    const tenantRows = this.rows.get(tenantId) ?? new Map();
    tenantRows.set(`${entity}:${code}`, choice);
    this.rows.set(tenantId, tenantRows);
  }
}

const portal = { tenantId: 't1', installationId: 101 };

function setup() {
  const crm = new FakeCrmPortal();
  const settings = new MemorySettings();
  const service = new SemanticCatalogService(
    new FieldCatalogService(crm.asClient(), new FakeRedis().asRedis()),
    settings as unknown as FieldSettingsService,
  );
  return { crm, settings, service };
}

async function domainError(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('era esperado DomainError');
}

describe('SemanticCatalogService', () => {
  it('lista o catálogo com os padrões de exposição', async () => {
    const { service } = setup();
    const view = await service.view(portal);
    const find = (entity: string, code: string) =>
      view.fields.find((field) => field.entity === entity && field.code === code)!;

    expect(find('contact', 'NAME')).toMatchObject({ exposed: true, available: true });
    expect(find('contact', 'PHONE')).toMatchObject({ exposed: false });
    expect(find('contact', 'UF_CRM_ORIGEM')).toMatchObject({
      label: 'Origem do lead',
      options: ['Instagram', 'Indicação'],
      exposed: false,
    });
    expect(view.pipelines.find((pipeline) => pipeline.name === 'Vendas B2B')!.stages).toHaveLength(
      4,
    );
  });

  it('grava a escolha e a descrição de um campo', async () => {
    const { service } = setup();
    const field = await service.update(portal, 'contact', 'UF_CRM_ORIGEM', {
      exposed: true,
      description: 'Canal pelo qual o cliente chegou; Indicação tem prioridade',
    });
    expect(field).toMatchObject({
      code: 'UF_CRM_ORIGEM',
      exposed: true,
      description: 'Canal pelo qual o cliente chegou; Indicação tem prioridade',
    });
  });

  it('campo inexistente no portal do tenant responde como não encontrado', async () => {
    const { service, settings } = setup();
    // Outro tenant configurou um campo que só existe no portal dele.
    await settings.save('t2', 'deal', 'UF_CRM_DO_OUTRO', { exposed: true, description: '' });

    const error = await domainError(
      service.update(portal, 'deal', 'UF_CRM_DO_OUTRO', { exposed: true }),
    );
    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(settings.rows.get('t1')).toBeUndefined();

    const badEntity = await domainError(
      service.update(portal, 'quote', 'TITLE', { exposed: true }),
    );
    expect(badEntity.getStatus()).toBe(HttpStatus.NOT_FOUND);
  });

  it('campo removido do portal aparece indisponível sem perder a descrição', async () => {
    const { crm, service } = setup();
    await service.update(portal, 'contact', 'UF_CRM_ORIGEM', {
      exposed: true,
      description: 'Canal de chegada',
    });
    delete crm.fields.contact!.UF_CRM_ORIGEM;

    const view = await service.view(portal, { fresh: true });
    expect(view.fields.find((field) => field.code === 'UF_CRM_ORIGEM')).toMatchObject({
      available: false,
      description: 'Canal de chegada',
    });
  });

  it('Bitrix fora do ar vira erro recuperável', async () => {
    const { crm, service } = setup();
    crm.failing.set('batch', new BitrixError('UNAVAILABLE', 'batch', 'TIMEOUT', ''));
    crm.failing.set(
      'crm.lead.fields',
      new BitrixError('UNAVAILABLE', 'crm.lead.fields', 'TIMEOUT', ''),
    );
    const error = await domainError(service.view(portal));
    expect(error.code).toBe('CRM_UNAVAILABLE');
    expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
