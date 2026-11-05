## ADDED Requirements

### Requirement: Criar item de SPA pela intenção
A intenção "Ação no Bitrix24" MUST suportar a ação "Criar item de SPA": cria um item no processo inteligente informado (`entityTypeId`), no funil e etapa informados, com o título e os campos mapeados, e devolve ao agente o id do item. Para um campo do tipo lista, o app MUST enviar o id do item da lista: primeiro pela ligação informada na ação; sem ela, pelo item cujo valor ou id externo coincide com o texto (sem diferenciar maiúsculas). Valor vazio MUST ficar de fora do item. Valor de lista sem correspondência MUST ficar de fora, com o item criado assim mesmo e um aviso no resultado da ação.

#### Scenario: Chamado criado no SPA
- **WHEN** o agente usa "Abrir chamado" com prioridade `HIGH` e o problema relatado, e a ação mapeia Prioridade para um campo lista ligado a `HIGH → 103`
- **THEN** o app cria o item no SPA com a prioridade `103` e os demais campos, e responde ao agente com o id do item

#### Scenario: Prioridade fora da lista
- **WHEN** o agente envia a prioridade `ALTA`, que não corresponde a nenhum item da lista
- **THEN** o item é criado sem a prioridade e o resultado da ação traz o aviso

#### Scenario: SPA inexistente ou sem permissão
- **WHEN** o Bitrix24 recusa a criação (SPA removido, etapa inválida, sem permissão)
- **THEN** a ação falha com a mensagem do Bitrix24 e os passos seguintes da intenção continuam

### Requirement: Chat e sessão da Linha Aberta nas ações
Os textos das ações MUST aceitar `{{dialog.chatId}}`, o id numérico do chat da Linha Aberta (`9498` para o diálogo `chat9498`), e `{{dialog.sessionId}}`, o id da sessão atual da Linha Aberta daquele chat. `{{dialog.id}}` MUST continuar sendo o diálogo com o prefixo (`chat9498`). Sem diálogo identificado, as três variáveis MUST ficar vazias. A sessão MUST ser lida do Bitrix24 só quando alguma ação da execução a usar.

#### Scenario: Chat e diálogo no chamado
- **WHEN** a conversa é o diálogo `chat9498` e a ação grava `{{dialog.chatId}}` e `{{dialog.id}}`
- **THEN** os campos recebem `9498` e `chat9498`

#### Scenario: Sessão da Linha Aberta
- **WHEN** a ação grava `{{dialog.sessionId}}` numa conversa cuja sessão atual é `1932`
- **THEN** o campo recebe `1932`

#### Scenario: Conversa sem diálogo identificado
- **WHEN** a chamada da intenção não identifica o diálogo do Bitrix24
- **THEN** as variáveis do diálogo ficam vazias e os campos correspondentes ficam de fora do item
