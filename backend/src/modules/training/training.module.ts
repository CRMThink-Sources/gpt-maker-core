import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents';
import { GptMakerModule } from '../gptmaker';
import { TenancyModule } from '../tenancy';
import { DocumentUploadInterceptor } from './document-upload.interceptor';
import { TrainingCallbackController } from './training-callback.controller';
import { TrainingService } from './training.service';
import { TrainingSyncService } from './training-sync.service';
import { TrainingsController } from './trainings.controller';

@Module({
  imports: [TenancyModule, AgentsModule, GptMakerModule],
  controllers: [TrainingsController, TrainingCallbackController],
  providers: [TrainingService, TrainingSyncService, DocumentUploadInterceptor],
  exports: [TrainingService],
})
export class TrainingModule {}
