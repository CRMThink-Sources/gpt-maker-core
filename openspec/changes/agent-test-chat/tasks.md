> Estimativas em horas de trabalho focado de 1 dev sênior full-stack, incluindo testes. Resumo no fim do arquivo.

## 1. Dados e contratos

- [x] 1.1 Schema Drizzle e migração de `agent_test_conversation` e `agent_test_message` (T1); verificação: `npm run db:generate` gera a migração e o teste de integração de schema passa (~2h)
- [x] 1.2 Contratos em `packages/contracts/src/agent-tests.ts`: views de conversa e mensagem, entrada de mensagem (texto até 4.000), entrada de nova conversa (cliente simulado opcional) e resultado da busca de clientes; verificação: testes unitários dos schemas (~2h)

## 2. Backend: conversas de teste

- [x] 2.1 Módulo `agent-test` com repositório e serviço: criar (limite de 50 por agente), listar, abrir, excluir, isolamento por tenant e agente, agente e tenant ativos; endpoints `GET/POST /app/agents/:agentId/tests` e `GET/DELETE .../tests/:id` com AppAuth `manage`; verificação: testes de integração de criação, limite, exclusão e isolamento (~5h)
- [x] 2.2 Envio: trava Redis por conversa, gate de saldo (`BalanceReader`), `sendMessage` com `contextId` `<tenantId>:test-<uuid>` e `chatName` "Teste — <usuário>", gravação de pergunta/resposta e falha recuperável sem débito; endpoint `POST .../tests/:id/messages`; verificação: testes com GPTMaker falso para resposta, timeout, envio simultâneo e sem saldo (~5h)
- [x] 2.3 Débito: `UsageResponseEvent` com `source` e `replyMessageId` opcional, publicação a partir do teste, `refType: 'test_message'` no consumidor; verificação: teste de integração do débito idempotente de resposta de teste e regressão do débito do canal (~2h)

## 3. Backend: CRM e automações

- [x] 3.1 Busca de clientes `GET /app/crm/clients?query=` (contatos, leads, empresas; telefone/e-mail por `crm.duplicate.findbycomm`; até 10, só nome e empresa); verificação: testes com portal Bitrix simulado (~3h)
- [x] 3.2 `crm-tools.identifyClient` reconhece o diálogo `test-` e usa `TestConversations.simulatedClient` filtrado pelo tenant; verificação: testes dos cenários novos do requisito "Identificar o cliente da conversa" (~2h)
- [x] 3.3 `AgentEventIntake` não publica eventos de diálogo `test-`; `IntentionRunner` simula as ações em diálogo `test-`; verificação: testes de intake sem publicação e de intenção simulada sem chamada ao Bitrix (~3h)

## 4. Frontend

- [x] 4.1 `Modal` com `size: 'lg'`; API em `frontend/src/lib/agent-tests.ts`; verificação: typecheck/lint (~1h)
- [x] 4.2 Botão "Testar" no cabeçalho do agente (só gerentes e agente ativo) e modal com lista, nova conversa, conversa (enviar, "digitando…", erro com tentar de novo), excluir com confirmação e aviso de créditos; layout responsivo; verificação: typecheck/lint/build e uso manual no Bitrix (~8h)
- [x] 4.3 Passo "Simular cliente do CRM" na nova conversa, com busca e explicação quando o acesso ao CRM do agente está desligado; verificação: typecheck/lint/build e uso manual (~3h)

## 5. Documentação e integração

- [x] 5.1 Documentar em `docs/agent-test-chat.md` (contexto por conversa, débito, simulação de ações, cliente simulado, limites); verificação: documento revisado junto do PR (~1h)
- [ ] 5.2 Teste ponta a ponta em staging: conversa com e sem cliente simulado, débito no saldo, intenção com ação simulada, gatilho não disparado, excluir e criar nova conversa sem memória da anterior (~2h)

---

**Resumo**: 1 dados ~4h · 2 conversas ~12h · 3 CRM/automações ~8h · 4 frontend ~12h · 5 docs/integração ~3h · **total ~39h**.
