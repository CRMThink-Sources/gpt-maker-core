# notification-i18n Specification

## Purpose
TBD - created by archiving change add-i18n-pt-br-en-es. Update Purpose after archive.

## Requirements

### Requirement: Locale do tenant
Cada tenant SHALL ter um `locale` (`pt-BR`, `en` ou `es`), com padrão `pt-BR`, alterado somente quando um administrador do portal troca o idioma explicitamente no app (abrir o app não o altera).

#### Scenario: Tenant existente após a migration
- **WHEN** a migration é aplicada
- **THEN** todo tenant existente fica com `locale = pt-BR`

#### Scenario: Usuário troca o idioma
- **WHEN** um administrador do tenant altera o idioma no app
- **THEN** o `locale` do tenant é atualizado, filtrado pelo `tenantId` da sessão

### Requirement: Notificações no idioma do tenant
As notificações Bitrix (`credit80`, `creditZero`, `paymentFailed`, `periodEnding`, `modelDowngraded`) SHALL ser emitidas no `locale` do tenant, com datas formatadas nesse idioma.

#### Scenario: Alerta de 80% em espanhol
- **WHEN** o consumo atinge 80% e o tenant tem `locale = es`
- **THEN** a notificação enviada ao Bitrix está em espanhol

### Requirement: Aviso de falta de créditos no canal
O aviso enviado ao cliente final quando faltam créditos SHALL usar o `locale` do tenant.

#### Scenario: Sem créditos em inglês
- **WHEN** chega mensagem e o tenant sem créditos tem `locale = en`
- **THEN** o aviso é enviado em inglês
