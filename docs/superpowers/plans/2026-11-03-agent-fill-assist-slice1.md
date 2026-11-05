# Ajuda da IA para preencher a função, fatia 1 (campos de texto) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o cliente clica em "Ajuda da IA", responde a perguntas de entrevista e a IA redige os campos de texto (`TEXT`, `TEXT_LIST`) vazios da função; tudo parametrizado no backoffice, na skill e nos seeds.

**Architecture:** um atributo `assist` por campo de texto (perguntas e instruções) e um `assist.enabled` no template, ao lado do `review` que já existe. Um método `assist` no `FunctionReviewService` reaproveita a chave de IA, o limite por tenant, a cobrança e a validação de saída da revisão. A tela mostra o resultado num painel próprio com Aplicar/Descartar por campo.

**Tech Stack:** TypeScript, zod (`packages/contracts`), NestJS + Drizzle + vitest (`backend`), Next.js + vitest (`frontend`), skill em `.claude/skills/gptthink-criar-funcao`.

**Spec:** `docs/superpowers/specs/2026-11-03-agent-fill-assist-design.md`

## Global Constraints

- Ajuda **opcional**: sem clicar, o formulário é igual ao de hoje.
- Só `TEXT` e `TEXT_LIST`. Escolhas e base de conhecimento ficam fora (a base é a fatia 2).
- A ajuda só atua em campo **vazio**; texto já escrito nunca é trocado.
- Padrão **desligado**: `assist.enabled` é `false` até o template ligar e ao menos um campo ter perguntas.
- A IA nunca inventa fato do negócio; o que faltar vira `[preencher: …]`.
- A IA recebe o limite do próprio campo; o orçamento de 3000 do comportamento continua barrado na publicação.
- Nada é publicado sem o cliente aplicar e publicar; marcador `[preencher: …]` pendente continua bloqueando a publicação.
- Critério de liberação: nenhum caso do eval com fato inventado e nenhum texto acima do limite.
- Textos e mensagens ao usuário em pt-BR.

## Desvio do desenho (informado ao usuário)

O desenho dizia que o resultado cai no assistente de sugestões (`agent-review-wizard`). Esse assistente
está incompleto (8 de 23 tarefas em `openspec/changes/agent-review-wizard`), então a fatia 1 usa um
painel próprio e pequeno. Ligar os dois fica para depois.

## Review Focus

1. Campo de texto já preenchido, mandado para a ajuda: recusado com 422, texto do cliente intacto. Task 4.
2. Resposta da IA acima do limite do campo: `applicable: false`, nunca cortada em silêncio. Task 3.
3. Cliente responde "não sei" ou deixa a entrevista vazia: a IA devolve só marcadores, sem fato inventado. Task 3 e Task 6.
4. Função com `assist.enabled: false` ou sem perguntas, mesmo chamando a API direto: 422, sem chamar a IA nem cobrar. Task 4.
5. Falha da IA ou saída inválida: o campo não é cobrado e o botão pode tentar de novo. Task 4.

---

### Task 1: Contratos do template — `assist` por campo e `assist.enabled`

**Files:**
- Modify: `packages/contracts/src/agent-functions.ts` (tipos `FunctionField` TEXT e TEXT_LIST ~linhas 94-117, `functionFieldSchema` ~279-321, `functionTemplateContentSchema` ~450)
- Test: `packages/contracts/src/agent-functions.test.ts`

**Interfaces:**
- Produces:
  - `interface FunctionFieldAssist { questions: string[]; instructions?: string }` (`questions` 1 a 5 itens, cada um 1 a 200 caracteres; `instructions` até 500).
  - `assist?: FunctionFieldAssist` em `TEXT` e `TEXT_LIST`.
  - `assist: { enabled: boolean }` em `FunctionTemplateContent`, `default({ enabled: false })`.
  - `export function assistFields(content: FunctionTemplateContent, answers: FunctionAnswers): Array<Extract<FunctionField, { kind: 'TEXT' | 'TEXT_LIST' }>>`: vazio se `assist.enabled` é falso; senão os campos visíveis (`visibleFields`) `TEXT`/`TEXT_LIST` que têm `assist` e cuja resposta está vazia.

