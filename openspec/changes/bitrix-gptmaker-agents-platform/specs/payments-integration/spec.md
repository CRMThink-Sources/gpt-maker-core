## ADDED Requirements

### Requirement: Pagamentos delegados ao crmthink-platform
O sistema MUST delegar ao módulo `billing` do `crmthink-platform` compartilhado (appCode `crmthink.gptmaker`) toda integração com Stripe e com os SPAs do portal CRMThink (Produtos, Planos, Instalações, Assinaturas, Itens de assinatura). O sistema MUST NOT chamar a API do Stripe nem escrever nos SPAs diretamente. A assinatura tem status `trialing`, `active`, `past_due`, `cancelled` ou `trial_expired` e modalidade `stripe` ou `manual`, conforme o contrato do serviço; o SPA de Assinaturas é a fonte da verdade.

#### Scenario: Chamada ao serviço autenticada
- **WHEN** o backend chama qualquer rota do `crmthink-platform`
- **THEN** a chamada usa a chave de API do app, lida de variável de ambiente, e nunca expõe a chave ao frontend

#### Scenario: Serviço indisponível
- **WHEN** o `crmthink-platform` não responde a uma chamada iniciada pelo usuário (checkout, portal, consulta)
- **THEN** o sistema exibe erro recuperável e não altera o estado local da assinatura

### Requirement: Trial liberado por cadastro
A plataforma MUST NOT criar o trial na instalação (`trial_on_install` desligado no cadastro do app). O sistema MUST oferecer o trial de 14 dias somente ao tenant que nunca teve assinatura na projeção local (nenhum trial ou plano recebido da plataforma); a decisão final é da plataforma, que recusa com `TRIAL_ALREADY_USED` a instalação que já usou trial. Para ativar, um usuário com permissão de administração do app (ver `bitrix-app-installation`) MUST preencher o formulário de cadastro com nome, e-mail, telefone/WhatsApp, empresa e cargo, todos obrigatórios; o backend MUST repassar os dados à plataforma (`POST /v1/installations/{id}/trial`), que valida, grava o contato na instalação (banco e SPA 1060) e cria o trial uma única vez por instalação. O sistema MUST NOT guardar os dados do cadastro nem escrever no portal CRMThink. Os 500 créditos MUST ser concedidos somente ao receber `subscription.trial_started`, nunca pela resposta da chamada de ativação.

#### Scenario: Oferta do trial
- **WHEN** o tenant sem nenhuma assinatura na projeção local abre a tela de planos
- **THEN** a tela oferece "Testar grátis por 14 dias" junto com os planos

#### Scenario: Trial indisponível
- **WHEN** o tenant está em trial, tem assinatura vigente ou já teve trial ou plano encerrado
- **THEN** a tela não oferece o trial e mostra o status atual ou os planos

#### Scenario: Primeira ativação
- **WHEN** o administrador envia o formulário de cadastro válido
- **THEN** o backend solicita o trial à plataforma com os dados do cadastro, a tela mostra ativação em andamento e, ao receber `subscription.trial_started`, o sistema lança `GRANT` de 500 créditos na carteira `TRIAL` com expiração igual ao fim do trial

#### Scenario: Cadastro recusado
- **WHEN** a plataforma recusa os dados do cadastro por validação
- **THEN** a tela mostra os erros de cada campo, mantém o que foi preenchido e nenhum trial é criado

#### Scenario: Envio repetido
- **WHEN** o formulário é enviado duas vezes (clique duplo, retentativa ou duas abas)
- **THEN** existe no máximo um trial e um único `GRANT` de trial; a plataforma responde 201 ao envio que criou o trial e 200 com o mesmo trial aos demais, e a tela trata os dois como ativação em andamento

#### Scenario: Trial já usado
- **WHEN** a plataforma responde `TRIAL_ALREADY_USED`
- **THEN** a tela informa que o período de teste já foi utilizado e mostra os planos, sem conceder créditos

#### Scenario: Assinatura já existente na plataforma
- **WHEN** a plataforma responde `SUBSCRIPTION_ALREADY_EXISTS` (projeção local atrasada)
- **THEN** a tela mostra os planos e o sistema consulta a assinatura na plataforma para atualizar a projeção

#### Scenario: Usuário sem permissão
- **WHEN** um usuário sem permissão de administração do app tenta ativar o trial
- **THEN** o sistema responde 403 e a tela informa que somente o administrador pode ativar o teste

