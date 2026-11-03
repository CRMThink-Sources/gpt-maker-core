# Design

## Context

A revisão monta três pedidos à LLM em `function-review/review-prompt.ts`: por campo (`fieldMessages`),
contradições (`crossMessages`) e cobertura (`gapsMessages`). O pedido por campo recebe agente,
função, rótulo, ajuda, `review.rubric` (máx. 500 caracteres), limites e os itens do campo. O problema
volta como `{code, text}` com `code` livre. Os seeds (`agent-functions/seed/*.ts`) já trazem
`review.rubric` em ~20 campos. A sessão de revisão fica no Redis por 30 minutos
(`review-session.store.ts`) e hoje só guarda `fieldIds`, `gapFieldIds` e a origem da chave.
Veja `proposal.md` para a motivação.

## Goals / Non-Goals

**Goals:**
- Subir a qualidade das sugestões e dos problemas só com mais contexto e saída estruturada, sem mudar modelo, cobrança nem a sessão.
- Poder dizer, com números, se uma versão do prompt é melhor que a anterior.

**Non-Goals:**
- Fine-tuning, RAG ou memória entre revisões.
- Persistir o resultado da revisão.
- Trocar o modelo ou ajustar temperatura (o Vibecode pode não expor o parâmetro; fica como experimento medido pelo conjunto de avaliação).

## Decisions

**D1. O contexto de papel é um bloco fixo por tipo de campo, dentro do prompt de sistema.**
Um texto curto por tipo (`TEXT`, `TEXT_LIST`, `KNOWLEDGE`) explica o que o agente faz com aquele
conteúdo e lista os erros comuns. Fica em constantes em `review-prompt.ts`, versionado junto do
código. Alternativa: pôr o papel no `rubric` de cada campo. Descartada: duplicaria o texto em ~40
campos e envelheceria separado; o `rubric` fica para o que é específico do campo, o papel é geral.
O bloco repete a regra "nunca inventar dado do negócio" para não competir com a de sugerir texto.

**D2. A rubrica ganha exemplos em `review.examples`, com `good` e `bad`.**
Formato `{ good: string, bad: string }`, cada um até 400 caracteres, opcional, nos esquemas de
texto, lista e base, no `review` do campo (na base o exemplo é um item inteiro, uma linha
`subcampo: texto` por subcampo; o `review` do subcampo segue só com `minLength`). Chave nova e opcional, então
templates publicados seguem válidos e o `strictObject` continua recusando chave errada. O prompt
diz à IA que são referência de estilo e que não devem ser copiados. Alternativa: exemplos fora do
template, no código. Descartada: o time de conteúdo edita templates no backoffice e já mantém as
rubricas ali.

**D3. O contexto da função vem do template e da sessão, nunca do conteúdo completo dos outros campos.**
- O que a função faz: o `description` do template publicado (já lido por `template()`), com teto de 400 caracteres.
- A expectativa passa a ser enviada na criação da revisão (`POST …/function/review`, campo opcional
  `expectation`, enviado só quando válido, de 20 a 1000 caracteres), guardada na sessão do Redis e
  lida pelas revisões de campo e pela cobertura; continua sem ir para o banco nem voltar à tela
  depois de recarregar (o requisito "Expectativa não é guardada" segue valendo). O
  endpoint `/gaps` mantém o campo `expectation` por compatibilidade, mas passa a preferir o da
  sessão. Assim o front não reenvia o texto a cada campo.
- Títulos dos outros campos de base: o front já envia as respostas inteiras em cada chamada de
  campo; o backend extrai só o título (primeiro subcampo) de cada item dos outros campos de base,
  limitado a 40 títulos por campo e 2000 caracteres no total (os mais longos saem primeiro). O texto
  do campo revisado nunca é cortado.
Alternativa: mandar todos os campos em cada chamada. Descartada: custo e tempo por campo
multiplicados, mais ruído, e aumenta a superfície de injeção entre campos.