- [ ] **Step 1: Write the failing tests** em `agent-functions.test.ts`: `accepts assist on TEXT and TEXT_LIST`, `rejects assist with 0 or 6 questions`, `template assist.enabled defaults to false`, `assistFields returns only empty visible text fields with assist when enabled`, `assistFields returns [] when assist.enabled is false`.
- [ ] **Step 2: Run** `npm test -w @gptmaker/contracts -- agent-functions` — Expected: FAIL.
- [ ] **Step 3: Implement** o schema `assistSchema` com `z.strictObject`, os campos opcionais e `assistFields` (reusar `isEmpty`/`visibleFields` do pacote; exportar o que faltar).
- [ ] **Step 4: Run** o mesmo comando — Expected: PASS. Rodar também `npm run typecheck -w @gptmaker/contracts`.
- [ ] **Step 5: Commit** `feat(contracts): assist por campo e liga/desliga no template`.

### Task 2: Contrato da chamada da ajuda

**Files:**
- Create: `packages/contracts/src/agent-function-assist.ts`
- Modify: `packages/contracts/src/index.ts` (exportar)
- Test: `packages/contracts/src/agent-function-assist.test.ts`

**Interfaces:**
- Consumes: `functionAnswersSchema`, `FunctionAnswerValue`, `EXPECTATION_MIN/MAX` (de `agent-knowledge-review.ts`).
- Produces:
  - `assistInputSchema = z.object({ fieldIds: z.array(fieldId).min(1).max(20), about: <string EXPECTATION_MIN..EXPECTATION_MAX>, interview: z.array(z.object({ fieldId, answers: z.array(z.object({ question: z.string().max(200), answer: z.string().max(1000) })).max(5) })).max(20), answers: functionAnswersSchema })` e o tipo `AssistInput`.
  - `assistModelOutputSchema = z.object({ fields: z.array(z.object({ fieldId: z.string(), text: z.string().optional(), items: z.array(z.string()).optional() })) })`.
  - `assistResultSchema = z.object({ fields: z.array(z.object({ fieldId, value: <FunctionAnswerValue>, applicable: z.boolean(), markers: z.number().int().nonnegative() })), credits: z.number().int().nonnegative() })` e `AssistResult`.

- [ ] **Step 1: Write the failing tests:** `accepts a valid input`, `rejects about shorter than EXPECTATION_MIN`, `rejects more than 5 answers per field`, `result requires applicable per field`.
- [ ] **Step 2: Run** `npm test -w @gptmaker/contracts -- agent-function-assist` — Expected: FAIL.
- [ ] **Step 3: Implement** o arquivo e o export.
- [ ] **Step 4: Run** — Expected: PASS; `npm run build -w @gptmaker/contracts` para o backend e o frontend enxergarem os tipos.
- [ ] **Step 5: Commit** `feat(contracts): contrato da chamada da ajuda da IA`.

### Task 3: Prompt e leitura da saída (funções puras)

**Files:**
- Create: `backend/src/modules/function-review/assist-prompt.ts`
- Test: `backend/src/modules/function-review/assist-prompt.test.ts`

