// API pública do módulo: outros módulos só importam daqui.
export { PaymentsModule } from './payments.module';
export { OUTBOX_OPERATIONS, PaymentsOutbox } from './payments-outbox';
