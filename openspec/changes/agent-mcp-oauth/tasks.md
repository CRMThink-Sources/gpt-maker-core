# Tasks

## 1. Validação do comportamento do GPTMaker

- [ ] 1.1 (parcial: redirecionamento observado em 2026-11-12, ver design.md) Em staging com a conta partner, criar uma conexão `OAUTH` nova, autorizar sem sessão no GPTMaker, copiar a URL da tela de login e chamar `mcp/connect` com `code` e `state`; registrar em `docs/gptmaker-mcp.md` (datado) o resultado, se o `mcpId` difere do `id` do `add`, a validade da URL e o erro de código inválido ou consumido; verificar relendo o doc.
- [ ] 1.2 Com o resultado de 1.1, confirmar D1/D4a (passo manual com releitura) ou simplificar para "Atualizar status", e ajustar o spec se mudar; verificar que `openspec validate agent-mcp-oauth` continua passando.

## 2. Contratos e cliente GPTMaker

- [ ] 2.1 Em `packages/contracts/src/mcp-connections.ts`, aceitar `OAUTH` em `mcpAuthTypeSchema` e na criação (cabeçalhos vazios), acrescentar `status: 'pending_auth'` e `authorizationUrl` à view e criar `mcpOAuthCompleteSchema`; verificar com `it.each` em `mcp-connections.test.ts` (OAuth sem cabeçalhos válido, OAuth com cabeçalhos inválido, `code`/`state` vazios inválidos) e rebuild de `@gptmaker/contracts`.
- [ ] 2.2 Acrescentar `connectMcp({ code, state })` ao `GptMakerClient` (`POST /mcp/connect`, resposta `{ success, mcpId }`) com schema próprio; verificar em `gptmaker.client.test.ts` (sucesso, `success: false`, 400 e erro sem o `code` no texto da exceção).

## 3. Persistência

- [ ] 3.1 No schema de `agent_mcp_connection`, adicionar `PENDING_AUTH` ao enum e as colunas `oauth_state`, `authorization_url`, `oauth_started_at`; `authType` passa a aceitar `OAUTH`; gerar migration nova com `npm run db:generate -w backend`; verificar que `git status backend/drizzle` mostra só a migration nova e passar pelo `guardiao-migracoes`.
- [ ] 3.2 Ajustar `agent-mcp.repository.ts` para gravar e limpar os campos de OAuth, sempre filtrando por `tenantId` e `agentId`; verificar com teste de integração (Testcontainers) de isolamento entre tenants e de que `authorization_url` e `oauth_state` são limpos ao concluir.

## 4. Serviço e API

- [ ] 4.1 Em `agent-mcp.service.ts`, criação com `OAUTH` (D3): `connected: true` segue a v1, `false` grava `PENDING_AUTH` e devolve `authorizationUrl`, falha do GPTMaker não deixa linha; verificar com testes unitários dos três cenários e de URL insegura.
- [ ] 4.2 Implementar `completeOAuth` (D4): valida estado pendente, compara `state` em tempo constante, chama `connectMcp`, troca o `mcpId`, aplica ferramentas, limpa o `state`; falha mantém pendente com motivo sem o `code`; verificar com testes de `state` divergente, código recusado, já concluída e sucesso.
- [ ] 4.2a Implementar a releitura de D4a (falha de `connect` ou "Atualizar status" relê `tools` e conclui se a conexão já existe); verificar com testes de "código consumido pelo painel" (conclui) e "código inválido e sem conexão" (continua pendente).
- [ ] 4.3 Implementar cancelar/refazer (D5) e a recusa de edição `OAUTH` (D6, 409); verificar com testes dos cenários "Cancelar pendente", "404 do GPTMaker ao cancelar" e "Editar conexão OAuth".
- [ ] 4.4 Expor `POST .../:id/oauth/complete` e `POST .../:id/oauth/restart` no controller (`@AppAuth('manage')`, DTO via contratos); verificar com `npm run depcruise` e teste HTTP de 403 sem `manage` e 404 entre tenants (integração).
- [ ] 4.5 Teste que garante que `code` e `state` não aparecem em logs, respostas de erro, `last_error` nem no banco; verificar passando e passar pelo `auditor-multitenant`.

## 5. Frontend

- [ ] 5.1 Em `frontend/src/lib/mcp-connections.ts`, funções `completeMcpOAuth`/`restartMcpOAuth` e `parseOAuthReturn(url|texto)` que extrai `code` e `state`; verificar com testes de lógica pura (retorno direto `?code&state`, tela de login `?goBack=<codificado com code>&state`, só código, texto inválido).
- [ ] 5.2 Em `mcp-connections-card.tsx`: seletor "OAuth" no formulário (sem cabeçalhos), estado "Aguardando autorização" com botões Autorizar (abre a URL em nova janela), campo para colar o retorno + Concluir, e Cancelar; edição desabilitada para OAuth com explicação; verificar com testes de componente (Testing Library) do que o usuário vê e faz em cada estado.
- [ ] 5.3 Revisar com o `revisor-frontend` (Next 16 conferido em `node_modules/next/dist/docs/`); verificar que o parecer não aponta pendências.

## 6. Fechamento

- [ ] 6.1 Atualizar `docs/gptmaker-mcp.md` (seção Conexões MCP do cliente: fluxo OAuth, limites e resultado da spike) e `docs/runbook.md` (pendência de autorização presa, como cancelar); verificar relendo.
- [ ] 6.2 Rodar o checklist do CLAUDE.md (build de contracts, `format:check`, `lint`, `typecheck`, `depcruise`, `npm test`, `db:generate` sem mudança extra) e `openspec validate agent-mcp-oauth`; passar por `revisor-codigo`, `guardiao-migracoes`, `auditor-multitenant` e `especialista-openspec`.
