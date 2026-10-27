# Rodízio de usuários, canal aberto e transferência entre agentes — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Templates de função passam a aceitar vários usuários do Bitrix24 com rodízio, transferência para um canal aberto e transferência entre agentes (regras do GPT Maker), e a skill `gptthink-criar-funcao` passa a viver no repositório.

**Architecture:** Contratos (`packages/contracts`) ganham os tipos novos e a compilação pura (`compiled.transfers`, marcador de campo múltiplo vira lista). O backend gira a lista na execução (Redis), transfere para fila de canal aberto, sincroniza regras de transferência como recurso gerenciado na publicação e deixa o `onTransfer` só registrado. O frontend ganha os seletores e a seção de transferências no editor.

**Tech Stack:** TypeScript, zod, NestJS, drizzle (Postgres), ioredis, RabbitMQ, Next.js, Vitest + Testcontainers.

**Spec:** `openspec/changes/agent-function-templates/design.md` (D15–D19) e `openspec/changes/agent-function-templates/specs/agent-function-templates/spec.md` (requisitos "Vários usuários do Bitrix24 com rodízio", "Transferir para um canal aberto", "Transferência entre agentes", "Transferência para pessoa só pela intenção").

## Global Constraints

- Texto ao usuário em pt-BR. Rótulo do campo de canal: **"Canal aberto do Bitrix24"**; destino na ação: **"Canal aberto"**.
- Lista de usuários: 1 a 20 ids, sem repetir.
- `transfers`: no máximo 5 por template e 5 por bloco; `instructions` 1–1000 caracteres; `key` `^[a-z][a-z0-9_]*$`.
- Rodízio: chave Redis `rotation:<id da ação>` sem expiração; escolha `ids[(n - 1) % ids.length]` com `n = INCR`.
- Regras do GPT Maker: `GET|POST /agent/{agentId}/transfer-rules`, `PUT|DELETE /agent/{agentId}/transfer-rules/{ruleId}`; corpo `{ type: 'AGENT', agentId, instructions, returnOnFinish, userId: null }`.
- Migração nova: `backend/drizzle/0018_transfer_rules.sql` (+ snapshot e journal via `drizzle-kit generate`).
- Comentários e mensagens no estilo do código ao redor (pt-BR, frases curtas, referência a design/spec).
- Commits: um por tarefa, mensagem convencional em pt-BR terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; nunca incluir `.claude/worktrees/*`; push é do usuário.
- Verificação de cada tarefa de backend: `npx tsc --noEmit -p backend/tsconfig.json`, `npx eslint <arquivos>`, `npx prettier --check <arquivos>`; integração com `npx vitest run --project integration <arquivo>` (pasta `backend`, Docker ligado).

## Review Focus

- Template antigo sem `multiple`, sem `transfers` e com `userId` número: compila e publica igual a antes (default `multiple: false`, `transfers: []`). → teste em Task 2.
- Chamada repetida da mesma intenção (deduplicação) não gira o rodízio. → teste em Task 3.
- Intenção do agente de destino chamada com o chat do agente de origem: handoff usa o chat recebido e grava o agente de origem em `dialog_state`. → teste em Task 3.
- Republicar com o agente de destino removido ou de outro portal: publicação falha nomeando o campo, sem apagar as outras regras. → teste em Task 5.
- Mudar `multiple` de um campo já publicado: `FUNCTION_FIELD_LOCKED`. → teste em Task 5.

---

### Task 1: Contratos — tipos e schemas novos

**Files:**
- Modify: `packages/contracts/src/agent-functions.ts` (tipos `FunctionField`, `functionFieldSchema`, `functionTemplateContentSchema`, `functionBlockContentSchema`, `expandBlocks`, `collapseBlocks`)
- Modify: `packages/contracts/src/triggers.ts` (`CREATE_TASK.responsibleId`, `TRANSFER_TO_HUMAN`)
- Test: `packages/contracts/src/agent-functions.test.ts`, `packages/contracts/src/triggers.test.ts` (criar se não existir)