#### Scenario: Reinstalação após trial usado
- **WHEN** um portal que já usou o trial reinstala o app
- **THEN** a projeção local preservada não oferece o trial, a plataforma recusaria nova solicitação com `TRIAL_ALREADY_USED` e o tenant vê a tela de planos

#### Scenario: Trial expirado
- **WHEN** chega `subscription.ended` com motivo `trial_expired`
- **THEN** o sistema expira o saldo positivo das carteiras e inativa os agentes com motivo `SUBSCRIPTION_EXPIRED`

#### Scenario: Assinatura contratada durante o trial
- **WHEN** chega `subscription.activated` para um tenant em trial
- **THEN** o sistema inicia o ciclo do plano pago com `GRANT` dos créditos do plano em `PLAN`; a carteira `TRIAL` permanece até o fim dos 14 dias e então expira por job do app

#### Scenario: Evento de trial atrasado
- **WHEN** o tenant abre o app depois de ativar o trial e antes de chegar `subscription.trial_started`
- **THEN** a tela mostra ativação em andamento e o sistema consulta a assinatura na plataforma até o trial ser confirmado

### Requirement: Recepção de eventos do crmthink-platform
O sistema MUST expor um endpoint HTTPS (`/platform/events`) para os eventos do `crmthink-platform` (billing e instalações), validar o header `X-Platform-Signature` (HMAC-SHA256 com segredo do app, tolerância de 5 minutos), responder 2xx somente após persistir o evento, deduplicar por `eventId` e processar de forma assíncrona. Eventos com `subscription.version` menor que a última versão aplicada para a assinatura MUST ser ignorados.

#### Scenario: Assinatura inválida
- **WHEN** chega evento com assinatura HMAC inválida ou timestamp fora da tolerância
- **THEN** o sistema responde 401 sem processar

#### Scenario: Evento repetido
- **WHEN** o mesmo `eventId` chega novamente
- **THEN** o sistema responde 200 sem efeitos adicionais

#### Scenario: Evento fora de ordem
- **WHEN** chega um evento cuja versão da assinatura é menor que a última aplicada
- **THEN** o sistema registra o evento como obsoleto e não altera o estado da assinatura, exceto eventos financeiros (`purchase.paid`, `charge.refunded`, `charge.disputed`), que são sempre aplicados

### Requirement: Efeitos dos eventos de assinatura
O sistema MUST manter uma projeção local da assinatura do tenant (status, modalidade, plano, período, versão, `grace_until`) atualizada pelos eventos e aplicar os efeitos abaixo, todos idempotentes:
- `subscription.activated` e `subscription.renewed`: virada de ciclo (ver `credit-billing`), limpar carência e reativar agentes inativados por `SUBSCRIPTION_EXPIRED`.
- `subscription.plan_changed` com efeito `immediate`: `GRANT` proporcional da diferença de créditos (`remainingFraction` × (créditos do novo plano − créditos do plano anterior), arredondado para baixo, somente se positivo) e aplicação dos novos limites; com efeito `next_period`: novos limites e créditos a partir da próxima renovação.
- `subscription.past_due`: `grace_until` = momento do evento + 3 dias (configurável) e aviso `PAYMENT_FAILED` aos destinatários de avisos.
- `subscription.recovered`: limpar `grace_until`.
- `subscription.cancel_scheduled`: exibir ao tenant a data de encerramento; nenhum efeito sobre créditos.
- `subscription.ended`: expirar o saldo positivo das carteiras e inativar agentes com motivo `SUBSCRIPTION_EXPIRED`.
- `subscription.period_ending` (somente modalidade `manual`, a 3, 2 e 1 dia do fim): aviso `PERIOD_ENDING` aos destinatários de avisos.

#### Scenario: Carência esgotada
- **WHEN** `grace_until` vence e a assinatura continua `past_due`
- **THEN** os agentes do tenant são inativados com motivo `SUBSCRIPTION_EXPIRED` e as mensagens deixam de ser encaminhadas ao GPTMaker

#### Scenario: Pagamento regularizado na carência
- **WHEN** chega `subscription.recovered` ou `subscription.renewed` antes de `grace_until`
- **THEN** a carência é limpa e nenhum agente é inativado

#### Scenario: Stripe sem aviso prévio
- **WHEN** uma assinatura de modalidade `stripe` se aproxima do fim do ciclo
- **THEN** nenhum aviso de expiração é enviado; o tenant só é avisado se o pagamento falhar

