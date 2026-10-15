> Estimativas em horas de trabalho focado de 1 dev sênior full-stack, incluindo testes. Resumo no fim do arquivo.

## 1. Spike: MCP no GPTMaker

- [ ] 1.1 Subir um servidor MCP descartável (Streamable HTTP, uma ferramenta `eco` que devolve cabeçalhos, `_meta` e argumentos recebidos), conectá-lo a um agente de teste no painel do GPTMaker e conversar com ele; registrar em `docs/gptmaker-mcp.md` os campos do cadastro (URL, cabeçalhos), o transporte aceito e se algum identificador da conversa (`contextId`, chat, telefone) chega na chamada. Verificação: documento com os payloads reais capturados (~4h)
- [x] 1.2 Investigar se a API do GPTMaker permite configurar MCP no agente (OpenAPI, inspeção das chamadas do painel); registrar a resposta e o contrato em `docs/gptmaker-mcp.md`. Verificação: seção "Conexão por API" com sim/não e exemplo de requisição (~2h)
- [ ] 1.3 Decidir a camada de identificação da conversa (S4: nativa ou referência no `chatName`) e testar se o agente repassa a referência ao chamar a ferramenta; registrar a decisão no `design.md` (S4). Verificação: 5 conversas de teste com a ferramenta recebendo a conversa correta (~2h)

## 2. Dados e contratos

- [ ] 2.1 Migração Drizzle com `crm_field_setting` (único por `tenant_id, entity, field_code`) e `agent_crm_access` (`token_hash` único, `gptmaker_mcp_id`, FK para `agent`); verificação: `drizzle-kit` gera a migração e o teste de migração sobe no Testcontainers (~2h)
- [ ] 2.2 Schemas zod em `packages/contracts/` (campo semântico, funil/etapa, configuração de campo, estado do acesso ao CRM) e funções puras de normalização de metadado do Bitrix portadas de `frontend/src/lib/crm-fields.ts` (rótulos `formLabel`/`listLabel`/`title`, itens de lista, booleanos, etapas com semântica); verificação: testes unitários com fixtures reais de `crm.*.fields` e `crm.status.list` (~4h)
- [ ] 2.3 Adicionar `@modelcontextprotocol/sdk` ao backend e a flag `MCP_ENABLED` na config validada; verificação: `npm run build` e boot com a flag ligada e desligada (~1h)

## 3. Camada semântica no backend

- [ ] 3.1 Criar módulo `semantic` com `FieldCatalogService`: `batch` de `crm.{lead,deal,contact,company}.fields`, `crm.status.list`, `crm.category.list` e `user.get`, normalizado e em cache Redis por tenant (TTL 10 min) com invalidação explícita; verificação: testes com `BitrixClient` falso cobrindo cache, invalidação e campo removido marcado como indisponível (~6h)
- [ ] 3.2 Repositório de `crm_field_setting` com padrões (conjunto mínimo de campos padrão exposto; `UF_*`, telefone e e-mail não) e filtro obrigatório por tenant; verificação: testes de integração de padrão, alteração e isolamento entre tenants (~3h)
- [ ] 3.3 `SemanticTranslator.toSemantic`: exposição + tradução (lista/status, Sim/Não, usuário, funil/etapa/situação, valor com moeda, datas ISO), omissão de valor sem tradução, corte de valores longos e descrição de significado junto do campo; verificação: testes cobrindo todos os cenários de "Tradução de valores" e "Exposição somente por lista de permissão" da spec (~5h)
- [ ] 3.4 Endpoints `GET /semantic/fields`, `PUT /semantic/fields/{entity}/{code}` (descrição até 300 caracteres) e `POST /semantic/refresh`, com sessão do iframe; verificação: testes de controller incluindo campo de outro tenant respondido como inexistente (~3h)
- [ ] 3.5 Documentar o módulo em `docs/semantic-layer.md` (fontes de metadado, padrões de exposição, regras de tradução); verificação: documento revisado junto do PR (~1h)

## 4. Servidor MCP e credencial

