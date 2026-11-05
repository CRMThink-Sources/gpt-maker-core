// API pública do módulo: outros módulos só importam daqui.
export { TrainingModule } from './training.module';
export { type ManagedTrainingGoneListener, TrainingSyncService } from './training-sync.service';
export {
  hashCallbackToken,
  type ManagedAccess,
  type TrainingMediaPolicy,
  TrainingService,
} from './training.service';
