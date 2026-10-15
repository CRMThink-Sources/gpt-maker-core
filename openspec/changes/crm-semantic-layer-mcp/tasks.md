> Estimativas em horas de trabalho focado de 1 dev sênior full-stack, incluindo testes. Resumo no fim do arquivo.

## 1. Spike: MCP no GPTMaker

- [x] 1.1 Subir um servidor MCP descartável (Streamable HTTP, ferramentas de eco), conectá-lo a um agente de teste e conversar com ele; registrar em `docs/gptmaker-mcp.md` os campos do cadastro, o transporte aceito e se algum identificador da conversa chega na chamada. Verificação: documento com os payloads reais capturados (~4h)
- [x] 1.2 Investigar se a API do GPTMaker permite configurar MCP no agente; registrar a resposta e o contrato em `docs/gptmaker-mcp.md`. Verificação: seção "Conexão por API" com exemplo de requisição (~2h)
- [x] 1.3 Decidir a identificação da conversa e registrar no `design.md`: modelo híbrido (S2), intenção de sistema com `{{chat_id}}` identifica o cliente e o MCP complementa. Verificação: proposal, specs e design atualizados e `openspec validate --strict` passando (~2h)

## 2. Dados e contratos

- [x] 2.1 Schema Drizzle e migração com `crm_field_setting` (único por `tenant_id, entity, field_code`) e `agent_crm_access` (S3); verificação: `npm run db:generate` gera a migração e o teste de migração passa (~2h)
- [x] 2.2 Contratos em `packages/contracts/src/crm.ts`: schemas zod da configuração de campo, do catálogo (campo semântico, funil/etapa) e do acesso ao CRM, e funções puras de normalização de metadado do Bitrix (rótulos `formLabel`/`listLabel`/`title`, itens de lista, booleanos, etapas com semântica); verificação: testes unitários com fixtures de `crm.*.fields` e `crm.status.list` (~4h)
- [x] 2.3 Dependência `@modelcontextprotocol/sdk` no backend e variáveis `CRM_TOOLS_ENABLED`/`CRM_TOOLS_RATE_PER_MINUTE` na config validada; verificação: typecheck e teste da config com a flag ligada e desligada (~1h)

## 3. Camada semântica no backend

- [x] 3.1 Módulo `semantic` com `FieldCatalogService`: `batch` dos metadados, normalizado, em cache Redis por tenant (TTL 10 min) com invalidação; verificação: testes com `BitrixClient` falso cobrindo cache, invalidação e funis/etapas (~5h)
- [x] 3.2 Escolhas do cliente (`crm_field_setting`) com padrões (conjunto mínimo de campos padrão exposto; `UF_*`, telefone e e-mail não), visão do catálogo com campos indisponíveis e filtro obrigatório por tenant; verificação: testes de padrão, alteração, campo removido e isolamento entre tenants (~3h)
- [x] 3.3 `SemanticTranslator`: exposição + tradução (lista/status, Sim/Não, responsável, funil/etapa/situação, valor com moeda, datas ISO), omissão de valor sem tradução, corte de texto longo e descrição junto do campo; verificação: testes cobrindo os cenários de "Tradução de valores" e "Exposição somente por lista de permissão" (~5h)
- [x] 3.4 Endpoints `GET /app/crm/fields`, `PUT /app/crm/fields/{entity}/{code}` (descrição até 300 caracteres) e `POST /app/crm/refresh`, com sessão do iframe; verificação: testes de controller incluindo campo de outro tenant respondido como inexistente (~3h)

## 4. Acesso ao CRM do agente

- [x] 4.1 Cliente GPTMaker com as rotas de MCP (`mcpAdd`, `listMcpTools`, `activateMcpTool`, `syncMcpTools`, `deleteMcp`), schemas zod e resiliência existente; verificação: testes do cliente com respostas documentadas (~2h)
- [x] 4.2 `CrmAccessService`: ativar (credencial, intenção de sistema, conexão MCP, ativação das ferramentas, desfazer em falha), desativar (credencial morre antes da remoção remota), agente removido, lock por agente; endpoints `GET|PUT /agents/{id}/crm-access` com checagem de posse e flag; verificação: testes de serviço com GPTMaker falso para sucesso, falha no meio e desativação (~6h)
- [x] 4.3 Nome reservado da intenção de sistema no `IntentionService` (recusa e exclusão na busca por nome); verificação: testes de criação/edição com o nome reservado (~1h)
- [x] 4.4 `CrmAccessGuard` (Bearer → acesso `CONNECTED` → agente ativo → tenant ativo), rate limit por agente, métricas e log por chamada sem dados pessoais; verificação: testes de credencial inválida, agente inativo, limite excedido e log sem argumentos (~3h)

## 5. Ferramentas

- [x] 5.1 Referências opacas assinadas por tenant (S6); verificação: testes de ida e volta, adulteração e referência de outro tenant (~1h)
- [x] 5.2 `CrmToolsService.identifyClient(chat)`: diálogo pelo chat (com o tenant da credencial), vínculo pelo `imopenlines.dialog.get`, contato → lead → empresa, dados traduzidos, até 10 negócios em andamento e referência; endpoint `POST /gptmaker/crm/client`; verificação: testes dos cenários de "Identificar o cliente da conversa" (~5h)
- [x] 5.3 `CrmToolsService.clientDeals(ref, situação)` e `pipelineStages(funil?)`; verificação: testes de filtro, limite com `ha_mais`, campo não exposto ausente, funil inexistente (~4h)
- [x] 5.4 Controller `POST /mcp` com transporte Streamable HTTP sem estado (405 para GET/DELETE, 404 com flag desligada), ferramentas `negocios_do_cliente` e `etapas_do_funil` com descrições em pt-BR e erros de negócio como resultado; verificação: teste e2e com cliente MCP do SDK fazendo `initialize`, `tools/list` e `tools/call` (~4h)
- [ ] 5.5 Documentar em `docs/crm-tools.md` (fluxo híbrido, credencial, ferramentas, flag, como testar); verificação: documento revisado junto do PR (~1h)

## 6. Frontend

- [ ] 6.1 Página "CRM para o agente" (`/app/crm`): abas por entidade, rótulo, tipo, valores aceitos, chave de exposição, descrição com contador de 300 caracteres, campos indisponíveis sinalizados e "atualizar"; verificação: typecheck/lint e uso manual dentro do Bitrix (~6h)
- [ ] 6.2 Bloco "Acesso ao CRM" na configuração do agente: chave, estado (conectado / conectando / erro com "tentar de novo"); verificação: typecheck/lint e fluxo completo com um agente real (~3h)

## 7. Integração e piloto

- [ ] 7.1 Teste ponta a ponta em staging: tenant com campos personalizados, agente com CRM ativo, conversa na Linha Aberta perguntando sobre o próprio negócio; conferir resposta com funil/etapa pelo nome, ausência de campos não expostos, histórico pelo MCP e registro de uso sem dados pessoais (~3h)
- [ ] 7.2 Piloto com um tenant interno por uma semana; comparar créditos do agente na reconciliação antes/depois e registrar em `docs/gptmaker-mcp.md` (~2h)

---

**Resumo**: 1 spike ~8h · 2 dados/contratos ~7h · 3 camada semântica ~16h · 4 acesso ~12h · 5 ferramentas ~15h · 6 frontend ~9h · 7 integração ~5h · **total ~72h**.