#### Scenario: Upgrade no meio do ciclo
- **WHEN** chega `subscription.plan_changed` imediato de um plano de 1000 para um de 3000 créditos com `remainingFraction` 0,5
- **THEN** o sistema lança `GRANT` de 1000 créditos na carteira `PLAN` e aplica os modelos e limites do novo plano

#### Scenario: Downgrade com modelo não permitido
- **WHEN** um downgrade passa a valer e um agente usa modelo não permitido no novo plano
- **THEN** o agente passa a usar o modelo padrão do catálogo e os destinatários de avisos são notificados

### Requirement: Contratação com Checkout embutido
O sistema MUST permitir ao administrador do tenant contratar um plano ou comprar um pacote de créditos pelo Stripe Checkout embutido na tela do app: o backend solicita a sessão ao serviço (`POST /v1/checkout-sessions`, intent `subscribe` ou `purchase`) e o frontend monta o checkout com o `clientSecret` retornado. A ativação e os créditos MUST ocorrer somente a partir dos eventos do serviço, nunca pelo retorno do checkout no navegador.

#### Scenario: Contratação concluída
- **WHEN** o administrador conclui o pagamento no checkout embutido
- **THEN** a tela mostra "processando" até chegar `subscription.activated`, e então exibe o plano ativo e o saldo

#### Scenario: Assinatura já existente
- **WHEN** o tenant com assinatura `active` ou `past_due` tenta contratar outro plano pelo checkout
- **THEN** o serviço responde `SUBSCRIPTION_ALREADY_EXISTS` e a tela oferece troca de plano

#### Scenario: Aviso de validade na compra de pacote
- **WHEN** o administrador abre a compra de um pacote de créditos
- **THEN** a tela informa que os créditos expiram junto com o plano e exibe a data de fim do ciclo corrente antes de montar o checkout

#### Scenario: Pacote pago
- **WHEN** chega `purchase.paid`
- **THEN** o sistema lança `TOPUP` na carteira `EXTRA` com a quantidade de créditos do pacote, idempotente pelo `purchaseId`

### Requirement: Troca de plano e portal do cliente
O sistema MUST permitir troca de plano de assinaturas `stripe` pelo serviço (`POST /v1/subscriptions/{id}/change-plan`), com upgrade imediato e downgrade no próximo ciclo, e abrir o Stripe Customer Portal em nova janela a partir da sessão criada pelo serviço. Assinaturas `manual` MUST ter plano e período alterados somente no SPA pelo time comercial.

#### Scenario: Abrir portal
- **WHEN** o administrador do tenant clica em "Gerenciar pagamento"
- **THEN** o sistema solicita a sessão ao serviço e abre o Customer Portal em nova janela

#### Scenario: Troca de plano em assinatura manual
- **WHEN** o tenant com assinatura `manual` tenta trocar de plano
- **THEN** a tela informa que a alteração deve ser solicitada ao time comercial

### Requirement: Estornos recebidos do serviço
O sistema MUST aplicar a regra de estorno de créditos (ver `credit-billing`) ao receber `charge.refunded` ou `charge.disputed`, identificando pela origem (`purchase` ou `invoice`) quais créditos a cobrança concedeu.

#### Scenario: Contestação de pacote
- **WHEN** chega `charge.disputed` de uma compra de pacote
- **THEN** o sistema remove os créditos não gastos do pacote e registra os gastos como dedução do próximo ciclo

### Requirement: Agentes espelhados como itens de assinatura
O sistema MUST espelhar cada agente como item de assinatura não cobrável (`billable = false`) no serviço: criar o item ao criar o agente, atualizar status e título ao inativar, reativar ou renomear, e remover ao remover o agente. Falhas no espelhamento MUST NOT bloquear a operação do agente; o sistema MUST reprocessar de forma assíncrona até sincronizar.

#### Scenario: Agente criado
- **WHEN** um agente é criado com sucesso no GPTMaker
- **THEN** o sistema cria o item de assinatura com `externalRef` igual ao id local do agente

#### Scenario: Serviço fora do ar ao criar agente
- **WHEN** a criação do item falha
- **THEN** o agente fica ativo normalmente e o item é criado quando o serviço voltar

### Requirement: Consistência da projeção local
O sistema MUST comparar periodicamente a projeção local com `GET /v1/installations/{id}/subscription` e corrigir divergências, registrando cada correção.

#### Scenario: Evento perdido
- **WHEN** a consulta periódica mostra assinatura `active` com período mais novo que o local
- **THEN** o sistema aplica a virada de ciclo idempotente e registra a correção
