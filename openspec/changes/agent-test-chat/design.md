## Context

- Motivação: ver `proposal.md`. Requisitos: `specs/agent-test-chat/spec.md` e o requisito modificado em `specs/agent-crm-tools/spec.md`.
- Canal atual (`backend/src/modules/channel`): `InboundGate.check` (agente e tenant ativos, atendimento humano, `BalanceReader.total(tenantId) > 0`) → `ConversationService.ask` → `GptMakerClient.sendMessage(agentId, { contextId, chatName, prompt })`, síncrono, timeout `GPTMAKER_CONVERSATION_TIMEOUT_MS` (60 s), sem retry → `ReplyPublisher` entrega no Bitrix e publica `usage.response` em `usage.events` → `UsageDebitConsumer` debita `ai_model.creditsPerResponse` com chave `msg:<messageId>` (idempotente), `refType: 'message'`.
- `contextId` vira o chat do GPTMaker `public-api-<agente>-<contextId>`; cada `contextId` mantém a memória da conversa. O GPTMaker não tem rota para apagar chat ou contexto.
- Webhooks do agente (`onNewMessage`, `onFinishInteraction`...) chegam em `triggers/agent-event.intake.ts`, que extrai o diálogo do `contextId` e publica para os gatilhos. Intenções `BITRIX` (`intentions/intention-runner.ts`) executam ações no portal com o diálogo de `{{chat_id}}`. Ambos rodariam também em conversas de teste.
- Intenção de sistema do CRM (`crm-tools`): `identifyClient(chat)` → `dialogFromChat` → `imopenlines.dialog.get`.
- Frontend: cabeçalho do agente em `frontend/src/app/app/agents/[id]/layout.tsx` (`PageHeader` com `aside`); `Modal` em `components/modal.tsx` (largura fixa `max-w-2xl`).

## Goals / Non-Goals

**Goals:**
- Reaproveitar o caminho do canal para conversa e débito, sem duplicar regras de custo.
- Teste fiel ao comportamento real (mesmo agente, mesmas intenções e ferramentas), sem efeitos no portal.

**Non-Goals:**
- Fila assíncrona e streaming de resposta (o envio é síncrono, como o canal).
- Anexos e mídia; testar agente inativo; compartilhar conversas de teste entre usuários (todo gerente do tenant vê as conversas do agente).

## Decisions

### T1. Módulo `agent-test` e tabelas
`backend/src/modules/agent-test/` com:
- `agent_test_conversation(id uuid PK, tenant_id, agent_id, context_id UNIQUE, client_type NULL ('contact'|'lead'|'company'), client_id NULL, client_name NULL, created_by_user_id, created_by_name, last_message_at, created_at)`, índice `(agent_id, last_message_at desc)`.
- `agent_test_message(id uuid PK, conversation_id FK ON DELETE CASCADE, role ('USER'|'AGENT'), text, status ('ANSWERED'|'FAILED' para USER; 'DELIVERED' para AGENT), model_code NULL, created_at)`.
- Exclusão física (conversa + mensagens em cascata): o histórico é do testador, não auditoria financeira; o débito fica no ledger.
- Limite de 50 por agente: ao criar, apaga as mais antigas além de 49 na mesma transação.

### T2. Contexto e identificação
- `context_id = "<tenantId>:test-<conversationId>"`; o chat no GPTMaker fica `public-api-<agente>-<tenantId>:test-<uuid>`, e `dialogFromChat` devolve `test-<uuid>`. O prefixo `test-` identifica a conversa de teste em todo o backend (função única `testConversationIdFrom(dialogId)` exportada pelo módulo).
- `chatName = "Teste — <nome do usuário>"` (aparece no painel do GPTMaker para a equipe distinguir).
- Excluir não apaga nada no GPTMaker; como o id é um UUID novo por conversa, o contexto nunca é reaproveitado.

### T3. Envio síncrono com trava por conversa
`POST /app/agents/:agentId/tests/:conversationId/messages { text }` (AppAuth `manage`):
1. Conversa do agente e do tenant da sessão (senão 404); agente `ACTIVE` e tenant `ACTIVE`.
2. Trava Redis `agent-test:<conversationId>` (SET NX, 90 s): ocupada ⇒ 409 "resposta anterior em andamento".
3. `BalanceReader.total(tenantId) <= 0` ⇒ 402/422 `NO_CREDIT`, sem chamar o GPTMaker.
4. Grava a mensagem do testador, chama `sendMessage` (timeout do canal). Sucesso ⇒ grava a resposta, marca a pergunta `ANSWERED` e publica `usage.response`. Falha ⇒ marca `FAILED` e devolve erro recuperável, sem débito.
- *Alternativa*: fila RabbitMQ + polling/SSE. Rejeitada no MVP: o canal já é síncrono com 60 s e o modal fica aberto esperando; reavaliar se o tempo de resposta incomodar.

