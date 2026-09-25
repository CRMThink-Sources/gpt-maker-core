// API pública do módulo: outros módulos só importam daqui.
export {
  ModelCatalogService,
  type AffectedAgent,
  type AiModel,
  type AllowedModel,
} from './model-catalog.service';
export { ModelsModule } from './models.module';
