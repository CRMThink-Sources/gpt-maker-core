## ADDED Requirements

### Requirement: Modelo de assinatura no SPA
Cada assinatura MUST existir como item do SPA 1142 vinculado à instalação (`parentId1060`), com plano, status (`trialing`, `active`, `past_due`, `cancelled`, `trial_expired`), modalidade (`stripe` ou `manual`), início e fim do período e ID da assinatura Stripe quando `stripe`. Cada instalação MUST ter no máximo uma assinatura não encerrada.

#### Scenario: Consultar assinatura corrente
- **WHEN** a aplicação chama `GET /v1/installations/{id}/subscription`
- **THEN** o sistema retorna status, modalidade, plano, período, `cancelAtPeriodEnd`, dados de trial e versão atual

### Requirement: Trial
O sistema MUST criar automaticamente, quando a instalação de um app com `trial_on_install` fica `ACTIVE` pela primeira vez (ver `bitrix-installation`), uma assinatura `trialing` sem ID de gateway, com fim do período igual a agora mais a duração de trial da aplicação, uma única vez por instalação, e emitir `subscription.trial_started`. A rota `POST /v1/installations/{id}/trial` MUST existir apenas como rota administrativa, com credencial de operador, para casos excepcionais. Ao fim do trial sem assinatura paga, o sistema MUST marcar `trial_expired` e emitir `subscription.ended` com `reason = trial_expired`.

#### Scenario: Iniciar trial
- **WHEN** uma instalação nova do GPTMaker (trial de 14 dias, `trial_on_install`) fica `ACTIVE`
- **THEN** o sistema cria a assinatura `trialing` com fim em 14 dias e emite `subscription.trial_started` com `trialEndsAt`

#### Scenario: Trial repetido
- **WHEN** uma instalação que já usou trial é reinstalada, ou um operador tenta iniciar trial nela pela rota administrativa
- **THEN** nenhum trial é criado; a rota administrativa responde `TRIAL_ALREADY_USED`

#### Scenario: Trial expirado
- **WHEN** o job de expiração encontra trial vencido sem assinatura paga
- **THEN** a assinatura fica `trial_expired` e o evento `subscription.ended` é emitido

### Requirement: Checkout embutido de assinatura
O sistema MUST expor `POST /v1/checkout-sessions` com `intent = subscribe` criando Stripe Checkout em `mode=subscription`, `ui_mode` embutido e `redirect_on_completion = never`, somente cartão e BRL, com metadados `{appCode, installationId, planId, intent}` na sessão e em `subscription_data`, e retornar `clientSecret`.

#### Scenario: Criar sessão
- **WHEN** a aplicação pede checkout `subscribe` para uma instalação sem assinatura paga
- **THEN** o sistema retorna o `clientSecret` para o app renderizar o Checkout embutido

#### Scenario: Assinatura já existente
- **WHEN** a instalação já possui assinatura `active` ou `past_due`
- **THEN** o sistema recusa com erro `SUBSCRIPTION_ALREADY_EXISTS`

### Requirement: Ativação
O sistema MUST ativar a assinatura quando o Stripe confirmar o checkout e o pagamento da primeira fatura (ou quando um item `manual` passar a `active` no SPA), criando ou atualizando o item do SPA 1142 de forma idempotente pelo ID da assinatura Stripe, encerrando o trial corrente e emitindo `subscription.activated`.

#### Scenario: Ativação durante o trial
- **WHEN** uma instalação em `trialing` conclui o checkout e a primeira fatura é paga
- **THEN** a assinatura fica `active` com o período do Stripe e o evento `subscription.activated` é emitido uma única vez

#### Scenario: Falha parcial na ativação
- **WHEN** a gravação no SPA falha após o pagamento
- **THEN** o evento Stripe é reprocessado com retry e a varredura corrige o SPA, sem exigir ação manual no CRM

### Requirement: Renovação
O sistema MUST emitir `subscription.renewed` a cada novo período pago: `invoice.paid` com `billing_reason = subscription_cycle` para `stripe`, ou fim do período estendido no SPA para `manual`, idempotente por (assinatura, início do período).

