// Tabelas por domínio. Ficam em shared/ porque os módulos não podem depender uns dos outros
// e as chaves estrangeiras cruzam domínios; cada módulo acessa só as tabelas que são suas.
export * from './agents';
export * from './backoffice';
export * from './billing';
export * from './models';
export * from './notifications';
export * from './payments';
export * from './reconciliation';
export * from './tenancy';
export * from './triggers';
