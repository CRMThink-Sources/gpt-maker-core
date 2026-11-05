# Proposal

> **Depende de `agent-knowledge-review` e `agent-knowledge-gaps`** (já arquivadas, specs em
> `openspec/specs`). Não muda cobrança, modelo nem a sessão de revisão.

## Why

A revisão por IA avalia o texto como um revisor genérico: recebe "agente X, função Y, campo Z" e
um `rubric` curto, mas não sabe para que o texto serve. Nós sabemos: o formulário vira
comportamento, treinamentos (itens consultados quando o cliente final pergunta algo parecido) e
intenções no GPT Maker, dentro de um orçamento de 3000 caracteres. Sem isso, a IA elogia texto que
o agente não consegue usar e perde problemas reais; os problemas voltam com um `code` livre, que
não dá para ordenar nem priorizar, e não há como medir se uma mudança de prompt melhorou ou
piorou a revisão.

## What Changes

- **Contexto de papel no prompt**: cada revisão explica à IA como aquele tipo de campo é usado pelo
  agente (comportamento, item de treinamento, intenção), como o agente consome o conteúdo e os
  erros comuns desses agentes (resposta longa demais, política sem prazo, título que não casa com
  a pergunta do cliente final, item que depende de outro).
- **Contexto da função inteira**: o prompt de cada campo leva um resumo do que a função faz, a
  expectativa do cliente (quando preenchida) e os títulos dos itens dos outros campos de base, para
  apontar repetição entre campos. Não leva o conteúdo completo de outros campos.
- **Rubricas e exemplos nos templates**: `review.rubric` ganha, ao lado, `review.examples` opcional
  (um exemplo bom e um ruim por campo, pequenos). Os seeds SDR, Suporte, Agendamento e Pós-venda
  passam a trazer rubricas específicas e exemplos nos campos que mais importam. A skill
  `gptthink-criar-funcao` e o validador aceitam e checam os exemplos.
- **Saída estruturada**: cada problema passa a ter uma **categoria** de uma lista fixa (ambíguo,
  incompleto, contraditório, longo demais, sem prazo ou condição, fora do assunto, repetido, outro)
  e uma **gravidade** (`blocks`: atrapalha o agente; `polish`: melhoria). A tela mostra a
  categoria, ordena por gravidade e deixa os problemas `polish` recolhidos quando há muitos.
- **Conjunto de avaliação**: 10 a 15 formulários de teste (bons, ruins, com contradição, com
  instrução escondida no texto) e um script que roda a revisão neles e compara duas versões do
  prompt. Roda sob demanda, com chave real, e **não entra no CI** por custo e por depender de LLM.

Fora desta mudança: cobrança, modelo, backend de sessão da revisão, limites e o fluxo de lacunas
(a análise de cobertura só ganha o mesmo contexto de papel, sem mudar o contrato).

## Capabilities

### New Capabilities
- `agent-review-evaluation`: conjunto de casos e script que mede a qualidade da revisão por IA e
  compara versões do prompt.

### Modified Capabilities
- `agent-knowledge-review`: a revisão por IA passa a usar o contexto de papel, o contexto da função
  e os exemplos do template, e devolve problemas com categoria e gravidade, mostrados e ordenados
  na tela.

## Impact

- **Backend**: `function-review/review-prompt.ts` (prompts e `toFieldResult`), `function-review.service.ts`
  (montar o contexto da função), schema de saída; seeds em `agent-functions/seed`; script em
  `backend/scripts` e casos em `backend/test/review-eval`.
- **Contratos**: `agent-knowledge-review.ts` (categoria e gravidade do problema), `agent-functions.ts`
  (`review.examples`).
- **Frontend**: `review-ui.tsx` (categoria, ordem e recolher `polish`).
- **Skill/docs**: `gptthink-criar-funcao` (formato e validador).
- **Banco, cobrança, chaves**: nenhum. Os templates já publicados seguem válidos (`examples`
  opcional); problemas antigos sem categoria não existem, pois o resultado não é persistido.
