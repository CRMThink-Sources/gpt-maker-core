## ADDED Requirements

### Requirement: Envelope de evento
Todo evento para aplicações MUST ter o envelope `{eventId, type, appCode, installationId, memberId, occurredAt, subscription, data}`, onde `subscription` é `{id, status, modality, planId, periodStart, periodEnd, version}` ou `null`. Os tipos MUST ser: `installation.created`, `installation.reinstalled`, `installation.removed`, `installation.auth_error`, `installation.auth_restored` (sempre com `subscription: null`), `subscription.trial_started`, `subscription.activated`, `subscription.renewed`, `subscription.plan_changed`, `subscription.past_due`, `subscription.recovered`, `subscription.cancel_scheduled`, `subscription.ended`, `subscription.period_ending`, `purchase.paid`, `charge.refunded` e `charge.disputed`.

#### Scenario: Evento de instalação
- **WHEN** um portal desinstala o app
- **THEN** o evento `installation.removed` traz o envelope com `installationId`, `memberId`, `subscription: null` e `data` vazio

#### Scenario: Evento de renovação
- **WHEN** uma assinatura é renovada
- **THEN** o evento `subscription.renewed` traz o envelope completo com o novo período e `data.invoiceId`

### Requirement: Outbox transacional
O sistema MUST gravar cada evento no outbox na mesma transação que registra a decisão que o originou, e somente então entregá-lo.

#### Scenario: Queda após a decisão
- **WHEN** o processo cai depois de gravar a decisão e antes de entregar o evento
- **THEN** o worker entrega o evento pendente ao reiniciar

### Requirement: Entrega assinada
O sistema MUST entregar cada evento por `POST` na URL de webhook da aplicação, com corpo JSON e header `X-Platform-Signature: t=<unix>,v1=<hmac-sha256(segredo, t + "." + corpo)>`. As aplicações MUST rejeitar assinaturas com mais de 5 minutos. O mesmo esquema de assinatura MUST ser usado na chamada síncrona ao instalador do app.

#### Scenario: Entrega bem-sucedida
- **WHEN** a aplicação responde 2xx
- **THEN** a entrega é marcada como concluída

### Requirement: Reenvio, dead-letter e reenvio manual
O sistema MUST reenviar entregas com falha (não 2xx ou timeout) com backoff exponencial por até 24 horas, depois mover para dead-letter com alerta operacional, e permitir reenvio manual de eventos individuais ou de um intervalo por aplicação.

#### Scenario: Aplicação fora do ar
- **WHEN** a aplicação fica indisponível por 2 horas
- **THEN** os eventos acumulados são entregues quando ela volta, dentro da janela de 24 horas

#### Scenario: Janela esgotada
- **WHEN** um evento falha por mais de 24 horas
- **THEN** o evento vai para dead-letter, operadores são alertados e o evento pode ser reenviado manualmente

### Requirement: Garantias de entrega e ordenação
A entrega MUST ser pelo menos uma vez, com `eventId` estável entre tentativas, e cada evento de assinatura MUST carregar `subscription.version` crescente por assinatura. As aplicações MUST deduplicar por `eventId` e ignorar eventos com versão menor que a última aplicada.

#### Scenario: Evento duplicado
- **WHEN** um evento é entregue duas vezes por timeout na primeira resposta
- **THEN** ambas as entregas têm o mesmo `eventId`

#### Scenario: Eventos fora de ordem
- **WHEN** `subscription.past_due` com versão 5 chega depois de `subscription.recovered` com versão 6
- **THEN** a aplicação ignora o evento de versão 5
