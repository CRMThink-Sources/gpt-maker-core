# Ajuda da IA no assistente de criação do agente — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o botão "Ajuda da IA" também aparece no assistente de criação do agente (onde o formulário está todo vazio), e fica sempre visível, desabilitado com o motivo, quando a função tem a ajuda mas nenhum campo vazio.

**Architecture:** a lógica de `FunctionReviewService.assist` passa a receber o template já resolvido, para duas rotas a compartilharem: a existente, por agente, e uma nova, por código da função (`POST /app/agent-functions/:code/assist`), que não precisa de agente. O painel do cliente recebe o endereço da chamada em vez de montá-lo a partir do agente.

**Tech Stack:** TypeScript, zod (`packages/contracts`), NestJS + Drizzle + vitest (`backend`), Next.js + vitest (`frontend`).

**Spec:** `docs/superpowers/specs/2026-11-03-agent-fill-assist-design.md` (seção "Adendo: assistente de criação")

Este plano continua `docs/superpowers/plans/2026-11-03-agent-fill-assist-slice1.md` (já implementado no branch `feat/agent-fill-assist`). A base de conhecimento (fatia 2) segue fora, com plano próprio.

## Global Constraints

- Ajuda opcional: onde a função não tem `assist.enabled`, o assistente de criação e a tela da função renderizam **exatamente como hoje**.
- Só `TEXT` e `TEXT_LIST`, só campos vazios, como na fatia 1. Nenhuma regra de prompt, cobrança, escape ou limite muda.
- A rota por código usa a disponibilidade da função para o portal (`catalog.latestPublished(code, tenantId)`): função inativa, excluída ou restrita a outro portal dá 422 `FUNCTION_NOT_AVAILABLE`, sem chamar a IA nem cobrar.
- Acesso `manage`, o mesmo de criar agente (`POST /app/agents`).
- Um único débito por chamada, chave `assist:<uuid>`, só depois da saída válida e só com a chave da CRMThink, como hoje.
- Textos ao usuário em pt-BR.

## Review Focus

1. Função inativa, excluída ou de outro portal chamada pela rota por código: 422 sem chamar a IA nem cobrar. Task 2.
2. Função sem `assist` ligado no assistente de criação: o formulário aparece sem botão e sem diferença visual. Task 3.
3. Cliente troca de função no passo 1 depois de gerar: rascunhos da função anterior não podem ser aplicados na nova. Task 3.
4. Débito sem agente: o razão aceita `agentId` ausente e o saldo cai uma vez. Task 2.
5. Tenant A não alcança função restrita ao tenant B pela rota por código. Task 2.

---

### Task 1: Helper `assistConfigured`

**Files:**
- Modify: `packages/contracts/src/agent-function-answers.ts` (ao lado de `assistFields`)
- Test: `packages/contracts/src/agent-functions.test.ts`

**Interfaces:**
- Produces: `export function assistConfigured(content: Pick<FunctionTemplateContent, 'fields' | 'assist'>): boolean`. Verdadeiro se `content.assist?.enabled` e algum campo `TEXT`/`TEXT_LIST` (inclusive dependentes de opção, via `flattenFields`) tem `assist`. Aceita conteúdo antigo sem `assist`.

- [ ] **Step 1: Write the failing tests:** `assistConfigured is false when assist is missing (legacy)`, `is false when enabled but no field has assist`, `is true when enabled and a field has assist`, `finds assist on an option dependent`.
- [ ] **Step 2: Run** `npm test -w @gptmaker/contracts -- agent-functions` — Expected: FAIL.
- [ ] **Step 3: Implement** a função reaproveitando `flattenFields`.
- [ ] **Step 4: Run** o mesmo comando e `npm run build -w @gptmaker/contracts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(contracts): assistConfigured`.

### Task 2: Rota por código da função

**Files:**
- Modify: `backend/src/modules/function-review/function-review.service.ts` (extrair o miolo de `assist`), `assist.controller.ts` ou novo `assist-by-code.controller.ts`, `assist-prompt.ts` (contexto sem nome de agente), `function-review.module.ts`
- Test: `backend/test/integration/function-assist.test.ts` (novos casos), `backend/src/modules/function-review/assist-prompt.test.ts`

