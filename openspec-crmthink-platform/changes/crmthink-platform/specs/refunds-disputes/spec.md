## ADDED Requirements

### Requirement: Estornos
O sistema MUST tratar `charge.refunded` identificando a origem da cobrança (compra avulsa ou fatura de assinatura) e emitir `charge.refunded` com `chargeId`, `source`, `purchaseId` ou `invoiceId`, `amountRefunded` e `amount`, idempotente pelo evento Stripe. O serviço MUST NOT decidir o efeito sobre créditos ou acesso.

#### Scenario: Estorno total de pacote
- **WHEN** o estorno total de uma compra avulsa é registrado no Stripe
- **THEN** a compra fica `refunded` e `charge.refunded` é emitido com `source = purchase`

#### Scenario: Estorno parcial de fatura
- **WHEN** parte de uma fatura de assinatura é estornada
- **THEN** `charge.refunded` é emitido com `source = invoice` e `amountRefunded` menor que `amount`

### Requirement: Contestações
O sistema MUST tratar `charge.dispute.created` emitindo `charge.disputed` com `chargeId`, `source`, `purchaseId` ou `invoiceId` e `amount`, e registrar alerta operacional.

#### Scenario: Contestação no cartão
- **WHEN** o cliente contesta uma cobrança de pacote no banco emissor
- **THEN** `charge.disputed` é emitido para a aplicação dona da compra e operadores são alertados

#### Scenario: Cobrança sem origem conhecida
- **WHEN** a cobrança estornada ou contestada não pertence a nenhuma compra ou assinatura conhecida
- **THEN** nenhum evento é emitido e o caso é registrado para análise manual
