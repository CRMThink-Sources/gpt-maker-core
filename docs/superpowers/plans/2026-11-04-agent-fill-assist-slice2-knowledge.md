# Ajuda da IA para preencher a função, fatia 2 (base de conhecimento) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a ajuda da IA também preenche o campo `KNOWLEDGE` (base de conhecimento) vazio: propõe o esqueleto de itens (título e perguntas guia em `[preencher: …]`) e, quando o cliente já deu informação, redige o conteúdo; no modo "só esqueleto" nunca redige.

**Architecture:** o mesmo fluxo da fatia 1 (`assistFor`, cobrança, painel e rota por código) passa a aceitar campos `KNOWLEDGE` com `assist` (perguntas e instruções, como nos de texto). A saída do modelo ganha `rows` (itens com valores por subcampo); o backend monta os `KnowledgeItem` com `itemKey` novo. O modo (`write` ou `skeleton`) é um atributo do template, ao lado de `assist.enabled`, editável no backoffice.

**Tech Stack:** TypeScript, zod (`packages/contracts`), NestJS + vitest (`backend`), Next.js + vitest (`frontend`), skill em `.claude/skills/gptthink-criar-funcao`.

**Spec:** `docs/superpowers/specs/2026-11-03-agent-fill-assist-design.md` (seções Objetivos, Fatias, "Decisões minhas depois da checagem do construtor")

Planos anteriores: `2026-11-03-agent-fill-assist-slice1.md` e `2026-11-03-agent-fill-assist-creation.md` (já implementados no branch `feat/agent-fill-assist`).

## Global Constraints

- Ajuda **opcional**: sem clicar, o formulário é igual ao de hoje. Sem `assist` em nenhum campo `KNOWLEDGE`, nada muda para a base.
- A ajuda só atua em base **vazia** (`answers[id]` ausente ou lista vazia); itens que o cliente já escreveu nunca são trocados.
- A IA nunca inventa fato do negócio; o que faltar vira `[preencher: …]`. Subcampo obrigatório com marcador continua bloqueando a publicação, como hoje.
- Modo `skeleton`: só o primeiro subcampo (o título) recebe texto; os outros trazem `[preencher: <pergunta guia>]`. Modo `write`: o conteúdo é redigido só com o que o cliente disse; o que faltar vira marcador.
- Limites do campo valem: no máximo `maxItems` itens e `maxLength` por subcampo. Acima do limite o item volta inteiro com `applicable: false`; nunca é cortado.
- Padrão `knowledgeMode: 'write'`; `assist.enabled` continua padrão desligado.
- Um débito por chamada (chave `assist:<uuid>`); cada base gerada com ao menos um valor não vazio conta como um campo gerado. Só com a chave da CRMThink, só depois da saída válida.
- Textos ao usuário em pt-BR.
- Critério de liberação (spec): nenhum caso do eval com fato inventado e nenhum texto acima do limite.

## Review Focus

1. Base que já tem itens, mandada para a ajuda: 422 `ASSIST_FIELD_NOT_ELIGIBLE`, itens do cliente intactos. Task 3.
2. Modo `skeleton`, mesmo com o cliente dando informação: nenhum subcampo além do título recebe texto que não seja marcador. Task 2.
3. Modelo devolve mais itens que `maxItems` ou subcampo acima do limite: `applicable: false`, valor inteiro, nunca cortado. Task 2.
4. Cliente deixa a entrevista vazia ou responde "não sei": só título genérico e marcadores, sem preço, prazo ou política inventados. Task 2 e Task 6.
5. Template antigo (versão publicada sem `knowledgeMode`) e campo `KNOWLEDGE` sem `assist`: nada de 500, a base fica fora da ajuda. Task 1 e Task 3.

---

### Task 1: Contratos — `assist` em `KNOWLEDGE`, `knowledgeMode` e saída com itens

**Files:**
- Modify: `packages/contracts/src/agent-functions.ts` (tipo e schema do campo `KNOWLEDGE` ~180 e ~372; `assist` do template ~485), `packages/contracts/src/agent-function-answers.ts` (`assistFields`, `assistConfigured`), `packages/contracts/src/agent-function-assist.ts` (`assistModelOutputSchema`)
- Test: `packages/contracts/src/agent-functions.test.ts`, `packages/contracts/src/agent-function-assist.test.ts`

