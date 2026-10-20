# Teste do agente dentro do app

Change `agent-test-chat`. Spec: `agent-test-chat` e o requisito "Identificar o cliente da conversa" de `agent-crm-tools`.

Quem gerencia agentes conversa com o agente sem abrir uma Linha Aberta: botão **Testar** no cabeçalho do agente (só com o agente ativo), modal com as conversas de teste à esquerda e a conversa à direita.

## Como funciona

```
Modal ─ POST /app/agents/:id/tests/:conv/messages ─▶ AgentTestService
          trava agent-test:<conv> (1 resposta por vez) ─ saldo > 0? ─ grava a pergunta
          GPTMaker POST /agent/{id}/conversation  contextId = <tenantId>:test-<conv>
          grava a resposta ─ publica usage.response (source: test) ─▶ débito no ledger
```

- **Contexto por conversa**: `contextId = <tenantId>:test-<conversationId>`. O GPTMaker guarda a memória por contexto, então reabrir uma conversa continua de onde parou e uma conversa nova começa do zero. O chat aparece no painel do GPTMaker como "Teste — <usuário>".
- **Diálogo `test-<id>`**: é o que volta em `{{chat_id}}` e nos webhooks. O prefixo `test-` identifica a conversa de teste em todo o backend (`isTestDialog`, `testConversationIdFrom` em `backend/src/modules/agent-test`).
- **Envio síncrono**: a requisição espera a resposta do GPTMaker (até `GPTMAKER_CONVERSATION_TIMEOUT_MS`, 60 s). Falha ou demora deixa a pergunta como `FAILED`, sem débito; o testador reenvia.
- **Uma resposta por vez**: segunda mensagem na mesma conversa antes da resposta ⇒ 409 `TEST_REPLY_PENDING`.

## Créditos

- Cada resposta de teste debita o custo vigente do modelo, como uma resposta real: o mesmo evento `usage.response` com `messageId = test:<conversa>:<pergunta>` (idempotente) e `source: 'test'`; o lançamento no ledger fica com `refType: 'test_message'`.
- Saldo zerado ⇒ 422 `NO_CREDIT`, sem chamar o GPTMaker.
- A reconciliação diária continua batendo: o GPTMaker conta as conversas de teste no `credits-spent` e o ledger tem os débitos correspondentes.

## Sem efeito no portal

- **Gatilhos**: webhook de diálogo `test-` é gravado em `agent_event` (para consulta), mas não é publicado em `triggers.events`.
- **Intenções com ações no Bitrix**: em diálogo `test-` as ações não são executadas; o agente recebe "Conversa de teste: as ações não foram executadas no CRM. Seriam: …" e a execução fica registrada como `SUCCESS` com `{ simulated: true }`.
- **Consultas ao CRM** (somente leitura) funcionam normalmente.

## Cliente simulado

- Ao iniciar uma conversa, o testador pode escolher um contato, lead ou empresa (`GET /app/crm/clients?query=`, por nome, telefone ou e-mail; até 10, só nome e empresa). Disponível quando as ferramentas do CRM estão ligadas e o "Acesso ao CRM" do agente está conectado.
- A intenção "Consultar cliente no CRM", numa conversa de teste, devolve esse cliente (`TestConversations.simulatedClient`, sempre filtrado pelo tenant da credencial), como se a conversa estivesse vinculada a ele. Sem cliente ⇒ "não identificado".

## Limites e retenção

- Até 50 conversas por agente; criar a 51ª exclui a mais antiga (mensagens em cascata).
- Mensagens de até 4.000 caracteres; só texto (sem anexos).
- Excluir apaga a conversa e as mensagens no app. O GPTMaker não tem rota para apagar o contexto: ele fica lá, mas nunca é reutilizado (cada conversa tem um UUID novo).
- Todo gerente do tenant vê as conversas de teste do agente; o autor aparece na lista.

## API

| Método e rota                                  | Uso                                                    |
| ---------------------------------------------- | ------------------------------------------------------ |
| `GET /app/agents/:agentId/tests`               | Conversas do agente (mais recente primeiro)            |
| `POST /app/agents/:agentId/tests`              | Nova conversa `{ client: { type, id, name } \| null }` |
| `GET /app/agents/:agentId/tests/:id`           | Conversa com o histórico                               |
| `DELETE /app/agents/:agentId/tests/:id`        | Excluir                                                |
| `POST /app/agents/:agentId/tests/:id/messages` | Enviar `{ text }` e receber a resposta                 |
| `GET /app/crm/clients?query=`                  | Busca de clientes para simular                         |

Todas exigem permissão de gerenciar agentes. Métrica: `agent_test_messages_total{outcome}` (`answered`, `failed`, `no-credit`, `busy`). Logs sem o texto das mensagens.