**Interfaces:**
- Consumes: `FunctionField` (TEXT/TEXT_LIST), `AssistInput['interview']`, `AssistModelOutput`; padrão de `review-prompt.ts` (`fieldMessages`, `toFieldResult`, `isOnlyMarker`).
- Produces:
  - `assistMessages(input: { fields: AssistableField[]; about: string; interview: AssistInput['interview']; context: { functionName: string; functionDescription: string; agentName: string } }): VibecodeMessage[]` — o sistema manda: redigir só a partir de `about` e das respostas, nunca inventar fato, usar `[preencher: o que falta]` onde faltar, respeitar o limite de cada campo, devolver JSON no formato de `assistModelOutputSchema`, e incluir `field.assist.instructions` de cada campo.
  - `toAssistResult(fields: AssistableField[], output: AssistModelOutput): AssistResult['fields']` — para `TEXT`, `value` é o texto e `applicable` é `text.length <= maxLength`; para `TEXT_LIST`, `value` é a lista, `applicable` exige no máximo `maxItems` itens e cada um até `itemMaxLength`; `markers` conta os `[preencher: …]`; campo ausente na saída vira `value` vazio com `applicable: false`; nunca corta texto.
  - `AssistableField = Extract<FunctionField, { kind: 'TEXT' | 'TEXT_LIST' }>`.

- [ ] **Step 1: Write the failing tests:** `messages carry the field limit and the instructions`, `messages forbid invented facts and ask for markers`, `text above maxLength is applicable false and not truncated`, `list with too many or too long items is applicable false`, `counts [preencher: …] markers`, `missing field in the output is not applicable`, `empty interview still produces a messages array without answers`.
- [ ] **Step 2: Run** `npm test -w backend -- assist-prompt` — Expected: FAIL.
- [ ] **Step 3: Implement** as duas funções.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): prompt e leitura da saída da ajuda da IA`.

### Task 4: Serviço e rota `POST app/agents/:id/function/assist`

**Files:**
- Modify: `backend/src/modules/function-review/function-review.service.ts` (novo método público `assist`), `function-review.controller.ts`
- Create: `backend/src/modules/function-review/assist.controller.ts` (rota fora do `:reviewId`, ver abaixo)
- Test: `backend/test/integration/function-assist.test.ts` (mesmo arranjo de `function-review.test.ts`)

**Interfaces:**
- Consumes: `assistFields`, `AssistInput`, `AssistResult` (Tasks 1 e 2), `assistMessages`, `toAssistResult` (Task 3); privados já existentes `template`, `chooseKey`, `apiKey`, `assertBalance`, `charge`, `ask`, `tenantLimit`.
- Produces: `FunctionReviewService.assist(tenantId: string, agentId: string, input: AssistInput): Promise<AssistResult>`; rota `POST /app/agents/:id/function/assist` com `@AppAuth('manage')`, `@HttpCode(200)`, DTO via `createZodDto(assistInputSchema)`.
- Regras: valida `input.answers` com `validateFunctionAnswers(..., { partial: true })` como em `reviewField`; todo `fieldIds` precisa estar em `assistFields(content, answers)`, senão `DomainError('ASSIST_FIELD_NOT_ELIGIBLE', ..., 422)`; `assist.enabled` falso ou nenhum campo elegível dá `DomainError('ASSIST_NOT_ENABLED', ..., 422)` antes de chamar a IA; o preço é `REVIEW_CREDITS_PER_FIELD` por campo gerado (`credits` no resultado); a cobrança usa uma chave por campo (`assist:<uuid>:<fieldId>`) só depois da saída válida; falha libera sem cobrar.

- [ ] **Step 1: Write the failing integration tests:** `refuses a filled field with 422 and does not call the AI`, `refuses when assist is disabled`, `returns a result per field and charges once per field with the platform key`, `does not charge when the AI output is invalid`, `does not charge with the tenant key`, `answers with an empty interview use markers only`.
- [ ] **Step 2: Run** `npm run test:integration -w backend -- function-assist` — Expected: FAIL.
- [ ] **Step 3: Implement** `assist` no serviço e o controller; registrar o controller no `function-review.module.ts`.
- [ ] **Step 4: Run** o integration acima e `npm run test:integration -w backend -- function-review` (a revisão existente não pode quebrar) — Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): rota da ajuda da IA para campos de texto`.

### Task 5: Eval da ajuda

