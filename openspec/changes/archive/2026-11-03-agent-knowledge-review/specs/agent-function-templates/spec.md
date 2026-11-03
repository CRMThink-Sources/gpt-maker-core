## ADDED Requirements

### Requirement: Critério de revisão no template
Os campos de texto, de lista de textos e de base de conhecimento do template MUST aceitar um `review` opcional com: `recommendedItems` (listas e bases; de 1 até `maxItems`), `minLength` (só texto; de 1 até `maxLength`) e `rubric` (texto de até 500 caracteres com o que um bom preenchimento tem). Cada subcampo de base MUST aceitar um `review` opcional com `minLength` (de 1 até o `maxLength` do subcampo). A publicação do template MUST falhar, nomeando o campo, quando um desses valores sair dos limites. O `review` MUST NOT entrar no comportamento compilado nem no orçamento de caracteres, e MUST ficar congelado na versão publicada do template, como o resto do conteúdo. Templates sem `review` MUST continuar válidos.

#### Scenario: Base com critério
- **WHEN** o campo "Problemas comuns" traz `review: { recommendedItems: 3, rubric: "A solução vem em passos numerados..." }` e o subcampo "Solução" traz `review: { minLength: 80 }`
- **THEN** o template é aceito e o orçamento de caracteres não muda

#### Scenario: Recomendado acima do máximo
- **WHEN** um campo com `maxItems: 10` traz `review.recommendedItems: 12`
- **THEN** a publicação falha dizendo que o recomendado passa do máximo de itens do campo

#### Scenario: Template antigo sem review
- **WHEN** um template publicado antes desta mudança é carregado
- **THEN** ele continua válido e a revisão usa só as regras genéricas