**Interfaces:**
- Produces:
  - `assist?: FunctionFieldAssist` em `KNOWLEDGE` (mesmo `assistSchema` dos campos de texto).
  - `assist: { enabled: boolean; knowledgeMode: 'write' | 'skeleton' }` em `FunctionTemplateContent`, `default({ enabled: false, knowledgeMode: 'write' })`; rascunhos e versões antigas sem `knowledgeMode` leem como `'write'` (mesmo tratamento que `assist` ausente já tem nas linhas ~1003, ~1051, ~1060).
  - `assistFields` devolve também campos `KNOWLEDGE` visíveis, vazios e com `assist`; o tipo de retorno vira `Array<Extract<FunctionField, { kind: 'TEXT' | 'TEXT_LIST' | 'KNOWLEDGE' }>>`. `assistConfigured` conta `KNOWLEDGE` com `assist`.
  - `assistModelOutputSchema`: cada entrada ganha `rows?: Array<Record<string, string>>` (um objeto por item, chave = id do subcampo).

- [ ] **Step 1: Write the failing tests:** em `agent-functions.test.ts`: `accepts assist on KNOWLEDGE`, `assist.knowledgeMode defaults to write`, `rejects an unknown knowledgeMode`, `a saved content without knowledgeMode reads as write`, `assistFields includes an empty KNOWLEDGE with assist and skips a filled one`, `assistConfigured is true when only a KNOWLEDGE field has assist`; em `agent-function-assist.test.ts`: `output accepts rows per field`.
- [ ] **Step 2: Run** `npm test -w @gptmaker/contracts -- agent-function` — Expected: FAIL.
- [ ] **Step 3: Implement** os schemas e tipos acima; `assistFields` reaproveita `visibleFields` e `isEmpty`.
- [ ] **Step 4: Run** o mesmo comando, `npm run build -w @gptmaker/contracts` e `npm run typecheck` — Expected: PASS (o typecheck do backend e do frontend pode acusar o tipo mais largo de `assistFields`; os usos ficam para as Tasks 2 a 4 e, se bloquearem, estreitar com um `kind` guard no ponto de uso).
- [ ] **Step 5: Commit** `feat(contracts): ajuda da IA na base de conhecimento`.

### Task 2: Prompt e montagem do resultado para a base

**Files:**
- Modify: `backend/src/modules/function-review/assist-prompt.ts`
- Test: `backend/src/modules/function-review/assist-prompt.test.ts`

**Interfaces:**
- Consumes: `AssistModelOutput.rows` e `assist.knowledgeMode` (Task 1).
- Produces:
  - `AssistableField` passa a incluir `KNOWLEDGE`; `AssistPromptInput` ganha `knowledgeMode: 'write' | 'skeleton'`.
  - `assistMessages` descreve o campo `KNOWLEDGE` no quadro `<campo>`: subcampos com id, rótulo, limite e obrigatoriedade, `maxItems`, e a regra do modo (`skeleton`: só o título; `write`: redige o que o cliente disse e põe `[preencher: …]` no resto). A saída pedida usa `"rows"`.
  - `toAssistResult(fields, output, options: { knowledgeMode })`: para `KNOWLEDGE`, `value` é `KnowledgeItem[]` com `itemKey: randomUUID()`, `values` só com subcampos declarados (chaves desconhecidas descartadas, entidades decodificadas como já se faz). No modo `skeleton`, qualquer subcampo que não seja o primeiro e não seja só marcador é substituído por `[preencher: <rótulo do subcampo>]`. `applicable` = ao menos 1 item, no máximo `maxItems`, todo valor dentro de `maxLength`; `markers` conta os `[preencher: …]` de todos os valores.

