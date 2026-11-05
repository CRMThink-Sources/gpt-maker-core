# Tasks

## 1. Contratos

- [x] 1.1 Em `packages/contracts/src/agent-functions.ts`, adicionar `review.examples` (`{ good, bad }`, até 400 caracteres cada, opcional) aos esquemas de texto, lista e subcampo de base. Verificação: testes do contrato aceitam templates com e sem `examples`, recusam `examples` sem `bad` ou acima do limite e seguem recusando chave desconhecida em `review`.
- [x] 1.2 Em `packages/contracts/src/agent-knowledge-review.ts`, trocar o problema por `{ code, category, severity, text }` com `category` (8 valores) e `severity` (`blocks` | `polish`), normalizando valor desconhecido para `other`/`polish`, e adicionar `expectation` opcional ao corpo de criação da revisão (mesmos limites de `EXPECTATION_MIN`/`MAX`). Exportar rótulos pt-BR das categorias. Verificação: testes do contrato cobrem categoria desconhecida → `other`, gravidade ausente → `polish` e `expectation` curta demais recusada.

## 2. Prompts e serviço

- [x] 2.1 Em `review-prompt.ts`, criar o bloco de contexto de papel por tipo de campo (texto, lista, base) e o catálogo de erros comuns, e levá-lo ao prompt de sistema do campo e ao da cobertura; pedir `category` e `severity` na saída e preencher `code` com a categoria. Verificação: testes de `review-prompt` conferem que o bloco do tipo certo está no prompt, que a regra "nunca inventar dado" continua presente e que a saída sem `code` é aceita.
- [x] 2.2 Montar o contexto da função: `description` do template (até 400 caracteres), `expectation` e títulos dos itens dos outros campos de base (40 por campo, 2000 caracteres no total, cortando os mais longos, nunca o campo revisado) e incluí-los em `fieldMessages`. Verificação: teste unitário do corte (acima do teto, campo revisado intacto, sem conteúdo completo de outros campos no prompt) e do prompt sem expectativa.
- [x] 2.3 Incluir `review.examples` no prompt do campo, com a instrução de usar como referência e não copiar. Verificação: teste de prompt com e sem `examples`.
- [x] 2.4 Guardar `expectation` na sessão do Redis quando enviada na criação, lê-la nas revisões de campo e na cobertura (preferindo-a à do corpo de `/gaps`) e normalizar categoria/gravidade em `toFieldResult`. Verificação: testes de integração de `function-review` (a expectativa chega ao prompt de campo e à cobertura; `/gaps` sem `expectation` no corpo usa a da sessão; sessão expirada segue como hoje).

## 3. Tela

- [x] 3.1 Em `review-logic.ts`, criar a ordenação por gravidade, a regra de recolher os `polish` (mais de 3 problemas no item) e a contagem de itens `blocks` x só `polish`. Verificação: testes unitários das três funções.
- [x] 3.2 Em `review-ui.tsx` e `use-function-review.ts`, mostrar a categoria em cada problema, ordenar e recolher conforme 3.1, contar no resumo ("N itens atrapalham o agente, M têm melhorias") e enviar `expectation` ao criar a revisão. Verificação: testes `review.test.tsx` e `use-function-review.test.tsx` cobrem ordem, recolher/abrir, resumo e o corpo da criação.

## 4. Templates e skill

- [x] 4.1 Escrever rubricas específicas e `examples` (um bom e um ruim) nos campos principais dos seeds SDR, Suporte, Agendamento e Pós-venda, usando o conteúdo dos testes já feitos no Suporte e no SDR. Verificação: `seed.test.ts` e `skill-validator.test.ts` passam e nenhum exemplo passa do limite do campo.
- [x] 4.2 Atualizar a skill `gptthink-criar-funcao` (`SKILL.md`, `referencia/formato.md`, `scripts/validar.mjs` e os exemplos JSON) para aceitar e checar `review.examples`. Verificação: o validador recusa `examples` malformado e aceita os exemplos atualizados.

## 5. Conjunto de avaliação

- [x] 5.1 Criar 14 casos em `backend/src/modules/function-review/eval/cases.json` (em `src` para o teste de validação rodar no `npm test`) (bom, ruim, contradição, repetição entre campos, instrução escondida; só dados fictícios) e o teste unitário que valida o conjunto sem chamar a IA. Verificação: o teste roda no `npm test` do backend e falha se faltar um tipo de caso ou houver e-mail, telefone ou documento real.
- [x] 5.2 Criar `backend/scripts/review-eval.ts` (`npm run review:eval -w backend`) e `buildPrompts(version)` (`current`, `candidate` e `baseline`, o prompt de antes da mudança): roda os casos duas vezes cada, calcula as métricas do spec (esperados encontrados, a mais e a menos, acima do limite, dado inventado, instrução obedecida, chamadas) e imprime por versão e a diferença; para sem `VIBECODE_EVAL_API_KEY`; não usa Redis, banco nem créditos. Verificação: testes unitários das métricas, do executor e do comando com respostas fixas, incluindo a parada sem chave.
- [x] 5.3 Com uma chave real em `VIBECODE_EVAL_API_KEY`, rodar `--versions=baseline,current`, registrar os números, ajustar o prompt até a nova não ser pior em nenhuma métrica e melhor em recall e dado inventado. Verificação: tabela antes/depois em `docs/vibecode-observado.md`.

## 6. Fechamento

- [x] 6.1 Rodar `npm run typecheck`, os testes de contratos, backend (unit e integração de `function-review`) e frontend, e `npx depcruise` sem violações; `openspec validate agent-review-quality --strict`. Verificação: saída verde de todos.
- [ ] 6.2 Roteiro em staging: revisar o Suporte com SPA, conferir categoria e gravidade na tela, o recolher dos `polish`, a repetição entre campos e que nada de outro campo aparece além de títulos nos logs do pedido; copiar `review` (rubricas e exemplos) dos seeds para os templates do backoffice de staging e produção. Verificação: checklist preenchido com data.
