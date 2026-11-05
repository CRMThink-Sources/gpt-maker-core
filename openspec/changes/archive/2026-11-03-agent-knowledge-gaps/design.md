# Design

## Context

Motivação e escopo em `proposal.md`; comportamento em `specs/`. Esta mudança estende o que
`agent-knowledge-review` já entrega (ainda em mudança ativa, no mesmo branch):

- `FunctionReviewService` cria a revisão (Redis, 30 min: tenant, agente, `keySource`, campos), revisa
  um campo por requisição com reserva `SET NX`, cobra por campo (`review:<reviewId>:<fieldId>`) e
  tem a chamada de contradições (`.../cross`) com só os resumos.
- O app roda os campos com até 2 ao mesmo tempo e depois pede as contradições; o resultado vive só
  no estado da tela (`useFunctionReview`).
- `reviewFunctionAnswers` (contratos) gera os avisos por regras fixas; `validateFunctionAnswers`
  barra limites e obrigatórios.
- O Vibecode só garante `json_object`, sem schema: toda saída passa por zod, com uma nova tentativa.

## Goals / Non-Goals

**Goals:**
- Achar o que **falta** na base a partir do que o cliente espera, com rascunho pronto para completar.
- Nunca deixar o rascunho virar fato inventado dentro do agente publicado.
- Nenhum estado novo em banco; a cobrança usa o razão e a chave já escolhidos na revisão.

**Non-Goals:**
- Guardar a expectativa ou as lacunas.
- Sugerir itens para campos que não são de base, ou de fontes externas.
- Preço próprio para a cobertura (é o preço de um campo).

## Decisions

### D1. Uma rota nova na mesma revisão
`POST /agents/:id/function/review/:reviewId/gaps`, acesso `manage`, depois das contradições. Corpo:
`{ expectation, answers, summaries }`. A criação da revisão ganha `withGaps?: boolean`: o backend
então grava na sessão os campos de base do template (`gapFieldIds`), inclusive os que o cliente ainda
não preencheu, que não entram em `fieldIds` por não terem o que revisar.

- *Por quê*: reaproveita sessão, reserva, escolha da chave e limites sem criar outro fluxo. A sessão
  continua sendo a prova de que a revisão é daquele tenant e agente.
- *Alternativa*: estender `.../cross` com a expectativa. Descartada: cobrança e falha seriam
  misturadas com a das contradições, que não é cobrada.

### D2. Expectativa só na tela
Vai no corpo da rota e é usada na hora; o backend não guarda. Mesmo critério do resultado da revisão.
Limites 20 a 1000 caracteres validados no contrato (o app mostra o motivo antes de enviar).

- *Alternativa*: guardar nas respostas da função. Descartada: vira campo de formulário, entra na
  versão do template e no `validateFunctionAnswers`, e o spec da revisão diz que nada é guardado.

### D3. Prompt de cobertura
`system`: papel de analista de cobertura, regras de saída, e a regra de ouro: **não afirmar prazo,
valor, política, horário ou dado do negócio que não esteja no texto do cliente; usar
`[preencher: <o que falta>]`**. Conteúdo do cliente (expectativa, resumos, títulos) vem delimitado
como dado. `user`: expectativa; para cada campo de base (rótulo, `help`, `rubric`, subcampos com
limites, quantos itens cabem ainda e os **títulos dos itens existentes**) mais o resumo do campo
quando houver. `temperature: 0.2`.

Saída: `{ gaps: [{ fieldId, title, why, item: { <subcampo>: texto } }], covered: [{ text }] }`, com
`gaps` até 15 e `covered` até 10. Validada com zod; uma nova tentativa com o erro; falhou duas vezes,
`AI_BAD_OUTPUT` só da cobertura.

### D4. Validação do rascunho no backend
Depois do zod, por lacuna: descarta `fieldId` que não é de base da sessão e chaves que não são
subcampos; descarta título que, normalizado como em `DUPLICATE_ITEMS`, já existe no campo; marca
`applicable: false` com `reason` (`FULL` campo no máximo de itens contando as lacunas já aceitas
antes dela; `LIMIT` subcampo acima do limite; `REQUIRED` subcampo obrigatório vazio). O app
confere de novo antes de mostrar "Adicionar", como no "Aplicar".