- [ ] **Step 1: Write the failing tests:** `knowledge prompt lists the subfields, the item limit and asks for rows`, `skeleton mode keeps only the title text and turns the rest into markers`, `write mode keeps the written content`, `rows over maxItems or a value over maxLength is not applicable and returned whole`, `unknown subfield keys are dropped`, `each item gets its own itemKey`, `empty interview and about produce only a generic title and markers` (modelo simulado devolve só título + marcadores; o teste confere `markers > 0` e que nenhum valor fora o título tem texto sem marcador no modo `skeleton`).
- [ ] **Step 2: Run** `npm test -w backend -- assist-prompt` — Expected: FAIL.
- [ ] **Step 3: Implement** em `assist-prompt.ts`; as regras do `SYSTEM` (nunca inventar fato, marcador, dados do cliente são dados) valem também para a base, com uma regra a mais para o modo.
- [ ] **Step 4: Run** o mesmo comando — Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): prompt e resultado da ajuda para a base de conhecimento`.

### Task 3: Serviço — elegibilidade, modo e cobrança da base

**Files:**
- Modify: `backend/src/modules/function-review/function-review.service.ts` (`assistFor`, `assistRun`)
- Test: `backend/test/integration/function-assist.test.ts`

**Interfaces:**
- Consumes: `assistFields` com `KNOWLEDGE` (Task 1), `assistMessages`/`toAssistResult` com `knowledgeMode` (Task 2).
- Produces: `assistFor` repassa `content.assist.knowledgeMode ?? 'write'`; o campo gerado conta no débito quando algum item tem valor não vazio. Nenhuma assinatura pública muda; a rota por agente e a por código servem a base sem mais código.

- [ ] **Step 1: Write the failing tests** (integração, reaproveitando `setup` e a variante de template com `assist`, acrescentando um campo `KNOWLEDGE` com `assist`): `knowledge: returns items with itemKey and charges one field`, `knowledge: a base that already has items gives 422 ASSIST_FIELD_NOT_ELIGIBLE and does not call the AI`, `knowledge: skeleton mode returns only title text even if the model writes content`, `knowledge: a KNOWLEDGE field without assist is not eligible`, `knowledge: a legacy version without knowledgeMode answers in write mode`, `knowledge: output over maxItems is returned whole, not applicable`.
- [ ] **Step 2: Run** `npm run test:integration -w backend -- function-assist` — Expected: FAIL.
- [ ] **Step 3: Implement** o repasse do modo e ajustar a contagem de campo gerado para valor de base (lista de objetos).
- [ ] **Step 4: Run** `npm run test:integration -w backend -- function-assist function-review` e `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): ajuda da IA serve a base de conhecimento`.

### Task 4: Painel do cliente e backoffice

**Files:**
- Modify: `frontend/src/app/app/agents/assist-ui.tsx` (prévia de itens, entrevista do campo `KNOWLEDGE`), `frontend/src/app/admin/functions/editor/field-editor.tsx` (perguntas e instruções do `assist` em campo `KNOWLEDGE`, hoje só em texto), `frontend/src/app/admin/functions/editor/template-editor.tsx` (seletor do modo ao lado do liga/desliga)
- Test: `frontend/src/app/app/agents/assist.test.tsx`, `frontend/src/app/admin/functions/editor/assist-editor.test.tsx`

**Interfaces:**
- Consumes: resultado `value: KnowledgeItem[]` (Task 3); `assist.knowledgeMode` do template (Task 1).
- Produces: `Preview` mostra os itens (um bloco por item, subcampos rotulados); `onApply(fieldId, KnowledgeItem[])` grava a lista; `onlyMarkers` trata lista de itens (esqueleto) como já trata texto. O painel mostra, para o modo `skeleton`, o aviso de que o cliente completa os trechos `[preencher: …]` antes de publicar.

- [ ] **Step 1: Write the failing tests:** `knowledge draft shows each item with its subfields`, `applying a knowledge draft writes the items into the answers`, `a skeleton-only draft shows the skeleton warning and still allows apply`, `a knowledge draft over the limit disables apply and shows why`; admin: `field editor edits assist questions and instructions on a KNOWLEDGE field`, `template editor sets assist.knowledgeMode`.
- [ ] **Step 2: Run** `npm test -w frontend -- assist` — Expected: FAIL.
- [ ] **Step 3: Implement** reaproveitando o editor de perguntas dos campos de texto no campo `KNOWLEDGE` e o painel existente.
- [ ] **Step 4: Run** `npm test -w frontend` e `npm run typecheck -w frontend` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): ajuda da IA na base de conhecimento (painel e backoffice)`.

