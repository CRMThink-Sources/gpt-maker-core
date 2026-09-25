## ADDED Requirements

### Requirement: Checkout de compra avulsa
O sistema MUST expor `POST /v1/checkout-sessions` com `intent = purchase`, plano `one_time` e `quantity` opcional, criando Stripe Checkout em `mode=payment`, `ui_mode` embutido, somente cartão e BRL, com metadados `{appCode, installationId, planId, intent}`, registrando a compra como pendente e retornando `clientSecret`.

#### Scenario: Compra de pacote
- **WHEN** a aplicação GPTMaker pede checkout `purchase` de um pacote de créditos
- **THEN** o sistema cria a sessão, registra a compra pendente e retorna o `clientSecret`

#### Scenario: Compra sem assinatura ativa
- **WHEN** a instalação não possui assinatura `active` ou `trialing`
- **THEN** o sistema recusa com erro `NO_ACTIVE_SUBSCRIPTION`

### Requirement: Confirmação da compra
O sistema MUST confirmar a compra ao receber `checkout.session.completed` com `mode = payment` e `payment_status = paid`, gravando `chargeId` e valor, idempotente pela sessão, e emitir `purchase.paid` com `purchaseId`, `planId`, `quantity`, `chargeId` e `amount`.

#### Scenario: Pagamento confirmado
- **WHEN** o Stripe confirma o pagamento do pacote
- **THEN** a compra fica `paid` e `purchase.paid` é emitido uma única vez

#### Scenario: Sessão expirada
- **WHEN** a sessão de checkout expira sem pagamento
- **THEN** a compra fica `expired` e nenhum evento é emitido
