import { TenancyModule } from './tenancy';
import { BitrixModule } from './bitrix';
import { GptMakerModule } from './gptmaker';
import { ModelsModule } from './models';
import { SemanticModule } from './semantic';
import { AgentsModule } from './agents';
import { TrainingModule } from './training';
import { IntentionsModule } from './intentions';
import { ChannelModule } from './channel';
import { TriggersModule } from './triggers';
import { NotificationsModule } from './notifications';
import { BillingModule } from './billing';
import { PaymentsModule } from './payments';
import { ReconciliationModule } from './reconciliation';
import { BackofficeModule } from './backoffice';

/** Módulos de domínio, carregados pelos dois papéis. */
export const DOMAIN_MODULES = [
  TenancyModule,
  BitrixModule,
  GptMakerModule,
  ModelsModule,
  SemanticModule,
  AgentsModule,
  TrainingModule,
  IntentionsModule,
  ChannelModule,
  TriggersModule,
  NotificationsModule,
  BillingModule,
  PaymentsModule,
  ReconciliationModule,
  BackofficeModule,
];