**D4. Categoria e gravidade fixas no contrato, com normalização em vez de rejeição.**
`problemSchema` passa a `{ code, category, severity, text }`. `category` e `severity` são enums.
O prompt pede só `category` e `severity`; `code` deixa de ser pedido, e o backend preenche `code`
com a categoria para não quebrar quem ainda lê o campo (nenhum cliente persiste o resultado). Na
validação da saída, valor fora do enum vira `other`/`polish` (`catch` do zod), de modo que um
modelo criativo não derruba o campo nem custa a nova tentativa. Alternativa: rejeitar e repetir.
Descartada: gasta chamada por um rótulo.

**D5. A tela ordena por gravidade e recolhe o que é melhoria.**
Em `review-ui.tsx`, os problemas do item são ordenados `blocks` antes de `polish`. Com mais de 3
problemas, os `polish` ficam atrás de um "ver mais N sugestões de melhoria". O resumo conta itens
com `blocks` separado dos demais. A categoria vira um rótulo curto ao lado do texto. Lógica pura
(ordem, recolher, contagem) em `review-logic.ts`, testável sem DOM.

**D6. O conjunto de avaliação é dado versionado mais um script, fora do CI.**
Casos em `backend/src/modules/function-review/eval/cases.json` (em `src`, para o teste de
validação rodar no `npm test`, que só olha `src/**`; formulário fictício, problemas esperados por
item, proibições). Um teste unitário (roda no CI, sem LLM) valida o conjunto: número de casos,
cobertura dos tipos, esquema e ausência de dado real (regras simples de e-mail, telefone, CPF/CNPJ).
O script `backend/scripts/review-eval.ts` reaproveita `fieldMessages`/`toFieldResult` e o cliente
Vibecode, com a chave de `VIBECODE_EVAL_API_KEY`, e **não passa pelo serviço de revisão**: assim não
mexe em créditos, Redis nem banco. Comparar versões: o prompt fica numa função
`buildPrompts(version)` com `current`, `candidate` e `baseline` (o prompt de antes desta mudança,
reconstruído para medir o ganho); o script roda até duas e imprime a diferença.
Métricas: esperados encontrados (recall por categoria), problemas a mais (em caso bom, qualquer
um conta), sugestão acima do limite, sugestão com número ou prazo que não está no texto do cliente
(checagem por regex dos números novos), instrução escondida obedecida (marcador no caso) e
chamadas. Alternativa: rodar no CI com mock. Descartada: mock não mede qualidade.

**D7. A cobertura (lacunas) ganha o contexto de papel e nada mais.**
`GAPS_SYSTEM` recebe o mesmo bloco de papel da base, para as lacunas virarem itens que o agente
consegue consultar. O contrato de lacunas não muda.

## Risks / Trade-offs

- [Prompt maior sobe o custo e a latência por campo] → o contexto tem teto (D3); medir tokens por campo no script de avaliação antes de publicar, e cortar se passar de ~30% sobre o atual.
- [Exemplos no prompt fazem a IA copiá-los] → a instrução proíbe e há caso de avaliação que verifica a cópia literal.
- [Categoria e gravidade sem calibragem: tudo vira `blocks`] → o conjunto de avaliação inclui caso bom com muitos `polish` esperados; a métrica de "problemas a mais" pega o excesso.
- [Expectativa na sessão aumenta o dado guardado no Redis] → já é texto do cliente com TTL de 30 min e o mesmo limite (1000 caracteres); sem mudança de privacidade, só entra no tópico do aviso existente.
- [Resultado do avaliador é ruidoso (LLM não é determinístico)] → rodar cada caso 2 vezes e reportar o intervalo; decisões só em diferenças maiores que o ruído observado.

## Migration Plan

1. Contratos aceitam `review.examples` e os novos campos de problema (tudo opcional ou com valor padrão), então backend e front podem sair em qualquer ordem.
2. Publicar o código. Templates sem `examples` funcionam como hoje, com o contexto de papel já ativo.
3. Atualizar os seeds e copiar `review` dos seeds para os templates publicados no backoffice (mesmo passo manual já registrado na mudança anterior).
Reversão: o prompt `current` fica no código; voltar a versão e redeployar. Nada no banco.
