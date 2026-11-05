import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CRM_ENTITIES,
  type CrmEntity,
  type CrmOption,
  dealStageEntityId,
  normalizeCrmFields,
  normalizePipelines,
  normalizeStatusList,
  type Pipeline,
  type RawCrmCategory,
  type RawCrmField,
  type RawCrmStatus,
  type SemanticField,
  statusTypesOf,
} from '@gptmaker/contracts';
import type Redis from 'ioredis';
import { REDIS } from '../../shared/redis/redis.module';
import { BitrixClient, BitrixError } from '../bitrix';

/** Metadados do CRM de um portal, já traduzidos (design S1). */
export interface CrmMetadata {
  fields: Record<CrmEntity, SemanticField[]>;
  pipelines: Pipeline[];
  /** ISO. */
  loadedAt: string;
}

export interface PortalRef {
  tenantId: string;
  installationId: number;
}

/** Tempo dos metadados no cache: o spec pede mudanças do portal visíveis em até 10 minutos. */
export const METADATA_TTL_SECONDS = 600;

const cacheKey = (tenantId: string) => `semantic:meta:${tenantId}`;

/**
 * Catálogo de campos, listas, funis e etapas do portal (spec crm-semantic-layer): lido do Bitrix
 * em dois `batch` e guardado no Redis por tenant. As escolhas do cliente ficam fora daqui.
 */
@Injectable()
export class FieldCatalogService {
  private readonly logger = new Logger(FieldCatalogService.name);

  constructor(
    private readonly bitrix: BitrixClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async load(portal: PortalRef, options: { fresh?: boolean } = {}): Promise<CrmMetadata> {
    if (!options.fresh) {
      const cached = await this.readCache(portal.tenantId);
      if (cached) return cached;
    }
    const metadata = await this.fetch(portal.installationId);
    try {
      await this.redis.set(
        cacheKey(portal.tenantId),
        JSON.stringify(metadata),
        'EX',
        METADATA_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'cache dos metadados do CRM indisponível');
    }
    return metadata;
  }

  async invalidate(tenantId: string): Promise<void> {
    await this.redis.del(cacheKey(tenantId));
  }

  private async readCache(tenantId: string): Promise<CrmMetadata | null> {
    try {
      const raw = await this.redis.get(cacheKey(tenantId));
      return raw ? (JSON.parse(raw) as CrmMetadata) : null;
    } catch (error) {
      this.logger.warn({ err: error }, 'cache dos metadados do CRM indisponível');
      return null;
    }
  }

  private async fetch(installationId: number): Promise<CrmMetadata> {
    const first = await this.bitrix.batch(installationId, {
      ...Object.fromEntries(
        CRM_ENTITIES.map((entity) => [`fields_${entity}`, { method: `crm.${entity}.fields` }]),
      ),
      categories: { method: 'crm.category.list', params: { entityTypeId: 2 } },
    });
    const failed = CRM_ENTITIES.filter((entity) => first.errors[`fields_${entity}`]);
    if (failed.length) {
      const error = first.errors[`fields_${failed[0]}`]!;
      throw new BitrixError(
        'API_ERROR',
        `crm.${failed[0]}.fields`,
        error.error,
        error.error_description ?? '',
      );
    }

    const raw = Object.fromEntries(
      CRM_ENTITIES.map((entity) => [
        entity,
        (first.results[`fields_${entity}`] ?? {}) as Record<string, RawCrmField>,
      ]),
    ) as Record<CrmEntity, Record<string, RawCrmField>>;
    // Sem funis personalizados (ou sem permissão), sobra o funil geral.
    const categories = ((first.results.categories as { categories?: RawCrmCategory[] } | undefined)
      ?.categories ?? []) as RawCrmCategory[];
    if (!categories.some((category) => Number(category.id) === 0)) {
      categories.push({ id: 0, name: 'Geral', sort: 0, isDefault: 'Y' });
    }

    const statusTypes = [...new Set(CRM_ENTITIES.flatMap((entity) => statusTypesOf(raw[entity])))];
    const stageLists = categories.map((category) => dealStageEntityId(Number(category.id)));
    const lists = [...new Set([...statusTypes, ...stageLists])];
    const second = lists.length
      ? await this.bitrix.batch(
          installationId,
          Object.fromEntries(
            lists.map((entityId) => [
              `status_${entityId}`,
              {
                method: 'crm.status.list',
                params: { filter: { ENTITY_ID: entityId }, order: { SORT: 'ASC' } },
              },
            ]),
          ),
        )
      : { results: {}, errors: {} };
    const rows = (entityId: string) =>
      (Array.isArray(second.results[`status_${entityId}`])
        ? second.results[`status_${entityId}`]
        : []) as RawCrmStatus[];

    const statusLists: Record<string, CrmOption[]> = Object.fromEntries(
      statusTypes.map((type) => [type, normalizeStatusList(rows(type))]),
    );
    return {
      fields: Object.fromEntries(
        CRM_ENTITIES.map((entity) => [
          entity,
          normalizeCrmFields(entity, raw[entity], statusLists),
        ]),
      ) as Record<CrmEntity, SemanticField[]>,
      pipelines: normalizePipelines(
        categories,
        Object.fromEntries(
          categories.map((category) => [
            Number(category.id),
            rows(dealStageEntityId(Number(category.id))),
          ]),
        ),
      ),
      loadedAt: new Date().toISOString(),
    };
  }
}
