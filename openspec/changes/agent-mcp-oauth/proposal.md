# Proposal

## Why

A v1 de `agent-mcp-connections` só aceita servidores MCP sem autenticação ou com cabeçalhos fixos. Boa parte dos servidores que os clientes querem ligar ao agente (CRMs, agendas, ferramentas de suporte) só oferece OAuth, e hoje o ThinkFlow recusa `OAUTH` com "ainda não é suportada". O GPTMaker já tem o fluxo (`mcp/add` com `authType: OAUTH` devolve a URL de autorização e `POST /mcp/connect` conclui), faltando o ThinkFlow conduzi-lo.

## What Changes

- Aceitar `authType: OAUTH` ao criar uma conexão MCP: o ThinkFlow chama `mcp/add`, recebe `{ id, url, connected }` e guarda a conexão como **pendente de autorização**, sem segredo algum (OAuth não usa cabeçalhos).
- Mostrar ao usuário o passo "Autorizar": abre a `url` do provedor em nova janela. Ao voltar, o usuário conclui informando o retorno do provedor (o `code` e o `state`, ou a URL de retorno inteira colada); o ThinkFlow valida o `state` contra o da conexão e chama `POST /mcp/connect`.
- Ao concluir, a conexão vira `connected`, o `mcpId` devolvido substitui o provisório, e as ferramentas descobertas são listadas e ativadas como na v1.
- Conexão pendente pode ser cancelada (remove no GPTMaker e localmente) ou reiniciada; pendência não concluída não conta como conexão ativa e o agente não a usa.
- Editar uma conexão `OAUTH` não é suportado: o usuário remove e cria de novo (exigiria nova autorização, e o GPTMaker não tem `PUT`).
- Novo estado `PENDING_AUTH` no enum de status (nova migration; nunca alterar as já geradas), colunas para o `state` pendente e a data de criação da pendência.
- Frontend: seletor "OAuth" no formulário de conexão, cartão com o estado "Aguardando autorização", botões "Autorizar", "Concluir" e "Cancelar".

## Capabilities

### New Capabilities
- `agent-mcp-oauth`: fluxo de autorização OAuth das conexões MCP do agente (criar pendente, autorizar, concluir, cancelar). Estende `agent-mcp-connections`, ainda não arquivada; ao arquivar as duas, o cenário "Autenticação OAuth" da v1 (recusa) deixa de valer.

### Modified Capabilities

## Impact

- Backend: `agent-mcp` (service, controller, repository), `gptmaker.client.ts` (`connectMcp`), schema `agent_mcp_connection` + migration.
- `packages/contracts`: `mcpAuthTypeSchema` e a validação de criação passam a aceitar `OAUTH`; novos schemas de conclusão e `McpConnectionView` com `status: 'pending_auth'` e `authorizationUrl`.
- Frontend: `mcp-connections-card.tsx` e `lib/mcp-connections.ts`.
- Docs: `docs/gptmaker-mcp.md` (fluxo OAuth e lacunas).
- Depende da change `agent-mcp-connections`, cujo plano está neste repositório mas cuja implementação foi removida (2026-11-12) até o GPTMaker destravar o OAuth.
