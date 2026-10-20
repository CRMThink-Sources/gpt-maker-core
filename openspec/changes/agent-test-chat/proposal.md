## Why

Para ver como o agente responde, o cliente hoje precisa abrir uma conversa real numa Linha Aberta do Bitrix24 (ou pedir a alguém da CRMThink para testar no painel do GPTMaker, ao qual ele não tem acesso). Isso atrasa o ajuste de perfil, treinamentos, intenções e acesso ao CRM, e mistura testes com atendimentos reais. O painel do GPTMaker tem um "testar agente"; trazer isso para o app fecha o ciclo configurar → testar → ajustar sem sair da tela do agente.

## What Changes

- **Botão "Testar"** no cabeçalho do agente, que abre um modal com a lista de conversas de teste do agente, "Nova conversa" e a área de conversa (enviar texto, ver as respostas do agente).
- **Conversas de teste guardadas** no app (histórico por agente), reabríveis e **excluíveis**. Cada conversa tem um contexto próprio no GPTMaker, que nunca é reutilizado.
- **Cliente simulado opcional**: ao iniciar uma conversa, o testador pode escolher um contato, lead ou empresa do CRM; a intenção "Consultar cliente no CRM" passa a reconhecer conversas de teste e devolve esse cliente, como se a conversa estivesse vinculada a ele.
- **Créditos**: cada resposta de teste debita o custo do modelo, pelo mesmo caminho das conversas reais; sem saldo, o envio é recusado com aviso. O modal informa que o teste consome créditos.
- **Permissão**: só quem gerencia agentes testa; agente e tenant precisam estar ativos.
- Fora do escopo: anexos e mídia (só texto), resposta em streaming, testar agente inativo.

## Capabilities

### New Capabilities
- `agent-test-chat`: conversas de teste com o agente dentro do app (criar, conversar, listar, reabrir e excluir), cliente simulado opcional, débito de créditos e permissões.

### Modified Capabilities
- `agent-crm-tools`: o requisito "Identificar o cliente da conversa" passa a cobrir conversas de teste, em que o cliente vem da escolha do testador (isolado por tenant), e não do vínculo da Linha Aberta.

## Impact

- **Backend**: novo módulo `agent-test` (conversas e mensagens de teste, envio ao GPTMaker, débito via `usage.response`); tabelas novas com migração Drizzle; `crm-tools` reconhece o diálogo de teste; rota de busca de clientes do CRM para o seletor; `UsageResponseEvent` passa a aceitar resposta sem mensagem do Bitrix.
- **Frontend**: botão no cabeçalho do agente, modal de teste com lista, conversa e seletor de cliente.
- **Contratos**: schemas zod das conversas de teste em `packages/contracts/`.
- **GPTMaker**: mais chamadas a `POST /agent/{id}/conversation` (consumo real de créditos); contextos de teste ficam no GPTMaker após a exclusão (não há rota para apagá-los).
- **Billing e reconciliação**: débitos de teste entram no ledger como as respostas reais, então a reconciliação diária continua batendo com o consumo do GPTMaker.
