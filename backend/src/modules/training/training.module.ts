import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents';
import { GptMakerModule } from '../gptmaker';
import { TenancyModule } from '../tenancy';
import { DocumentUploadInterceptor } from './document-upload.interceptor';
import { TrainingService } from './training.service';
import { TrainingsController } from './trainings.controller';

@Module({
  imports: [TenancyModule, AgentsModule, GptMakerModule],
  controllers: [TrainingsController],
  providers: [TrainingService, DocumentUploadInterceptor],
  exports: [TrainingService],
})
export class TrainingModule {}