**Interfaces:**
- Produces:
  - `FunctionField` ganha `{ kind: 'BITRIX_USER'; …; multiple: boolean }` (default `false`), `{ kind: 'BITRIX_OPENLINE'; id; label; help?; required }` e `{ kind: 'AGENT'; id; label; help?; required }`.
  - `functionTransferSchema = z.object({ key, when?: conditionSchema, agent: string /* "{{id}}" */, instructions: z.string().trim().min(1).max(1000), returnOnFinish: z.boolean().default(false) })`; `export type FunctionTransfer = z.input<typeof functionTransferSchema>`.
  - `functionTemplateContentSchema.transfers: z.array(functionTransferSchema).max(5).default([])`; idem em `functionBlockContentSchema` (max 5). `expandBlocks` concatena `draft.transfers` + transfers dos blocos (como as intenções); `collapseBlocks` corta os do fim.
  - Ações: `CREATE_TASK.config.responsibleId: positiveId | z.array(positiveId).min(1).max(20)`; `TRANSFER_TO_HUMAN.config`: `target: z.enum(['OPERATOR','USER','LINE'])`, `userId?: positiveId | positiveId[]`, `lineId?: positiveId`; refine: `USER` exige `userId`, `LINE` exige `lineId`.
  - `isUserList(value: unknown): value is number[]` exportado de `triggers.ts`.

- [ ] **Step 1: Testes que falham** — em `agent-functions.test.ts`: `it('BITRIX_USER aceita multiple e assume false')` (parse sem `multiple` ⇒ `multiple === false`); `it('transfers: padrão vazio e até 5')` (6 itens ⇒ erro); `it('expandBlocks junta transfers do rascunho e dos blocos')`. Em `triggers.test.ts`: `TRANSFER_TO_HUMAN` com `{ target: 'LINE' }` sem `lineId` ⇒ erro com path `lineId`; `{ target: 'USER', userId: [3, 5] }` ⇒ ok; `CREATE_TASK` com `responsibleId: []` ⇒ erro.
- [ ] **Step 2: Rodar e ver falhar** — `cd packages/contracts && npx vitest run src/agent-functions.test.ts src/triggers.test.ts` ⇒ FAIL.
- [ ] **Step 3: Implementar** os schemas acima. `availableMarkers` não oferece `BITRIX_OPENLINE`, `AGENT` nem `BITRIX_USER` múltiplo nos contextos `behavior` e `snippet` (só em `intention`).
- [ ] **Step 4: Rodar e ver passar** — mesmo comando + `npx tsc --noEmit -p packages/contracts` ⇒ PASS.
- [ ] **Step 5: Commit** `feat(contracts): campos de vários usuários, canal aberto, agente e transferências`.

### Task 2: Contratos — respostas, checagem e compilação

