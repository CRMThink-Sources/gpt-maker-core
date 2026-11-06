import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents';
import { GptMakerModule } from '../gptmaker';
import { TenancyModule } from '../tenancy';
import { TrainingCallbackController } from './training-callback.controller';
import { TrainingImageController } from './training-image.controller';
import { TrainingImageService } from './training-image.service';
import { TrainingService } from './training.service';
import { TrainingSyncService } from './training-sync.service';
import { TrainingsController } from './trainings.controller';

@Module({
  imports: [TenancyModule, AgentsModule, GptMakerModule],
  controllers: [TrainingsController, TrainingCallbackController, TrainingImageController],
  providers: [TrainingService, TrainingImageService, TrainingSyncService],
  exports: [TrainingService, TrainingImageService, TrainingSyncService],
})
export class TrainingModule {}
