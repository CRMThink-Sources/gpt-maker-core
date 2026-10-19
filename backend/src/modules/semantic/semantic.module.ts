import { Module } from '@nestjs/common';
import { BitrixModule } from '../bitrix';
import { TenancyModule } from '../tenancy';
import { FieldCatalogService } from './field-catalog.service';
import { FieldSettingsService } from './field-settings.service';
import { SemanticCatalogService } from './semantic-catalog.service';
import { SemanticController } from './semantic.controller';
import { UserNamesService } from './user-names.service';

@Module({
  imports: [TenancyModule, BitrixModule],
  controllers: [SemanticController],
  providers: [FieldCatalogService, FieldSettingsService, SemanticCatalogService, UserNamesService],
  exports: [FieldCatalogService, FieldSettingsService, UserNamesService],
})
export class SemanticModule {}
