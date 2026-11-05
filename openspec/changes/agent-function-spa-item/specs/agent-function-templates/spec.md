## ADDED Requirements

### Requirement: Campo de processo inteligente (SPA)
O template MUST poder declarar um campo "Processo inteligente do Bitrix24" com a lista de **valores** que a função grava num item de SPA. Cada valor MUST ter id (único no campo), rótulo, ajuda opcional, se é obrigatório e, opcionalmente, a lista de opções permitidas (ex.: `LOW`, `NORMAL`, `HIGH`, `URGENT`). O template MUST NOT conter códigos de campo do portal (`ufCrm...`), id do SPA, funil nem etapa: tudo isso vem das respostas do cliente. O campo MUST NOT entrar no texto do comportamento nem no orçamento de caracteres.

#### Scenario: Suporte declara os valores do chamado
- **WHEN** o autor cria o campo `suporte.spa` com os valores Origem, Prioridade (opções `LOW`, `NORMAL`, `HIGH`, `URGENT`), Problema relatado, Chat de origem, Diálogo de origem e Sessão de Linhas Abertas
- **THEN** o template é aceito e o formulário do cliente passa a pedir o SPA e o campo de cada um desses valores

#### Scenario: Marcador do campo no comportamento
- **WHEN** o comportamento cita `{{suporte.spa}}`
- **THEN** a publicação do template falha dizendo que o campo de SPA só pode ser usado na ação "Criar item de SPA"

### Requirement: Ação "Criar item de SPA" no template
As intenções do template MUST poder usar a ação "Criar item de SPA", que aponta para um campo de SPA (`spa`, marcador sozinho do campo), traz o título do item e o conteúdo de cada valor (`values`, por id do valor). O conteúdo de cada valor MUST aceitar texto fixo, marcadores do formulário, campos coletados (`{{fields.<campo>}}`) e variáveis da conversa. A publicação do template MUST falhar, nomeando a intenção, quando: `spa` não for o marcador de um campo de SPA; a ação usar um valor que o campo não declara; um valor declarado não for usado por nenhuma ação; ou a ação usar um campo de SPA dependente sem `when` com a opção pai.

#### Scenario: Ação completa
- **WHEN** a intenção "Abrir chamado" tem a ação com `spa: "{{suporte.spa}}"`, `values.origem: "CHAT"`, `values.prioridade: "{{fields.prioridade}}"`, `values.chat: "{{dialog.chatId}}"`, `values.dialogo: "{{dialog.id}}"` e `values.sessao: "{{dialog.sessionId}}"`
- **THEN** a checagem do template passa

#### Scenario: Valor que o campo não declara
- **WHEN** a ação traz `values.canal`, e `suporte.spa` não declara o valor `canal`
- **THEN** a publicação falha dizendo que `canal` não é um valor de `suporte.spa`

#### Scenario: Valor declarado sem uso
- **WHEN** o campo declara `sessao` e nenhuma ação preenche esse valor
- **THEN** a publicação falha dizendo que o valor `sessao` não é usado

### Requirement: Criar item de SPA e transferir
Uma intenção do template MUST poder ter, depois da ação "Criar item de SPA", o passo "Transferir para atendente" (operador livre, usuário escolhido — inclusive vários em rodízio — ou canal aberto), executado na mesma chamada.

#### Scenario: Chamado aberto e conversa transferida
- **WHEN** a intenção "Abrir chamado" cria o item de SPA e tem o passo de transferir para o usuário escolhido no formulário
- **THEN** o item é criado, o agente confirma ao cliente e a conversa passa para esse usuário