**Interfaces:**
- Consumes: `catalog.latestPublished(code: string, tenantId: string): Promise<PublishedFunction>` (já valida disponibilidade e dá `FUNCTION_NOT_AVAILABLE`); `AssistInput`/`AssistResult`; `assistFields`.
- Produces:
  - `FunctionReviewService.assistByCode(tenantId: string, code: string, input: AssistInput): Promise<AssistResult>`.
  - Refatoração: `assist(tenantId, agentId, input)` passa a resolver o template (como hoje, versão mais recente) e delegar a um método privado `assistFor(tenantId, source: { content: FunctionTemplateContent; functionName: string; functionDescription: string; agentName?: string; agentId?: string }, input: AssistInput)`. Nenhum comportamento da rota por agente muda.
  - Rota `POST /app/agent-functions/:code/assist`, `@AppAuth('manage')`, `@HttpCode(200)`, mesmo DTO.
  - `assistMessages` aceita `context.agentName` opcional; sem ele a linha do prompt vira só `Função: <functionName>`.
  - O débito sem agente grava `agentId` ausente: o construtor verifica em `LedgerService.debit` que o campo é opcional e, se não for, ajusta o tipo no menor ponto possível.

- [ ] **Step 1: Write the failing tests:** (integração) `by code: returns a result with the latest published version`, `by code: inactive function gives 422 FUNCTION_NOT_AVAILABLE and does not call the AI`, `by code: function restricted to another tenant gives 422 and does not call the AI`, `by code: charges one debit without agent id`, `by code: disabled assist gives 422 ASSIST_NOT_ENABLED`; (unitário) `prompt without agentName prints only the function`.
- [ ] **Step 2: Run** `npm run test:integration -w backend -- function-assist` e `npm test -w backend -- assist-prompt` — Expected: FAIL.
- [ ] **Step 3: Implement** a refatoração e a rota; reaproveitar o setup de templates por teste que já existe em `function-assist.test.ts`.
- [ ] **Step 4: Run** os dois comandos acima, mais `npm run test:integration -w backend -- function-review` (a revisão e a rota por agente não podem quebrar) e `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): ajuda da IA por código da função, sem agente`.

### Task 3: Painel no assistente de criação e botão sempre visível

**Files:**
- Modify: `frontend/src/app/app/agents/assist-ui.tsx` (`FormAssist`: troca `base` por `endpoint`; botão visível desabilitado), `use-function-assist.ts` (recebe o `endpoint` completo), `frontend/src/app/app/agents/[id]/function/page.tsx` (passa `endpoint: ${base}/function/assist`), `create-agent-wizard.tsx` (monta a ajuda com `useAiKey(api)` e `endpoint: /app/agent-functions/${encodeURIComponent(chosen)}/assist`)
- Test: `frontend/src/app/app/agents/assist.test.tsx`, novo `create-agent-wizard-assist.test.tsx`

**Interfaces:**
- Consumes: `assistConfigured` e `assistFields` (Task 1 e fatia 1); rota da Task 2.
- Produces:
  - `FormAssist = { api: Api; endpoint: string; aiKey?: AiKeyView | null }`.
  - `useFunctionAssist(api: Api, endpoint: string, options?)`.
  - Regra do painel: sem `assistConfigured(form)` não renderiza nada; com `assistConfigured` e nenhum campo elegível, mostra o botão **desabilitado** com o texto "Todos os campos com ajuda já estão preenchidos"; com campo elegível, como hoje.
  - No assistente de criação, o painel recebe `key={chosen}` para descartar rascunhos e perguntas ao trocar de função.

- [ ] **Step 1: Write the failing tests:** `button is disabled with a reason when assist is configured but no field is empty`, `nothing renders when assist is not configured`, `the hook posts to the given endpoint`, `wizard: shows the button for a function with assist and an empty form`, `wizard: no button and no extra markup for a function without assist`, `wizard: switching function discards drafts`, `wizard: applying writes the value into the wizard answers`, `function page still posts to /function/assist`.
- [ ] **Step 2: Run** `npm test -w frontend -- assist` — Expected: FAIL.
- [ ] **Step 3: Implement** a troca de `base` por `endpoint` e a montagem no assistente.
- [ ] **Step 4: Run** `npm test -w frontend`, `npm run typecheck -w frontend` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): ajuda da IA no assistente de criação do agente`.

### Task 4: Verificação final e adendo ao spec

- [ ] **Step 1:** `npm test` na raiz, `npm run typecheck`, `npm run test:integration -w backend -- function-assist function-review` — Expected: tudo passa.
- [ ] **Step 2:** rodar o app (skill `run`): criar um agente novo com a função Suporte (com `assist` ligado), clicar em "Ajuda da IA" no passo do formulário, gerar, aplicar e criar o agente; repetir com uma função sem `assist` e confirmar que nada mudou.
- [ ] **Step 3:** conferir o adendo "assistente de criação" no spec e commitar.