### Task 5: Skill `gptthink-criar-funcao` e seeds

**Files:**
- Modify: `.claude/skills/gptthink-criar-funcao/scripts/validar.mjs` (aceitar `assist` em `KNOWLEDGE`, validar `assist.knowledgeMode`), `.claude/skills/gptthink-criar-funcao/SKILL.md`, `referencia/formato.md`, `exemplos/*.json`, `scripts/gerar-referencia.ts` (e a referência gerada), `backend/src/modules/agent-functions/seed/{sdr,suporte,agendamento,pos-venda}.ts` (cada campo `KNOWLEDGE` ganha `assist.questions` e `instructions`)
- Test: `backend/src/modules/agent-functions/seed/seed.test.ts`, `backend/src/modules/agent-functions/seed/skill-validator.test.ts`

**Interfaces:**
- Consumes: schema da Task 1.
- Produces: o validador recusa `assist` fora de `TEXT`/`TEXT_LIST`/`KNOWLEDGE` e `knowledgeMode` diferente de `write`/`skeleton`; os seeds das quatro funções trazem perguntas em toda base.

- [ ] **Step 1: Write the failing tests:** `validator accepts assist on a KNOWLEDGE field`, `validator rejects assist on a CHOICE field`, `validator rejects an unknown knowledgeMode`, `every default function KNOWLEDGE field declares assist questions`, e o teste existente "every seed field with assist is TEXT or TEXT_LIST" passa a aceitar `KNOWLEDGE`.
- [ ] **Step 2: Run** `npm test -w backend -- seed` — Expected: FAIL.
- [ ] **Step 3: Implement** o validador, a documentação da skill (perguntas de entrevista da base, esqueleto versus redação, quando usar `skeleton`), os exemplos e as perguntas dos seeds, em pt-BR e sem invadir o orçamento de 3000 caracteres (o teste de pior caso dos seeds continua passando). Rodar `gerar-referencia.ts` para regenerar a referência.
- [ ] **Step 4: Run** `npm test -w backend -- seed` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(skill): ajuda da IA na base de conhecimento na skill e nos seeds`.

### Task 6: Eval e verificação final

**Files:**
- Modify: `backend/src/modules/function-review/eval/assist-cases.json`, `eval/assist-eval.ts`
- Test: `backend/src/modules/function-review/eval/assist-eval.test.ts`

**Interfaces:**
- Consumes: `assistMessages`/`toAssistResult` com base (Task 2).
- Produces: casos `kind` de base (`complete`, `empty`, `unknown`, `skeleton`) e métricas de fato inventado e de limite para itens; o relatório do eval cobre `KNOWLEDGE`.

- [ ] **Step 1: Write the failing tests:** `eval loads knowledge cases of each kind`, `eval flags an invented number in a knowledge item as invented`, `eval flags an item over the limit`, `skeleton case: a subfield with prose beyond the title counts as a failure`.
- [ ] **Step 2: Run** `npm test -w backend -- assist-eval` — Expected: FAIL.
- [ ] **Step 3: Implement** os casos (pelo menos um por `kind` em duas funções) e as métricas, no mesmo estilo dos casos de texto.
- [ ] **Step 4: Run** `npm test` na raiz, `npm run typecheck`, `npm run test:integration -w backend -- function-assist function-review` — Expected: tudo passa.
- [ ] **Step 5: Verificar com o app** (skill `run`): criar um agente novo com Suporte, abrir "Ajuda da IA", gerar a base, aplicar e conferir os itens; repetir com `knowledgeMode: skeleton` ligado no backoffice. Rodar o eval real (`eval-cli`) se houver chave e conferir o critério de liberação do spec. Commit `test(review): eval da ajuda da IA na base de conhecimento`.