#### Scenario: Renovação Stripe
- **WHEN** chega `invoice.paid` de ciclo
- **THEN** o SPA recebe o novo período e `subscription.renewed` é emitido com `invoiceId` e `previousPeriodEnd`

#### Scenario: Renovação manual
- **WHEN** um operador ou automação estende o fim do período de uma assinatura `manual` no SPA
- **THEN** `subscription.renewed` é emitido para o novo período

### Requirement: Inadimplência e recuperação
O sistema MUST marcar `past_due` e emitir `subscription.past_due` em `invoice.payment_failed` (com link da fatura) ou quando uma assinatura `manual` for movida para `past_due` no SPA, e emitir `subscription.recovered` quando voltar a `active` sem novo período. O serviço MUST NOT aplicar carência ou corte; isso cabe a cada aplicação.

#### Scenario: Pagamento falhou
- **WHEN** chega `invoice.payment_failed`
- **THEN** o SPA fica `past_due` e `subscription.past_due` é emitido com `hostedInvoiceUrl`

#### Scenario: Pagamento regularizado
- **WHEN** uma assinatura `past_due` volta a `active` no mesmo período
- **THEN** `subscription.recovered` é emitido

### Requirement: Cancelamento e encerramento
O sistema MUST emitir `subscription.cancel_scheduled` quando o cancelamento for agendado para o fim do período e `subscription.ended` quando a assinatura terminar efetivamente (`customer.subscription.deleted`, fim do período cancelado ou remoção do item `manual` no SPA), marcando `cancelled` no SPA.

#### Scenario: Cancelamento pelo Customer Portal
- **WHEN** o cliente cancela no Customer Portal com efeito no fim do período
- **THEN** `subscription.cancel_scheduled` é emitido com `effectiveAt` e, ao fim do período, `subscription.ended` com `reason = cancelled`

#### Scenario: Assinatura manual removida
- **WHEN** um item `manual` do SPA 1142 é removido
- **THEN** `subscription.ended` é emitido com `reason = deleted`

### Requirement: Customer Portal
O sistema MUST expor `POST /v1/billing-portal-sessions` resolvendo o cliente Stripe pela assinatura da instalação no servidor e retornando a URL do Customer Portal.

#### Scenario: Instalação sem assinatura Stripe
- **WHEN** a instalação não possui assinatura `stripe`
- **THEN** o sistema recusa com erro `NO_GATEWAY_SUBSCRIPTION`

### Requirement: Troca de plano
O sistema MUST expor `POST /v1/subscriptions/{id}/change-plan` apenas para assinaturas `stripe`: upgrade com efeito imediato e `proration_behavior = always_invoice`, emitindo `subscription.plan_changed` com `effective = immediate` e `remainingFraction` após o pagamento; downgrade agendado para o próximo ciclo, emitindo `subscription.plan_changed` com `effective = next_period` quando efetivado.

#### Scenario: Upgrade pago
- **WHEN** a fatura proporcional do upgrade é paga
- **THEN** o SPA passa ao novo plano e `subscription.plan_changed` é emitido com a fração restante do período

#### Scenario: Troca em assinatura manual
- **WHEN** a aplicação pede troca de plano de assinatura `manual`
- **THEN** o sistema recusa com erro `MANUAL_SUBSCRIPTION` (troca feita no SPA)

### Requirement: Aviso de fim de período para modalidade manual
O sistema MUST emitir `subscription.period_ending` com `daysLeft` 3, 2 e 1 para assinaturas `manual` ativas cujo fim do período não foi estendido, uma única vez por marco e período. Assinaturas `stripe` MUST NOT gerar esse evento.

#### Scenario: Faltam 3 dias
- **WHEN** o job diário encontra assinatura `manual` com fim do período em 3 dias
- **THEN** o evento é emitido com `daysLeft = 3` e não é emitido novamente para o mesmo marco e período

#### Scenario: Período estendido antes do marco
- **WHEN** o período é estendido antes do marco de 1 dia
- **THEN** o aviso de 1 dia do período anterior não é emitido