**Files:**
- Create: `backend/src/modules/function-review/eval/assist-cases.json`, `assist-eval.ts`
- Modify: `backend/scripts/review-eval.ts` (flag `--assist`)
- Test: `backend/src/modules/function-review/eval/assist-eval.test.ts`

**Interfaces:**
- Consumes: `assistMessages`, `toAssistResult`, o formato de `eval-case.ts`/`eval-runner.ts`.
- Produces: `evaluateAssistCase(case, output): { inventedFacts: string[]; overLimit: boolean; markers: number }`; casos para SDR e Suporte com entrevista completa, vazia e com "não sei". "Fato inventado" é número, prazo, preço ou nome próprio na saída que não aparece em `about` nem nas respostas.

- [ ] **Step 1: Write the failing tests:** `flags a number that is not in the interview`, `accepts facts that come from the interview`, `flags text above the limit`, `all cases load and validate`.
- [ ] **Step 2: Run** `npm test -w backend -- assist-eval` — Expected: FAIL.
- [ ] **Step 3: Implement** o avaliador, os casos e a flag; seguir `eval-runner.ts` para a execução real.
- [ ] **Step 4: Run** os testes (PASS) e, com chave, `npm run review:eval -w backend -- --assist`; o resultado deve ser zero fatos inventados. Se não for, ajustar o prompt da Task 3 antes de seguir.
- [ ] **Step 5: Commit** `test(review): eval da ajuda da IA`.

### Task 6: Frontend — botão e painel da ajuda

**Files:**
- Create: `frontend/src/app/app/agents/use-function-assist.ts`, `frontend/src/app/app/agents/assist-ui.tsx`
- Modify: `frontend/src/app/app/agents/function-form.tsx` (montar o botão e o painel; aplicar valores em `answers`)
- Test: `frontend/src/app/app/agents/assist.test.tsx`

**Interfaces:**
- Consumes: `assistFields`, `AssistInput`, `AssistResult`; o `Api` e o `base` que `useFunctionReview` já usa.
- Produces: `useFunctionAssist(api: Api, base: string): { run(input: AssistInput): Promise<AssistResult>; state: 'idle' | 'loading' | 'done' | 'error'; error?: string }`; `AssistPanel({ form, answers, onApply }: { form: FunctionTemplateContent; answers: FunctionAnswers; onApply: (fieldId: string, value: FunctionAnswerValue) => void })`.
- Comportamento: o botão "Ajuda da IA" só aparece se `assistFields(form, answers).length > 0`; o painel pede "Fale da empresa e do que o agente deve fazer" (mínimo 20 caracteres), mostra as perguntas de cada campo elegível, chama `run`, lista o texto de cada campo com **Aplicar** (desabilitado se `applicable` é falso, com o motivo) e **Descartar**, avisa quantos `[preencher: …]` ficaram, e mostra o custo em créditos antes de gerar quando a chave é a da CRMThink.

