## ADDED Requirements

### Requirement: Planos
Nome, preço, intervalo e preço no Stripe dos planos MUST vir do SPA de Planos via `crmthink-platform` (`GET /v1/plans`). O sistema MUST manter localmente, por id do plano no SPA, os direitos específicos do GPTMaker: créditos incluídos por ciclo, modelos permitidos e limites de treinamento; e, para planos `one_time` (pacotes, planos do produto avulso "Créditos GPTMaker"), a quantidade de créditos do pacote. Plano sem direitos cadastrados MUST NOT ser exibido ao tenant. O número de agentes não varia por plano (limite fixo por tenant, ver `gptmaker-workspace`) e agentes não são cobrados individualmente. Créditos do cliente MUST equivaler 1:1 a créditos do GPTMaker; a margem comercial fica embutida no preço do plano.

#### Scenario: Plano disponível ao tenant
- **WHEN** o tenant abre a tela de planos
- **THEN** o sistema lista os planos ativos do serviço que têm direitos cadastrados, com créditos, limites, modelos permitidos e preço

#### Scenario: Plano sem direitos cadastrados
- **WHEN** o serviço retorna um plano sem direitos cadastrados localmente
- **THEN** o plano não é exibido ao tenant e o backoffice sinaliza a pendência

### Requirement: Carteiras de créditos
O sistema MUST manter o saldo do tenant em três carteiras: `TRIAL` (créditos do trial, expiram no fim do trial), `PLAN` (créditos do plano) e `EXTRA` (créditos adicionais comprados ou concedidos). `PLAN` e `EXTRA` expiram juntas ao fim de cada ciclo da assinatura. Débitos MUST consumir na ordem `TRIAL`, `PLAN`, `EXTRA`. O saldo disponível é a soma das três carteiras.

#### Scenario: Débito com saldo em mais de uma carteira
- **WHEN** o tenant tem 10 créditos em `PLAN` e 100 em `EXTRA` e uma resposta custa 3
- **THEN** o débito sai de `PLAN`, que fica com 7, e `EXTRA` permanece 100

#### Scenario: Débito que atravessa as carteiras
- **WHEN** o tenant tem 2 créditos em `PLAN` e 100 em `EXTRA` e uma resposta custa 3
- **THEN** o sistema lança débito de 2 em `PLAN` e de 1 em `EXTRA`

#### Scenario: Saldo negativo
- **WHEN** um débito ou ajuste excede o saldo de todas as carteiras
- **THEN** o valor excedente fica negativo na carteira `PLAN`; `TRIAL` e `EXTRA` nunca ficam negativas

### Requirement: Concessão e expiração de créditos por ciclo
O sistema MUST, a cada início de ciclo de assinatura confirmado pelo `crmthink-platform` (eventos `subscription.activated` e `subscription.renewed`, ver `payments-integration`), lançar `EXPIRE` do saldo positivo remanescente das carteiras `PLAN` e `EXTRA` do ciclo anterior e `GRANT` na carteira `PLAN` igual aos créditos do plano. Saldo negativo da carteira `PLAN` MUST ser abatido do novo `GRANT`. O `GRANT` e os `EXPIRE` MUST ser idempotentes por (assinatura, período). Créditos `EXTRA` lançados durante o ciclo MUST expirar ao fim do mesmo ciclo.

#### Scenario: Início de ciclo
- **WHEN** um novo ciclo começa com 300 créditos restantes em `PLAN`, 50 em `EXTRA` e plano de 1000 créditos
- **THEN** o sistema lança `EXPIRE` de 300 em `PLAN`, `EXPIRE` de 50 em `EXTRA` e `GRANT` de 1000 em `PLAN`; `EXTRA` fica zerada

#### Scenario: Ciclo anterior com saldo negativo
- **WHEN** um novo ciclo começa com `PLAN` em -20 e plano de 1000 créditos
- **THEN** a carteira `PLAN` do novo ciclo fica com 980

#### Scenario: Confirmação duplicada do ciclo
- **WHEN** a confirmação do mesmo período chega mais de uma vez
- **THEN** apenas um `GRANT` é lançado