### D5. Marcadores `[preencher: …]` como regra de contratos
Constante e expressão em `packages/contracts`: `/\[preencher:[^\]]*\]/i`. Duas peças:
- `reviewFunctionAnswers` ganha o código `PENDING_PLACEHOLDER` (`attention`) para texto, item de
  lista e subcampo de base, apontando campo, item e subcampo.
- `validateFunctionAnswers` ganha o problema "tem trecho [preencher: …] sem preencher" quando **não**
  é parcial. Salvar rascunho usa `partial: true` e segue permitido; publicar e criar o agente barram.

O marcador pode caber no limite de caracteres do subcampo, então o rascunho com marcador continua
passando na validação de tamanho. Resultado: o texto com marcador nunca chega ao agente.

- *Alternativa*: só avisar, como as demais regras fixas. Descartada: aqui o erro de ignorar o aviso
  é o agente dizer "[preencher: prazo]" ao cliente final; esse aviso não pode ser "publicar mesmo
  assim".

### D6. Cobrança como um campo
Reserva `SET NX` com o campo `__gaps__` (nome que não é id de campo de template) e débito com
`key: review:<reviewId>:__gaps__`, `refType: 'function_review'`, preço de um campo, depois de saída
válida e com saldo conferido antes, como em D9 de `agent-knowledge-review`. Chave do cliente: sem
débito. Mesmos limites por tenant e global da chave da CRMThink. No extrato conta como um campo
revisado (a contagem já é por chave de idempotência).

### D7. Tela
- O painel de revisão ganha o campo "O que você espera do agente? (opcional)", com contador, e o
  botão passa a somar o preço da cobertura quando a expectativa é válida.
- Depois dos campos e das contradições, o app chama `/gaps` (só com `withGaps` na criação). Falha ou
  falta de créditos aparece na própria seção, sem afetar o resto.
- A seção "Lacunas" lista, por campo de base, título, motivo, o rascunho e "Adicionar". Adicionar
  insere um `KnowledgeItem` novo (`itemKey` novo) pelo mesmo caminho da digitação, e a lacuna passa a
  "Adicionado". "O que a base já cobre" aparece recolhido.
- O item adicionado com marcador mostra o aviso `PENDING_PLACEHOLDER`. Ao publicar, o backend barra e
  a tela leva ao campo (já existe o resumo com links).

## Risks / Trade-offs

- [Modelo `bitrix/*` inventa fato no rascunho] → Regra no prompt, marcadores e bloqueio de publicação
  (D5); a validação não impede o fato inventado sem marcador, então o rascunho é sempre "para o
  cliente conferir" na tela, e o aviso de privacidade e de conferência fica junto de "Adicionar".
- [Qualidade do modelo para criar itens é menor que para revisar] → Esta mudança só é liberada depois
  da tarefa 1.3 de `agent-knowledge-review`; a avaliação aqui repete em 3 funções reais.
- [Expectativa com instrução maliciosa] → Delimitada como dado, saída validada, sugestão só entra
  com o clique e passa pela validação do campo.
- [Cliente adiciona tudo sem ler] → Marcadores forçam a leitura dos pontos críticos; limite de 15
  lacunas.
- [Chamada a mais por revisão] → Uma só, cobrada como um campo e dentro dos limites existentes.
- [Marcador bloqueia criar agente de quem copiou o texto do exemplo] → O texto de exemplo do
  `placeholder` dos templates não usa o formato `[preencher: …]`; a mensagem do bloqueio diz o campo.

## Migration Plan

1. Contratos: schemas, regra dos marcadores e `withGaps`. Compatível: respostas sem marcador não
   mudam.
2. Backend: rota, prompt e cobrança. Sem migração de banco.
3. Frontend: expectativa, lacunas e "Adicionar".
4. Habilitar só com a tarefa 1.3 de `agent-knowledge-review` concluída. Sem a expectativa, nada muda
   para quem não usa; esconder o campo desliga a funcionalidade.

## Open Questions

- Limite de 15 lacunas e de 1000 caracteres da expectativa: ajustar depois de ver o uso.