### T4. Débito pelo caminho do canal
- Publica `usage.response` com `messageId = "test:<conversationId>:<userMessageId>"`, `dialogId = "test-<uuid>"`, `modelCode` do agente e `source: 'test'`.
- `UsageResponseEvent` ganha `source?: 'channel' | 'test'` e `replyMessageId` passa a opcional (teste não tem mensagem no Bitrix). O consumidor grava `refType: 'test_message'` quando `source === 'test'` (o lançamento identifica a resposta de teste); custo e idempotência iguais.
- A reconciliação continua batendo: o GPTMaker conta as conversas de teste no `credits-spent` e o ledger tem os débitos correspondentes.

### T5. Cliente simulado
- Seletor no modal usa `GET /app/crm/clients?query=` (módulo `semantic`, AppAuth `manage`): busca até 10 entre contatos (`crm.contact.list` por `%NAME`/`%LAST_NAME`), leads e empresas (`%TITLE`), e por telefone/e-mail via `crm.duplicate.findbycomm` quando a busca parecer um. Devolve tipo, id, nome e empresa; só nomes, sem campos.
- A conversa guarda `client_type`, `client_id`, `client_name` (nome só para exibir).
- `crm-tools.identifyClient`: `dialogId` com prefixo `test-` ⇒ `TestConversations.simulatedClient(tenantId, conversationId)` (exportado pelo `agent-test`, filtra pelo tenant da credencial) em vez de `imopenlines.dialog.get`. Sem cliente, conversa excluída ou de outro tenant ⇒ "não identificado".
- Dependência `crm-tools → agent-test` (o `agent-test` não importa `crm-tools`).

### T6. Sem gatilhos e ações simuladas
- `AgentEventIntake`: `dialogId` com prefixo `test-` ⇒ grava o `agent_event` (consulta) e **não publica** em `triggers.events`.
- `IntentionRunner`: `dialogId` de teste ⇒ não executa ações; responde `ok: true` com a mensagem "Em teste: as ações não foram executadas. Seriam: <rótulos>." (mesmos rótulos de `ACTION_LABELS`) e registra a execução com status `SUCCESS` e resultado `{ simulated: true }`.
- Canal: conversas de teste não passam pelo canal (sem `dialog_state`, sem handoff).

### T7. Frontend
- Botão "Testar" no `aside` do `PageHeader` do agente, só com `canManage` e agente `ACTIVE`.
- Modal largo (prop nova `size: 'lg'` no `Modal`, `max-w-5xl`): coluna esquerda com "Nova conversa" e a lista (data, cliente simulado, trecho, botão excluir com confirmação); coluna direita com a conversa (balões, "digitando…" enquanto espera, erro com "tentar de novo", campo de texto com Enter para enviar). No celular, a lista vira uma tela anterior à conversa.
- "Nova conversa" abre um passo opcional "Simular cliente do CRM" com busca (desligado se o acesso ao CRM do agente estiver desligado, com explicação).
- Aviso fixo: "Cada resposta de teste consome créditos como uma conversa real."
- API: `GET/POST /app/agents/:agentId/tests`, `GET/DELETE /app/agents/:agentId/tests/:id`, `POST .../tests/:id/messages`, `GET /app/crm/clients`.

### T8. Observabilidade
Logs sem texto das mensagens (só ids, duração, resultado); métrica `agent_test_messages_total{outcome}`.

## Risks / Trade-offs

- [Requisição HTTP de até 60 s] → o Caddy e o Express aceitam; o frontend mostra "digitando…" e permite cancelar a espera (a resposta, se chegar, fica no histórico).
- [Contextos de teste acumulam no GPTMaker] → sem rota de exclusão; o `chatName` "Teste — …" permite à equipe filtrar no painel.
- [Gerente vê testes de outros gerentes do mesmo tenant] → aceito no MVP (é o mesmo agente); o autor aparece na lista.
- [Ações simuladas divergirem das reais] → a simulação usa a mesma lista de ações e rótulos da intenção.
- [Cliente simulado com dados pessoais] → só quem gerencia agentes escolhe; o seletor mostra só nome e empresa; as respostas seguem a allowlist da camada semântica.

## Migration Plan

1. Migração aditiva (duas tabelas).
2. Deploy sem flag: o botão aparece para quem gerencia agentes; sem uso, nada muda.
3. Rollback: reverter o deploy; as tabelas ficam sem uso.