- [ ] **Step 1: Write the failing tests:** `button is hidden when no field is eligible`, `button is hidden when assist is disabled`, `about shorter than 20 characters blocks generating`, `apply writes the value into answers`, `not applicable result disables apply and shows why`, `error shows a message and allows trying again`, `form without assist renders as before`.
- [ ] **Step 2: Run** `npm test -w frontend -- assist` — Expected: FAIL.
- [ ] **Step 3: Implement** o hook, o painel e a montagem no formulário.
- [ ] **Step 4: Run** `npm test -w frontend` e `npm run typecheck -w frontend` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): botão e painel da ajuda da IA`.

### Task 7: Backoffice — editar perguntas, instruções e liga/desliga

**Files:**
- Modify: `frontend/src/app/admin/functions/editor/field-editor.tsx` (seção "Ajuda da IA" nos casos `TEXT` ~392 e `TEXT_LIST` ~440), `template-editor.tsx` (chave "Ajuda da IA" ao lado de `crmAccess`), `model.ts` (default `assist: { enabled: false }`)
- Test: `frontend/src/app/admin/functions/editor/assist-editor.test.tsx`

**Interfaces:**
- Consumes: `FunctionFieldAssist` e `assist.enabled` (Task 1).
- Produces: no campo, lista editável de 1 a 5 perguntas (200 caracteres cada) e "Instruções para a IA" (500); no template, a chave `assist.enabled`; ligar a chave sem nenhum campo com perguntas mostra aviso "nenhum campo tem perguntas". Remover todas as perguntas remove `assist` do campo.

- [ ] **Step 1: Write the failing tests:** `adds and removes questions up to 5`, `removing all questions drops assist from the field`, `toggle sets assist.enabled`, `warns when enabled without any field with questions`, `JSON tab round-trips assist`.
- [ ] **Step 2: Run** `npm test -w frontend -- assist-editor` — Expected: FAIL.
- [ ] **Step 3: Implement** os controles seguindo o padrão dos campos vizinhos.
- [ ] **Step 4: Run** — Expected: PASS; depois `npm run typecheck -w frontend`.
- [ ] **Step 5: Commit** `feat(admin): editar a ajuda da IA no editor de função`.

### Task 8: Skill, validador e seeds das funções padrão

**Files:**
- Modify: `.claude/skills/gptthink-criar-funcao/SKILL.md` (processo: perguntar/gerar as perguntas de entrevista), `referencia/formato.md` (seção "Ajuda da IA (`assist`)"), `scripts/validar.mjs` (aceita `assist` em `TEXT`/`TEXT_LIST`, recusa em outros tipos, 1 a 5 perguntas de até 200, instruções até 500, `assist.enabled` booleano), `scripts/gerar-referencia.ts`
- Modify: `backend/src/modules/agent-functions/seed/suporte.ts`, `sdr.ts`, `agendamento.ts`, `pos-venda.ts` (perguntas nos campos `TEXT`/`TEXT_LIST` difíceis, como `sdr.perfil_ideal`, `sdr.criterio`, `sdr.perguntas`, `suporte.excluidos`; `assist: { enabled: true }` no template)
- Test: `backend/src/modules/agent-functions/seed/skill-validator.test.ts`, `seed.test.ts`

**Interfaces:**
- Consumes: o schema da Task 1.
- Produces: seeds e exemplos regenerados com `assist`; `validar.mjs` equivalente ao schema.

- [ ] **Step 1: Write the failing tests:** em `skill-validator.test.ts`, `validator accepts assist on a text field`, `validator rejects assist on a CHOICE field`, `validator rejects 6 questions`; em `seed.test.ts`, `every default function with assist.enabled has at least one field with questions`.
- [ ] **Step 2: Run** `npm test -w backend -- skill-validator seed` — Expected: FAIL.
- [ ] **Step 3: Implement** o validador, o formato, o SKILL.md (passo novo no Processo e no formato de saída) e as perguntas dos seeds; escrever perguntas em linguagem de leigo, como "Que sinais fazem um lead valer uma ligação sua?"; rodar `npx tsx .claude/skills/gptthink-criar-funcao/scripts/gerar-referencia.ts`.
- [ ] **Step 4: Run** `npm test -w backend` — Expected: PASS (inclui o teste que acusa referência velha).
- [ ] **Step 5: Commit** `feat(skill): ajuda da IA na skill, no validador e nos seeds`.

### Task 9: Verificação final

- [ ] **Step 1:** `npm run format:check && npm run lint && npm run typecheck && npm test` na raiz — Expected: tudo passa.
- [ ] **Step 2:** `npm run test:integration -w backend` — Expected: PASS.
- [ ] **Step 3:** rodar o app (skill `run`), abrir o Suporte e o SDR, clicar em "Ajuda da IA", gerar, aplicar e confirmar que um campo já preenchido não aparece na ajuda.
- [ ] **Step 4:** confirmar com o usuário como os seeds chegam ao banco em produção (publicação de nova versão); se for manual, registrar o passo no PR.