**Files:**
- Modify: `packages/contracts/src/agent-function-answers.ts` (`checkField`)
- Modify: `packages/contracts/src/agent-functions.ts` (`templateIssues`)
- Modify: `packages/contracts/src/agent-function-compiler.ts` (`Renderer.fieldText`, `renderConfig`, `maxValue`, `compileAgent`)
- Modify: `packages/contracts/src/agent-function-check.ts` (`sampleValue`)
- Modify: `packages/contracts/src/agent-function-plan.ts` (`publishedStateOf`, `transferHash`)
- Test: `agent-function-answers.test.ts`, `agent-functions.test.ts`, `agent-function-compiler.test.ts`, `agent-function-check.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - Respostas: `BITRIX_USER` múltiplo ⇒ `number[]` (1–20, positivos, sem repetir; mensagem `'escolha ao menos um usuário'`); `BITRIX_OPENLINE` ⇒ `number > 0` (`'escolha um canal aberto'`); `AGENT` ⇒ uuid string (`'escolha um agente'`).
  - `CompiledTransfer { key: string; agentId: string /* id local */; fieldId: string; instructions: string; returnOnFinish: boolean }`; `CompiledAgent.transfers: CompiledTransfer[]`.
  - `transferHash(transfer: CompiledTransfer): string`; `PublishedFunctionState.transfers?: Array<{ key; hash }>` (opcional: estados antigos não têm).
  - `renderConfig`: marcador sozinho de `BITRIX_USER` múltiplo ⇒ `number[]`.

- [ ] **Step 1: Testes que falham**
  - answers: `it('usuários: lista de 1 a 20 sem repetir')` (`[3,3]` ⇒ issue; `[]` em obrigatório ⇒ `campo obrigatório`); `it('canal aberto e agente')`.
  - templateIssues: `transfers[].agent` precisa ser marcador sozinho de campo `AGENT` (mensagem `transferência <key>: escolha um campo de agente`); `when` com campo que não é escolha ⇒ mesma mensagem das intenções; dependente usado só em `transfers` conta como usado; `transfer` repetida ⇒ `transferência repetida: <key>`; marcador sem campo em `instructions`.
  - compiler: `it('campo múltiplo vira lista no userId')` ⇒ `compiled.intentions[0].input.actions[0].config.userId` igual a `[3, 5]`; `it('transfers só com a condição atendida')`; `it('template sem transfers compila como antes')` (fixture atual ⇒ `transfers: []`, mesmo `behavior`).
  - check: `sampleAnswerSets` dá `[1]` para múltiplo, `1` para canal, `'00000000-0000-4000-8000-000000000001'` para agente; `checkTemplate` dos templates do seed continua sem erros.
- [ ] **Step 2: Rodar e ver falhar** — `cd packages/contracts && npx vitest run` ⇒ FAIL nos novos.
- [ ] **Step 3: Implementar.** No texto, múltiplo vira `ids.join(', ')`, canal o id, agente `''`; pior caso: múltiplo = 20 × `9999999` com `', '`. `compileAgent` resolve `instructions` com o `Renderer` e lê o id do agente da resposta do campo citado em `agent`.
- [ ] **Step 4: Rodar e ver passar** — `npx vitest run` + `npx tsc --noEmit -p packages/contracts` ⇒ PASS.
- [ ] **Step 5: Commit** `feat(contracts): compilar rodízio, canal aberto e transferências`.

### Task 3: Backend — rodízio, canal aberto, handoff pelo chat de origem e `onTransfer`

**Files:**
- Create: `backend/src/modules/triggers/actions/action-rotation.ts`
- Modify: `backend/src/modules/triggers/actions/action-executor.ts` (`CREATE_TASK`)
- Modify: `backend/src/modules/intentions/intention-runner.ts` (passo `TRANSFER_TO_HUMAN`)
- Modify: `backend/src/modules/channel/pending-handoff.ts`, `human-handoff.ts`, `inbound.consumer.ts` (`handoffAfterReply`), `transfer.consumer.ts`
- Test: `backend/test/integration/intention-runner.test.ts`, `channel-handoff.test.ts`, `backend/src/modules/triggers/actions/action-rotation.test.ts`

**Interfaces:**
- Consumes: Task 1 (`isUserList`, `target: 'LINE'`).
- Produces:
  - `@Injectable() class ActionRotation { constructor(@Inject(REDIS) redis); next(actionId: string, ids: readonly number[]): Promise<number> }` — um id só devolve sem tocar no Redis.
  - `PendingHandoff { agentId: string; userId?: number; lineId?: number; gptmakerChatId?: string }`.
  - `HumanHandoff.start(input: { tenantId; agentId; dialogId; userId?; lineId?; gptmakerChatId? })` — com `gptmakerChatId`, usa-o no lugar de `gptmakerChatIdFor(...)` e grava em `dialog_state.agentId` o agente cujo `gptmakerAgentId` está no chat (`public-api-<gptmakerAgentId>-…`, mesmo portal); sem achar, cai no `agentId` recebido. Com `lineId`: `imopenlines.bot.session.transfer` `{ CHAT_ID, QUEUE_ID: lineId, LEAVE: 'N' }`.
  - `TransferConsumer.process` só registra (`logger.log` "troca de agente no GPT Maker"), sem `HumanHandoff`.

- [ ] **Step 1: Testes que falham**
  - `action-rotation.test.ts` (Redis do Testcontainers ou `ioredis-mock` se já usado no repo): `next('a', [1,2,3])` 4× ⇒ `1,2,3,1`; `next('b', [7])` ⇒ `7` e nenhuma chave criada.
  - `intention-runner.test.ts`: `it('transferência com lista gira entre os usuários')` (duas execuções com campos diferentes ⇒ `PendingHandoffs.peek` com `userId` 3 e depois 5); `it('chamada repetida não gira o rodízio')`; `it('transferência para canal aberto agenda lineId')`; `it('intenção do agente de destino agenda com o chat de origem')` (chat `public-api-<gm do A>-<tenant>:chat9` numa intenção do agente B ⇒ pendente com `gptmakerChatId` igual ao chat recebido).
  - `channel-handoff.test.ts`: `it('start com chat de origem grava o agente de origem')` ⇒ `dialog_state.agentId` = A e fake `startHuman` chamado com o chat de A; `it('canal aberto usa QUEUE_ID')`; `it('onTransfer não inicia atendimento humano')` ⇒ nenhum `dialog_state.humanActive` e nenhuma chamada ao Bitrix.
  - executor (no teste de integração de gatilhos existente): `CREATE_TASK` com `responsibleId: [4, 6]` ⇒ `RESPONSIBLE_ID` 4 e depois 6.
- [ ] **Step 2: Rodar e ver falhar** — `cd backend && npx vitest run --project integration test/integration/intention-runner.test.ts test/integration/channel-handoff.test.ts` ⇒ FAIL.
- [ ] **Step 3: Implementar.** Id da ação para o rodízio: intenção `<intentionId>:<índice>`, gatilho `action.id`. O executor recebe `ActionRotation` no construtor (registrar no módulo de gatilhos e no de intenções). O rodízio do `TRANSFER_TO_HUMAN` roda depois do teste de deduplicação e de `isTestDialog`.
- [ ] **Step 4: Rodar e ver passar** — mesmo comando + typecheck/eslint/prettier ⇒ PASS.
- [ ] **Step 5: Commit** `feat(channel): rodízio de usuários, transferência para canal aberto e onTransfer só registrado`.

### Task 4: Backend — canais abertos do portal e regras de transferência no cliente do GPT Maker

**Files:**
- Create: `backend/src/modules/bitrix/openlines.controller.ts` (ou o controller de recursos do Bitrix existente para o app, se houver) — `GET /bitrix/openlines`
- Modify: `backend/src/modules/gptmaker/gptmaker.client.ts`, `gptmaker.schemas.ts`, `backend/test/support/fake-gptmaker.ts`, `docs/gptmaker-api.md`
- Modify: `packages/contracts/src/` (tipo `OpenLineView { id: number; name: string }` junto dos tipos do app)
- Test: `backend/test/integration/gptmaker-client.test.ts` (ou o teste do cliente existente), teste de integração do controller

**Interfaces:**
- Produces:
  - `GET /bitrix/openlines` (sessão do app, portal da sessão) ⇒ `OpenLineView[]` a partir de `imopenlines.config.list.get` (`ID`, `LINE_NAME`), ordenado por nome.
  - `GptMakerClient.listTransferRules(agentId): Promise<GptMakerTransferRule[]>`, `createTransferRule(agentId, input: GptMakerWriteTransferRule): Promise<string>` (id da resposta), `updateTransferRule(agentId, ruleId, input): Promise<void>`, `deleteTransferRule(agentId, ruleId): Promise<void>`. `GptMakerWriteTransferRule = { type: 'AGENT'; agentId: string; instructions: string; returnOnFinish: boolean }` (o cliente manda `userId: null`).
  - Fake: `fake.transferRules: Map<string /* ruleId */, { agentId /* origem */; body }>` e `count('transferRule.create')` etc.

- [ ] **Step 1: Testes que falham** — cliente contra o fake HTTP do repo: cria ⇒ devolve id; lista ⇒ inclui; `PUT` e `DELETE` nos caminhos da Global Constraints. Controller: portal com duas linhas ⇒ `[{ id, name }]` ordenado.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** e documentar a API em `docs/gptmaker-api.md` (seção nova "Regras de transferência", com o que ainda falta confirmar em staging).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** `feat(gptmaker): regras de transferência e lista de canais abertos`.

### Task 5: Backend — publicação das regras e travas

**Files:**
- Modify: `backend/src/shared/database/schema/agent-functions.ts` (`managedResourceKind` + `'TRANSFER_RULE'`, coluna `transferRuleId: text('transfer_rule_id')`)
- Create: `backend/drizzle/0018_transfer_rules.sql` (gerado)
- Modify: `backend/src/modules/agent-functions/function-publisher.ts` (passo `applyTransfers` depois de `applyIntentions`)
- Modify: `backend/src/modules/agent-functions/function-catalog.service.ts` (`saveTemplateDraft`: trava de `multiple`)
- Modify: `backend/src/modules/agents/agent.service.ts` (`remove`: aviso de destino)
- Test: `backend/test/integration/agent-function-publication.test.ts`, `backoffice-functions.test.ts`, `agent-service.test.ts`

**Interfaces:**
- Consumes: Task 2 (`compiled.transfers`, `transferHash`), Task 4 (cliente).
- Produces:
  - `applyTransfers(config, compiled)`: para cada `CompiledTransfer`, busca o agente local (mesmo `tenantId`, não removido, `id !== config.agentId`); senão lança `DomainError('FUNCTION_TRANSFER_AGENT_INVALID', 'Escolha outro agente em "<label do campo>"', 422)`. Sincroniza pela chave e pelo hash: cria (adotando órfã da lista com mesmo `agentId` de destino e mesmas `instructions`), atualiza, remove o que sumiu (404 ignorado).
  - `saveTemplateDraft`: `BITRIX_USER` publicado com `multiple` diferente ⇒ `FUNCTION_FIELD_LOCKED`, com `{ id, from: 'BITRIX_USER', to: 'BITRIX_USER (vários)' }` (ou o inverso).
  - `AgentService.remove` devolve/registra `usedAsTransferTargetBy: Array<{ id; name }>` (agentes cujo `agent_managed_resource` de `TRANSFER_RULE` aponta para ele); a remoção segue.

- [ ] **Step 1: Testes que falham** — publicação: `it('cria, atualiza e remove regras de transferência')` (fake conta create/update/delete); `it('destino removido falha nomeando o campo e mantém as outras regras')`; `it('destino de outro portal é recusado')`; `it('republicar sem mudança não chama o GPT Maker')`. Backoffice: `it('multiple publicado travado')`. Agentes: `it('remover agente usado como destino avisa quem o usa')`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** e gerar a migração: `cd backend && npx drizzle-kit generate --name transfer_rules` (conferir que o SQL só adiciona o valor do enum e a coluna).
- [ ] **Step 4: Rodar e ver passar** — os três arquivos de integração + `agent-function-sandbox.test.ts` (sandbox ignora `transfers`).
- [ ] **Step 5: Commit** `feat(functions): publicar regras de transferência entre agentes`.

### Task 6: Frontend — formulário do app

**Files:**
- Modify: `frontend/src/app/app/agents/bitrix-pickers.tsx` (`ResponsiblePicker` múltiplo, `OpenLinePicker`, `AgentPicker`)
- Modify: `frontend/src/app/app/agents/function-form.tsx` (casos dos tipos novos e `multiple`)
- Modify: telas manuais de intenções e gatilhos do app que exibem `userId`/`responsibleId` (exibir "N usuários, em rodízio" e "Canal aberto <id>" sem editar a lista)

**Interfaces:**
- Consumes: Task 1/2 (tipos), Task 4 (`GET /bitrix/openlines`), lista de agentes já usada no app.
- Produces: `ResponsiblePicker({ value: number | number[]; multiple?: boolean; onChange })`; `OpenLinePicker({ value: number; onChange })`; `AgentPicker({ value: string; exclude?: string; onChange })` (sem removidos, sem o próprio).

- [ ] **Step 1:** Implementar os seletores; `bx24SelectUsers()` já devolve vários.
- [ ] **Step 2: Verificar** — `cd frontend && npx tsc --noEmit && npx eslint src/app/app/agents` ⇒ ok; no navegador: escolher 3 usuários, um canal e um agente num agente de teste e salvar o formulário.
- [ ] **Step 3: Commit** `feat(app): seletores de vários usuários, canal aberto e agente no formulário da função`.

### Task 7: Frontend — editor do backoffice

**Files:**
- Modify: `frontend/src/app/admin/functions/editor/model.ts`, `field-editor.tsx`, `intention-editor.tsx`, `template-editor.tsx` (seção nova no painel de Ações: "Transferências entre agentes"), `kit.tsx`

**Interfaces:**
- Consumes: Task 1/2.
- Produces: tipos novos no seletor de tipo de campo ("Canal aberto do Bitrix24", "Agente"), chave "Permitir vários usuários" no `BITRIX_USER` (desabilitada se publicado), destino "Canal aberto" em "Transferir para atendente" com o campo de canal, editor de transferência (chave travada depois de publicada, condição, campo de agente, instruções com "Inserir campo", "Voltar ao agente de origem ao terminar"); problemas de `transfers` levam à seção certa (`where.section: 'actions'`, `intentionKey` = chave da transferência).

- [ ] **Step 1:** Implementar.
- [ ] **Step 2: Verificar** — `npx tsc --noEmit && npx eslint src/app/admin/functions` ⇒ ok; no navegador: criar uma transferência com condição num rascunho, ver a prévia e o JSON sincronizados, e o problema "escolha um campo de agente" apontar a transferência.
- [ ] **Step 3: Commit** `feat(backoffice): editor de transferências, canal aberto e vários usuários`.

### Task 8: Skill no repositório

**Files:**
- Create: `.claude/skills/gptthink-criar-funcao/` copiada de `C:\Users\JOAOVI~1\AppData\Local\Temp\claude\C--Users-Joao-Vitor-projects-gpt-maker-core\b64d5dae-93a2-4f62-9b5f-b35193ef8c01\scratchpad\gptthink-criar-funcao` (SKILL.md, `referencia/`, `exemplos/`, `scripts/validar.mjs`)
- Create: `.claude/skills/gptthink-criar-funcao/scripts/gerar-referencia.ts` (rodar com `npx tsx`)
- Create: `packages/contracts/src/skill-validator.test.ts`
- Modify: `.claude/skills/gptthink-function-templates/SKILL.md`

**Interfaces:**
- Consumes: Tasks 1–2 (formato final).
- Produces: `npx tsx .claude/skills/gptthink-criar-funcao/scripts/gerar-referencia.ts` reescreve `referencia/blocos.json`, `exemplos/suporte.json` e `exemplos/sdr.json` a partir de `backend/src/modules/agent-functions/seed`; `validar.mjs` cobre `multiple`, `BITRIX_OPENLINE`, `AGENT`, `target: 'LINE'` e `transfers` (mesmas mensagens de `templateIssues`).

- [ ] **Step 1: Teste que falha** — `skill-validator.test.ts`: para cada template do seed e para um rascunho com `transfers` inválido, roda `node validar.mjs` (via `child_process`) e compara: OK ⇔ `checkTemplate(...).errors` vazio; pior caso impresso igual a `budget.length`.
- [ ] **Step 2: Rodar e ver falhar** — `cd packages/contracts && npx vitest run src/skill-validator.test.ts`.
- [ ] **Step 3: Implementar** o script de geração, atualizar `validar.mjs`, `SKILL.md` e `referencia/formato.md` (tipos novos, rodízio, canal aberto, `transfers`, exemplo de transferência), e a skill do editor.
- [ ] **Step 4: Rodar e ver passar** + `node .claude/skills/gptthink-criar-funcao/scripts/validar.mjs .claude/skills/gptthink-criar-funcao/exemplos/cobranca.json` ⇒ `OK`.
- [ ] **Step 5: Commit** `feat(skills): skill de criação de funções no repositório`.

### Task 9: OpenSpec e verificação final

**Files:**
- Modify: `openspec/changes/agent-function-templates/tasks.md` (marcar 11.1–11.4 e 11.6; 9.3 já marcada)

- [ ] **Step 1:** Rodar a suíte: `cd backend && npx vitest run --project unit && npx vitest run --project integration`; `cd packages/contracts && npx vitest run`; `npx openspec validate agent-function-templates` ⇒ tudo verde.
- [ ] **Step 2:** Marcar as tarefas e commitar `docs(openspec): rodízio, canal aberto e transferência entre agentes`.
- [ ] **Step 3:** 11.5 fica com o usuário em staging (rodízio, `QUEUE_ID`, transferência entre agentes, setting exigido pelo GPT Maker, regra com destino apagado).
