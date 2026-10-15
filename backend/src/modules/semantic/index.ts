// API pública do módulo: outros módulos só importam daqui.
export {
  type CrmMetadata,
  FieldCatalogService,
  METADATA_TTL_SECONDS,
  type PortalRef,
} from './field-catalog.service';
export { FieldSettingsService } from './field-settings.service';
export {
  exposedFields,
  type FieldChoice,
  FieldChoices,
  MAX_VALUE_LENGTH,
  type SemanticValue,
  type StageInfo,
  stageOf,
  translateRecord,
  type TranslationContext,
  userIdsIn,
} from './semantic-translator';
export { SemanticModule } from './semantic.module';
export { UserNamesService } from './user-names.service';