#### Scenario: Assinatura encerrada
- **WHEN** a assinatura é cancelada ou expira sem renovação
- **THEN** o saldo positivo de `PLAN` e de `EXTRA` expira ao fim do período pago

### Requirement: Créditos do trial
O sistema MUST conceder 500 créditos na carteira `TRIAL` ao início do trial de 14 dias, com expiração no fim do trial. Os créditos do trial MUST permanecer disponíveis até o fim dos 14 dias mesmo que o tenant contrate um plano antes, e MUST expirar (`EXPIRE` do saldo positivo de `TRIAL`) no fim do trial, independentemente do status da assinatura. A virada de ciclo do plano MUST NOT afetar a carteira `TRIAL`.

#### Scenario: Plano contratado durante o trial
- **WHEN** o tenant no dia 5 do trial, com 300 créditos em `TRIAL`, contrata um plano de 1000 créditos
- **THEN** o sistema lança `GRANT` de 1000 em `PLAN`, `TRIAL` continua com 300 e os débitos consomem `TRIAL` primeiro

#### Scenario: Fim do trial com plano ativo
- **WHEN** chega o fim dos 14 dias e o tenant já tem plano `active` com 150 créditos restantes em `TRIAL`
- **THEN** o sistema lança `EXPIRE` de 150 em `TRIAL` e o plano segue sem alteração

#### Scenario: Trial consumido antes do fim
- **WHEN** o tenant em trial consome os 500 créditos antes dos 14 dias
- **THEN** as mensagens deixam de ser encaminhadas ao GPTMaker até a contratação de um plano

#### Scenario: Pacote durante o trial
- **WHEN** o tenant em trial, sem plano contratado, tenta comprar pacote avulso
- **THEN** a compra é recusada; pacotes exigem assinatura `active`

### Requirement: Créditos adicionais
O sistema MUST lançar na carteira `EXTRA` os créditos de pacotes avulsos pagos e as concessões feitas pelo backoffice. Esses créditos valem até o fim do ciclo corrente da assinatura.

#### Scenario: Pacote avulso pago
- **WHEN** a compra de um pacote avulso é confirmada
- **THEN** o sistema lança `TOPUP` na carteira `EXTRA` e o saldo é atualizado imediatamente

#### Scenario: Concessão pelo backoffice
- **WHEN** um operador concede créditos ao tenant
- **THEN** o sistema lança `TOPUP` na carteira `EXTRA` com autor e justificativa

### Requirement: Ledger imutável e saldo
O sistema MUST registrar toda movimentação de créditos em ledger append-only (`GRANT`, `TOPUP`, `DEBIT`, `ADJUSTMENT`, `EXPIRE`, `REFUND`), cada lançamento associado a uma carteira (`TRIAL`, `PLAN` ou `EXTRA`), e calcular o saldo de cada carteira como soma dos seus lançamentos, mantendo cache do saldo consistente com o ledger. Ajustes positivos da reconciliação MUST ir para a carteira `PLAN` do ciclo corrente.

#### Scenario: Consulta de saldo
- **WHEN** o tenant consulta seu saldo
- **THEN** o sistema retorna saldo do trial (com fim do trial), saldo do plano, saldo adicional, saldo total, data de expiração de plano e adicional (fim do ciclo), créditos consumidos no ciclo e data de renovação

#### Scenario: Correção de lançamento
- **WHEN** um lançamento precisa ser corrigido
- **THEN** o sistema cria lançamento compensatório (`ADJUSTMENT` ou `REFUND`) sem alterar ou apagar o original

### Requirement: Débito por resposta com créditos reais
O sistema MUST debitar do saldo, para cada resposta entregue pelo agente, o custo por resposta do modelo do agente vigente no catálogo de modelos (ver `ai-model-catalog`), guardando no lançamento o modelo e o custo usados. O débito MUST ser idempotente por mensagem. Diferenças para o consumo real são corrigidas pela reconciliação diária.

#### Scenario: Resposta entregue
- **WHEN** uma resposta do GPTMaker é entregue ao Bitrix
- **THEN** o sistema lança `DEBIT` com o custo por resposta do modelo do agente, referenciando agente, modelo, diálogo e mensagem

#### Scenario: Reprocessamento da mesma mensagem
- **WHEN** o evento de consumo da mesma mensagem é processado novamente
- **THEN** nenhum débito adicional é lançado

