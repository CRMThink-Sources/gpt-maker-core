import { Module } from '@nestjs/common';
import { GptMakerModule } from '../gptmaker';
import { ModelCatalogService } from './model-catalog.service';
import { ModelSeeder } from './model-seed';

@Module({
  imports: [GptMakerModule],
  providers: [ModelCatalogService, ModelSeeder],
  exports: [ModelCatalogService],
})
export class ModelsModule {}
