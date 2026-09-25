## ADDED Requirements

### Requirement: Endpoint único verificado
O sistema MUST expor um único endpoint de webhook Stripe para todas as aplicações, recebendo o corpo bruto e verificando `Stripe-Signature` antes de qualquer processamento.

#### Scenario: Assinatura inválida
- **WHEN** chega webhook com assinatura inválida
- **THEN** o sistema responde 400 sem processar

### Requirement: Eventos tratados
O sistema MUST tratar `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded` e `charge.dispute.created`, respondendo 200 e ignorando os demais tipos.

#### Scenario: Evento não tratado
- **WHEN** chega um tipo de evento fora da lista
- **THEN** o sistema responde 200 sem efeitos

### Requirement: Idempotência e processamento assíncrono
O sistema MUST registrar cada `event.id` em `stripe_event`, responder 200 rapidamente e processar o evento em fila com retry, processando cada evento uma única vez.

#### Scenario: Evento repetido
- **WHEN** o Stripe reenvia um evento já processado
- **THEN** o sistema responde 200 sem efeitos adicionais

#### Scenario: Falha no processamento
- **WHEN** o processamento falha por erro transitório do Bitrix
- **THEN** o evento é reprocessado com backoff e, esgotadas as tentativas, fica em dead-letter com alerta

### Requirement: Roteamento por aplicação
O sistema MUST identificar a aplicação pelo `appCode` nos metadados do objeto Stripe (ou da assinatura relacionada) e ignorar eventos de `appCode` não cadastrado ou ainda atendido por outra integração.

#### Scenario: Evento do ThinkZap durante a transição
- **WHEN** chega evento com `appCode = crmthink.thinkzap` e o ThinkZap ainda não foi migrado
- **THEN** o sistema responde 200 sem efeitos
