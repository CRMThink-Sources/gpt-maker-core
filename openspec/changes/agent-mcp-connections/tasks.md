# Tasks
> Status (2026-11-12): a implementação foi removida do repositório enquanto o GPTMaker é consultado sobre o OAuth do `mcp/add` (500 ao criar conexão `OAUTH` via API). Todas as tarefas voltaram a pendentes. O código removido está só na branch local `backup/agent-mcp-v1` de quem o escreveu, não publicada.

## 1. Validação do comportamento do GPTMaker

- [ ] 1.1 (PENDENTE: exige staging/GPTMaker real) Em staging, exercitar `mcp/add` + `tools` + `active`/`inactive` + `sync-tools` + `DELETE` contra um servidor MCP de eco e registrar em `docs/gptmaker-mcp.md` se as ferramentas nascem ativas, o formato das respostas e o erro ao remover conexão inexistente (lacunas 3 e 4); verificar relendo o doc com os resultados datados.
- [ ] 1.2 Branch `feat/agent-mcp-connections` a partir de `develop` atualizada; verificar com `git branch --show-current`.

## 2. Contratos e cliente GPTMaker

- [ ] 2.1 Em `packages/contracts`, criar schemas zod e tipos (`mcpConnectionInputSchema`, `McpConnectionView`, `McpToolView`, atualização, `{ active }` da ferramenta) com validação de URL (https fora de dev, sem host local/privado), cabeçalhos e recusa de `OAUTH`; verificar com testes de contrato (`npx vitest run` em `packages/contracts/`) cobrindo `it.each` de URLs válidas e inválidas.
- [ ] 2.2 Acrescentar `deactivateMcpTool` ao `GptMakerClient` (`GET /mcp/{mcpId}/tool/{toolId}/inactive`) e tratar 404 em `deleteMcp` como distinguível; verificar com teste em `gptmaker.client.test.ts`.
- [ ] 2.3 (dispensada: o serviço novo tem regra própria — respeita `disabled_tools` — e os testes do CRM mockam o cliente; nada extraído) Extrair `activateInactiveTools` de `crm-tools.sync.ts` para helper compartilhado do módulo `gptmaker` sem mudar o comportamento do CRM; verificar que `crm-tools.sync.test.ts` continua passando.

## 3. Persistência

- [ ] 3.1 Criar `agent_mcp_connection` em `backend/src/shared/database/schema/` (headers com `encryptedText`, `disabled_tools` jsonb, status, `last_error`, índice por tenant/agente) e gerar a migration com `npm run db:generate -w backend`; verificar que `git status backend/drizzle` mostra só a migration nova e passar pelo `guardiao-migracoes`.
- [ ] 3.2 (teste escrito em `test/integration/agent-mcp-repository.test.ts`, NÃO executado: sem Docker na máquina) Criar `agent-mcp.repository.ts` com todas as consultas filtradas por `tenantId` e `agentId`; verificar com teste de integração (Testcontainers) cobrindo isolamento entre tenants e cifra em repouso (valor em claro ausente na coluna).

## 4. Serviço e API

- [ ] 4.1 Implementar `agent-mcp.service.ts`: listar (views sem valores de cabeçalho), criar (D3), remover (404 do GPTMaker = sucesso) e propagar erros como `DomainError` sem segredos; verificar com testes unitários dos cenários de criação, falha do GPTMaker, `connected: false` e remoção.
- [ ] 4.2 Implementar edição (D4: criar nova → trocar → remover antiga, mesclar cabeçalhos, reaplicar `disabled_tools`); verificar com testes dos cenários "edição bem-sucedida", "falha ao recriar" e "cabeçalho mantido".
- [ ] 4.3 Implementar ferramentas (listar ao vivo, ativar/desativar, sincronizar com novas ferramentas inativas, conexão ausente no GPTMaker marca `error`); verificar com testes unitários dos cenários da spec.
- [ ] 4.4 (controller, módulo e depcruise OK; falta o teste HTTP de 403/404, que exige Docker) Criar `agent-mcp.controller.ts` (`app/agents/:agentId/mcp-connections`, `@AppAuth()` leitura e `@AppAuth('manage')` escrita, DTOs via `@gptmaker/contracts`), `agent-mcp.module.ts` e `index.ts`; registrar no `api.module.ts`; verificar com `npm run depcruise` e teste de integração HTTP de 404 entre tenants e 403 sem `manage`.
- [ ] 4.5 Limpar as linhas locais quando o agente é removido (D9) sem import circular; verificar com teste do cenário "Remoção do agente".
- [ ] 4.6 Teste que garante que `headers` não aparecem em logs, respostas ou `last_error` numa falha de criação; verificar passando e passar pelo `auditor-multitenant`.

## 5. Frontend

- [ ] 5.1 Criar `frontend/src/lib/mcp-connections.ts` (cliente de API tipado com `@gptmaker/contracts`); verificar com teste de lógica pura do mapeamento de erros.
- [ ] 5.2 Criar a seção "Conexões MCP" do agente (lista com estado e erro, formulário com cabeçalhos dinâmicos mascarados e "mantido" na edição, remoção com confirmação, lista de ferramentas com interruptor e botão "Sincronizar", aviso de que só conexões criadas pelo ThinkFlow aparecem) consultando `node_modules/next/dist/docs/` antes; verificar com testes de componente (Testing Library) dos fluxos criar, editar sem reenviar segredo, desativar ferramenta e falha.
- [ ] 5.3 Sem permissão de gestão, ocultar/desabilitar ações de escrita; verificar com teste de componente.

## 6. Documentação e fechamento

- [ ] 6.1 Documentar a funcionalidade em `docs/gptmaker-mcp.md` (uso pelo cliente, limitações, OAuth fora do v1) e no runbook (`docs/runbook.md`: conexão em `error`, órfãs); verificar relendo os comandos/rotas citados contra o código.
- [ ] 6.2 (feito: build contracts, typecheck, depcruise, `npm test`, lint dos arquivos novos, revisores de migração/multi-tenant/código/frontend; falta: `test:integration` e `especialista-openspec`) Rodar o checklist do CI: `npm run build -w @gptmaker/contracts`, `format:check`, `lint`, `typecheck`, `depcruise`, `npm test`, `npm run test:integration -w backend`, `npm run build`; passar por `revisor-codigo`, `revisor-frontend` e `especialista-openspec`; verificar saídas sem falhas novas além dos ruídos já listados no CLAUDE.md.
- [ ] 6.3 (PENDENTE: staging) Teste ponta a ponta em staging: criar conexão com servidor de eco, conversar com o agente chamando a ferramenta, desativar a ferramenta e confirmar que deixa de ser chamada, editar e remover; verificar com o roteiro anotado no PR.
