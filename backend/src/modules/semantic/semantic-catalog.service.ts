import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  CRM_ENTITIES,
  type CrmCatalogView,
  type CrmEntity,
  type CrmFieldSettingInput,
  crmFieldSettingInputSchema,
  type CrmFieldView,
} from '@gptmaker/contracts';
import { DomainError } from '../../shared/http/api-exception.filter';
import { BitrixError } from '../bitrix';
import { type CrmMetadata, FieldCatalogService, type PortalRef } from './field-catalog.service';
import { FieldSettingsService } from './field-settings.service';
import type { FieldChoices } from './semantic-translator';

const fieldNotFound = () =>
  new DomainError('CRM_FIELD_NOT_FOUND', 'Campo não encontrado no CRM', HttpStatus.NOT_FOUND);

/**
 * Tela "CRM para o agente" (spec crm-semantic-layer): catálogo do portal com as escolhas do
 * cliente, sempre do tenant da sessão.
 */
@Injectable()
export class SemanticCatalogService {
  private readonly logger = new Logger(SemanticCatalogService.name);

  constructor(
    private readonly catalog: FieldCatalogService,
    private readonly settings: FieldSettingsService,
  ) {}

  async view(portal: PortalRef, options: { fresh?: boolean } = {}): Promise<CrmCatalogView> {
    if (options.fresh) await this.catalog.invalidate(portal.tenantId);
    const [metadata, choices] = await Promise.all([
      this.metadata(portal, options),
      this.settings.forTenant(portal.tenantId),
    ]);
    return toView(metadata, choices);
  }

  async update(
    portal: PortalRef,
    entity: string,
    code: string,
    raw: CrmFieldSettingInput,
  ): Promise<CrmFieldView> {
    if (!(CRM_ENTITIES as readonly string[]).includes(entity)) throw fieldNotFound();
    const input = crmFieldSettingInputSchema.parse(raw);
    const [metadata, choices] = await Promise.all([
      this.metadata(portal),
      this.settings.forTenant(portal.tenantId),
    ]);
    const crmEntity = entity as CrmEntity;
    const exists =
      metadata.fields[crmEntity].some((field) => field.code === code) ||
      choices.get(crmEntity, code) !== undefined;
    if (!exists) throw fieldNotFound();

    await this.settings.save(portal.tenantId, crmEntity, code, input);
    const updated = await this.settings.forTenant(portal.tenantId);
    return toView(metadata, updated).fields.find(
      (field) => field.entity === crmEntity && field.code === code,
    )!;
  }

  private async metadata(portal: PortalRef, options: { fresh?: boolean } = {}) {
    try {
      return await this.catalog.load(portal, options);
    } catch (error) {
      if (!(error instanceof BitrixError)) throw error;
      this.logger.warn({ err: error }, 'metadados do CRM indisponíveis');
      throw new DomainError(
        'CRM_UNAVAILABLE',
        'Não foi possível ler o CRM do portal agora. Tente de novo em instantes',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}

export function toView(metadata: CrmMetadata, choices: FieldChoices): CrmCatalogView {
  const fields: CrmFieldView[] = [];
  const present = new Set<string>();
  for (const entity of CRM_ENTITIES) {
    for (const field of metadata.fields[entity]) {
      present.add(`${entity}:${field.code}`);
      fields.push({
        entity,
        code: field.code,
        label: field.label,
        type: field.type,
        custom: field.custom,
        options: field.options?.map((option) => option.label) ?? [],
        exposed: choices.exposed(entity, field.code),
        description: choices.description(entity, field.code),
        available: true,
      });
    }
  }
  // Configurado pelo cliente, mas sumiu do portal: aparece como indisponível, sem perder a descrição.
  for (const choice of choices.entries()) {
    if (present.has(`${choice.entity}:${choice.code}`)) continue;
    fields.push({
      entity: choice.entity,
      code: choice.code,
      label: choice.code,
      type: 'unavailable',
      custom: choice.code.startsWith('UF_'),
      options: [],
      exposed: choice.exposed,
      description: choice.description,
      available: false,
    });
  }
  return {
    fields,
    pipelines: metadata.pipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      stages: pipeline.stages.map((stage) => ({ name: stage.name, semantic: stage.semantic })),
    })),
    loadedAt: metadata.loadedAt,
  };
}