- [ ] 4.1 Serviço de acesso ao CRM do agente: ativar (gera token, guarda hash), desativar (invalida na hora), gerar nova credencial, transições `AWAITING_FIRST_CALL` → `CONNECTED`; endpoints `PUT /agents/{id}/crm-access` e `POST /agents/{id}/crm-access/rotate` com checagem de posse do agente; verificação: testes de serviço e controller (~4h)
- [ ] 4.2 Controller `POST /mcp` com transporte Streamable HTTP stateless (405 para GET/DELETE, 404 com flag desligada) e guard de credencial (Bearer ou `?t=`; recusa agente removido/inativo, CRM desativado, tenant desinstalado; contexto `tenantId`/`agentId`); verificação: teste e2e com cliente MCP do SDK fazendo `initialize` e `tools/list`, e casos de credencial inválida (~5h)
- [ ] 4.3 Rate limit por agente (60/min, env), orçamento de 10 s por chamada, métricas `mcp_tool_calls_total`/`mcp_tool_duration_seconds` e log por chamada com redação de `telefone`/`email`/`conversa`; verificação: testes de limite e de que o log capturado não contém argumentos (~3h)
- [ ] 4.4 Referências opacas assinadas por tenant (S5) e resolução da conversa conforme decisão da tarefa 1.3 (identificador nativo ou referência no `chatName` gerada em `ConversationService.buildRequest` só para agentes com CRM ativo), usando `parseCrmBinding`/`primaryEntity`; verificação: testes de assinatura inválida, referência de outro tenant e `buildRequest` sem mudança para agentes sem CRM (~4h)

## 5. Ferramentas

- [ ] 5.1 `consultar_cliente` (conversa → telefone/e-mail via `crm.duplicate.findbycomm`; contato ou lead, empresa, responsável, contagem de negócios em andamento; até 5 candidatos na ambiguidade; não encontrado sem erro de protocolo); verificação: testes dos quatro cenários da spec com Bitrix falso (~5h)
- [ ] 5.2 `negocios_do_cliente` (filtro de situação por `STAGE_SEMANTIC_ID`, ordem por criação desc, máximo 10 com `ha_mais`, `select` só com campos expostos); verificação: testes de filtro, limite e campo não exposto ausente (~4h)
- [ ] 5.3 `etapas_do_funil` a partir do catálogo em cache, com casamento de nome sem acento/caixa; verificação: testes de funil específico, todos os funis e funil inexistente (~2h)
- [ ] 5.4 Descrições das ferramentas e argumentos em pt-BR voltadas ao LLM e mapeamento de erros de negócio (não encontrado, ambíguo, indisponível, limite) para resultado de ferramenta; verificação: teste de snapshot do `tools/list` e testes de Bitrix com timeout (~2h)

## 6. Conexão ao GPTMaker

- [ ] 6.1 `McpConnector` no módulo `gptmaker`: conexão automática se a tarefa 1.2 achou API (com queda para `MANUAL` em falha) e remoção por melhor esforço ao desativar; sem API, só o modo manual; verificação: testes com cliente GPTMaker falso nos dois modos (~3h)

## 7. Frontend

- [ ] 7.1 Página "CRM para o agente" (`/app/crm`): abas por entidade, rótulo, tipo, valores aceitos, chave de exposição, descrição com contador de 300 caracteres, campos indisponíveis sinalizados e botão "atualizar metadados"; verificação: testes de componente e uso manual dentro do Bitrix (~6h)
- [ ] 7.2 Bloco "Acesso ao CRM" na configuração do agente: chave, estado (conectado / aguardando primeira chamada / erro), "gerar nova credencial" com confirmação e cadastro manual exibido uma vez com URL, credencial e instruções do `docs/gptmaker-mcp.md`; verificação: testes de componente e fluxo manual completo com um agente real (~4h)

## 8. Integração e piloto

- [ ] 8.1 Teste ponta a ponta em staging: tenant com campos personalizados, agente com CRM ativo, conversa na Linha Aberta perguntando sobre o próprio negócio; conferir resposta com funil/etapa pelo nome, ausência de campos não expostos e registro de uso sem dados pessoais (~3h)
- [ ] 8.2 Piloto com um tenant interno por uma semana; comparar créditos do agente na reconciliação diária antes/depois para detectar cobrança extra por chamada de ferramenta e registrar o resultado em `docs/gptmaker-mcp.md` (~2h)

---

**Resumo**: 1 spike ~8h · 2 dados/contratos ~7h · 3 camada semântica ~18h · 4 MCP/credencial ~16h · 5 ferramentas ~13h · 6 conexão ~3h · 7 frontend ~10h · 8 integração ~5h · **total ~80h** (2 semanas de 1 dev).