#### Scenario: Mensagem não respondida
- **WHEN** o processamento falha e nenhuma resposta é entregue
- **THEN** nenhum débito é lançado

### Requirement: Alertas de consumo
O sistema MUST notificar os destinatários de avisos do tenant (ver requisito de destinatários) quando o saldo atingir 80% e 100% de consumo dos créditos do ciclo.

#### Scenario: 80% consumido
- **WHEN** o consumo do ciclo ultrapassa 80% dos créditos disponíveis
- **THEN** o sistema envia uma única notificação de alerta para os destinatários de avisos naquele ciclo

#### Scenario: Saldo zerado
- **WHEN** o saldo chega a zero ou menos
- **THEN** o sistema notifica os destinatários de avisos e passa a bloquear o encaminhamento de mensagens ao GPTMaker, com mensagem de sistema no diálogo (ver `bitrix-chatbot-channel`)

### Requirement: Destinatários de avisos
O sistema MUST oferecer ao tenant uma tela dedicada para configurar os usuários do portal que recebem os avisos do app (consumo 80%/100%, saldo zerado, falha de pagamento, fim de período de assinaturas `manual`, troca de modelo por downgrade). Os avisos MUST ser enviados como notificação do Bitrix via `im.notify.system.add`, uma por destinatário. Sem destinatários configurados, os avisos MUST ir para os administradores do portal.

#### Scenario: Destinatários configurados
- **WHEN** o administrador do tenant seleciona usuários na tela de avisos e um aviso é disparado
- **THEN** cada usuário selecionado recebe a notificação no Bitrix

#### Scenario: Nenhum destinatário configurado
- **WHEN** um aviso é disparado e não há destinatários configurados
- **THEN** a notificação é enviada aos administradores do portal

#### Scenario: Usuário desativado no portal
- **WHEN** um destinatário configurado foi desativado no Bitrix
- **THEN** o envio para ele é ignorado, os demais recebem normalmente e, se nenhum restar, vale a regra dos administradores

### Requirement: Estorno de pagamento
O sistema MUST tratar estorno (reembolso ou contestação no cartão) de uma cobrança (eventos `charge.refunded` e `charge.disputed` do `crmthink-platform`) removendo os créditos ainda não gastos daquela cobrança e registrando os créditos já gastos como dedução a ser abatida do `GRANT` do próximo ciclo do plano. A dedução MUST ser idempotente pelo id da cobrança estornada. Se a dedução exceder o `GRANT` do próximo ciclo, o restante MUST ser abatido nos ciclos seguintes. Sem assinatura ativa, a dedução MUST permanecer pendente e ser abatida no primeiro `GRANT` de uma nova assinatura do tenant.

#### Scenario: Estorno de pacote com parte gasta
- **WHEN** um pacote de 500 créditos é estornado e o tenant ainda tem 200 créditos desse pacote na carteira `EXTRA`
- **THEN** o sistema lança `REFUND` de 200 em `EXTRA` e registra dedução de 300 para o próximo ciclo

#### Scenario: Aplicação da dedução no novo ciclo
- **WHEN** um novo ciclo começa com plano de 1000 créditos e dedução pendente de 300
- **THEN** o sistema lança `GRANT` de 1000 e `ADJUSTMENT` de -300 em `PLAN`, referenciando o estorno, e a carteira `PLAN` fica com 700

#### Scenario: Estorno com assinatura cancelada
- **WHEN** há dedução pendente e o tenant não tem assinatura ativa
- **THEN** a dedução fica guardada e é abatida no primeiro `GRANT` quando o tenant assinar novamente

#### Scenario: Estorno repetido
- **WHEN** o evento de estorno da mesma cobrança é recebido novamente
- **THEN** nenhum lançamento ou dedução adicional é criado

### Requirement: Extrato de consumo para o tenant
O sistema MUST exibir ao tenant extrato de lançamentos e consumo por agente e por dia no ciclo atual e em ciclos anteriores.

#### Scenario: Extrato por agente
- **WHEN** o administrador filtra o extrato por agente e período
- **THEN** o sistema mostra créditos consumidos e quantidade de respostas por dia daquele agente
