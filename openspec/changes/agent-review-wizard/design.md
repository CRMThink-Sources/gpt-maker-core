# Design

## Context

Motivação e escopo em `proposal.md`; comportamento em `specs/`. Só frontend. O que já existe e esta
mudança reaproveita:

- `useFunctionReview` guarda o resultado por campo (`fields[id]` com `answerKey`, `result`,
  `applied`), as contradições, as lacunas (`gaps` com `added`) e expõe `applied()` e `gapAdded()`.
- `review-logic.ts` tem `canApply`, `withSuggestion`, `canAddGap`, `withGapItem`, `answerKey` e
  `topLevelIds`.
- A página `[id]/function/page.tsx` guarda `answers` e já tem `addGap` e o caminho de "Aplicar" do
  `FieldNotes`, ambos via `setAnswers` (o mesmo da digitação).
- `Modal` (`components/modal.tsx`) cuida de Esc, rolagem do corpo e rodapé fixo; **não** prende o foco
  nem o devolve ao fechar.

## Goals / Non-Goals

**Goals:**
- Uma fila linear e previsível: o cliente só decide sim, editar ou pular.
- Toda regra de negócio (limites, obrigatórios, marcadores) continua nas funções puras já testadas;
  o componente só desenha e despacha.
- Teclado, leitor de tela e celular de verdade, não de enfeite.

**Non-Goals:**
- Guardar progresso ou resultado; mudar o backend, os contratos ou a cobrança.
- Substituir o resultado inline: ele continua, e os dois caminhos aplicam do mesmo jeito.

## Decisions

### D1. A fila é uma função pura
`buildWizardSteps(review, form, answers)` em `review-wizard.ts` devolve
`{ steps, outdated }`. Passo = `{ key, kind: 'suggestion' | 'gap' | 'contradiction', ... }`, com chaves
estáveis (`s:<campo>:<item>`, `g:<posição>`, `c:<posição>`). Ordem: sugestões (na ordem dos campos do
formulário), lacunas, contradições. Campo cujo `answerKey` mudou entra em `outdated` e fica fora da
fila. Passo "feito" = item em `applied` do campo ou posição em `gaps.added`: vem do hook, então o que o
cliente aplicou pelo resultado inline também some da fila.

- *Por quê*: testável sem renderizar, e o botão "Aplicar sugestões (N)" usa a mesma contagem.
- *Alternativa*: guardar a fila em estado. Descartada: ficaria desatualizada quando o cliente edita o
  formulário com o modal fechado.

### D2. Estado do assistente é local e curto
`useReducer` no componente: posição na fila, `skipped` (conjunto de chaves), edição aberta e rascunho
da edição, valores dos marcadores. Fechar e reabrir zera pulos (o que foi aplicado já é "feito" pelo
hook). A reabertura começa no primeiro passo não feito.

### D3. Diff por palavra, sem dependência
`wordDiff(antes, depois)` em `review-wizard.ts`: divide por espaços preservando-os e calcula a maior
subsequência comum de palavras (textos têm no máximo ~900 caracteres, então O(n·m) é barato). Devolve
trechos `same | add | del`. ANTES mostra `same` e `del` (riscado); SUGERIDO mostra `same` e `add`
(destacado). Quando não há texto antes (item novo da lacuna), só o sugerido.

- *Alternativa*: biblioteca de diff. Descartada: dependência nova para ~30 linhas.

### D4. Aplicar e editar passam pelas funções existentes
Aplicar monta `{ values, applicable: true }` e usa `canApply` (validação local do campo) e
`withSuggestion`. Com edição aberta, `values` vem da textarea; o botão fica desativado se `canApply`
recusa (limite, obrigatório vazio). A página ganha `applySuggestion(fieldId, index, values)` que faz
`setAnswers` e `review.applied` (a lógica hoje inline no `FieldNotes`, extraída para os dois usarem).
Como sugestões só trocam texto e lacunas só acrescentam no fim, a posição dos itens que a fila ainda
vai usar não muda.

### D5. Marcadores viram campos
`placeholderSlots(values)` varre os textos do rascunho e devolve uma lista de
`{ id, subfield, label, occurrence }` (o rótulo é o texto depois de `preencher:`).
`fillPlaceholders(values, filled)` troca cada ocorrência pelo valor digitado, mantendo o marcador
original onde ficou em branco. A validação de `canAddGap` roda sobre o item já preenchido, então um
valor longo demais desativa "Adicionar" com o contador em alerta.

### D6. Teclado
Um `onKeyDown` no contêiner do modal. Fora de campo de texto: Enter aplica/adiciona, seta direita
pula, seta esquerda volta. Dentro de `input`, `textarea` ou `select`, as setas e o Enter pertencem ao
campo; o atalho de confirmar a edição é **Ctrl/Cmd+Enter**, porque Enter numa textarea insere linha.
Esc fecha (o `Modal` já faz). Os atalhos aparecem como dica discreta no rodapé, só em tela larga.

### D7. Foco e leitor de tela
`Modal` ganha `trapFocus` (padrão `false`, para não mexer nos demais): guarda o elemento ativo ao
abrir, foca o diálogo, cicla o Tab dentro dele e devolve o foco ao fechar. O assistente liga a opção.
Uma região `aria-live="polite"` anuncia "Passo N de M: <campo>, <resumo>" a cada troca. O diálogo usa
`aria-labelledby` no título do passo.

### D8. Abertura automática
A página observa `review.running` passar de `true` para `false` e abre o assistente se
`buildWizardSteps` achar passo acionável e a revisão não falhou, **uma vez por execução** (uma
referência com o número da execução). O botão "Aplicar sugestões (N)" mora no painel de revisão, só
com N > 0, e guarda o elemento para devolver o foco.

### D9. Contradição leva ao campo
"Ir ao campo" fecha o modal e rola até `#pergunta-<campo de primeiro nível>` (`topLevelIds`), com
`scrollIntoView` e foco no primeiro controle do cartão.

### D10. Celular
Colunas ANTES e SUGERIDO em `grid-cols-1 sm:grid-cols-2`. Ações no `footer` do `Modal` (já fixo), com
o botão principal à direita e os secundários agrupados; corpo com rolagem própria.

## Risks / Trade-offs

- [Atalho dispara enquanto o cliente digita] → Filtro por alvo do evento (D6) e teste dedicado.
- [Mexer no `Modal` quebra os outros modais] → `trapFocus` é opt-in; só o assistente liga.
- [Diff por palavra confunde com texto reescrito por inteiro] → Se menos de ~30% das palavras são
  comuns, mostra os dois blocos sem destaque, para não virar uma sopa de riscos.
- [Cliente aplica tudo sem ler] → O passo mostra o motivo e o ANTES; o resumo final lembra que nada foi
  publicado e lista os marcadores pendentes.
- [Fila muda enquanto o modal está aberto (edição de fundo é impossível, mas o hook atualiza)] → A fila
  é recalculada a cada render; a posição se ancora na chave do passo atual, não no índice.

## Migration Plan

Só frontend, sem migração. O assistente entra atrás do resultado já existente; se algo falhar, basta
não abrir o modal: o resultado inline continua aplicando. Reverter é remover o botão e o efeito de
abertura da página.

## Open Questions

- Limite de ~30% de palavras em comum para desligar o destaque: ajustar vendo textos reais.
