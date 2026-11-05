# Proposal

> **Depende de `agent-knowledge-review`** (revisão por IA, chave do cliente, cobrança por campo,
> limites). Esta mudança só deve ser liberada depois que a tarefa 1.3 dessa mudança (qualidade do
> modelo `bitrix/*` em SDR, Suporte e Suporte com SPA) estiver concluída: sugerir itens novos exige
> mais do modelo do que revisar texto que o cliente já escreveu.

## Why

A revisão por IA de `agent-knowledge-review` melhora o que o cliente escreveu, mas não sabe **o que o
agente deveria resolver**. Uma base pequena e bem escrita passa limpa pela revisão e ainda assim deixa
o agente sem resposta para metade das perguntas reais. O erro mais caro da base não é texto ruim, é
**item que falta**, e só quem sabe o que o agente deve atender consegue apontar isso. Se o cliente
descrever o que espera do agente, a IA pode medir a cobertura da base e propor os itens que faltam.

## What Changes

- **Expectativa do agente** (opcional): na revisão por IA, o cliente pode descrever em texto livre o
  que espera que o agente resolva (situações reais, perguntas que chegam). Sem ela, a revisão funciona
  como hoje.
- **Análise de cobertura** (uma chamada à IA, quando há expectativa): compara a expectativa com os
  resumos dos campos de base e devolve as **lacunas** (o que o cliente espera e a base não cobre) e o
  que a base cobre **sem ninguém ter pedido** (só como informação).
- **Sugestão de itens novos** para **todos os campos de base** (`KNOWLEDGE`): para cada lacuna, um
  rascunho de item (os subcampos do campo) com o botão **"Adicionar"**, que insere o item no
  formulário, sem salvar nem publicar. Respeita `maxItems` e os limites de cada subcampo.
- **Sem inventar fatos**: o rascunho nunca afirma prazo, valor, política ou dado que só o cliente
  sabe. Esses trechos saem como marcador `[preencher: …]`. O item adicionado com marcador pendente
  gera aviso no formulário e **barra a publicação** (e a criação do agente) até ser preenchido;
  salvar rascunho segue permitido.
- **Cobrança**: a análise de cobertura custa o mesmo que um campo revisado (chave da CRMThink); com a
  chave do cliente, nada é debitado. Reaproveita o limite por tenant, a reserva por revisão e a escolha
  da chave de `agent-knowledge-review`.

Fora desta mudança: guardar a expectativa ou o histórico de lacunas (a expectativa vive só na tela,
como o resultado da revisão), sugerir itens para campos que não são de base, e sugerir
conteúdo a partir de fontes externas (site, conversas).

## Capabilities

### New Capabilities
- `agent-knowledge-gaps`: expectativa do agente, análise de cobertura da base, sugestão de itens novos
  com marcadores de fato a preencher, cobrança e limites.

### Modified Capabilities
<!-- Nenhuma capability em openspec/specs muda: `agent-knowledge-review` e as alterações de
     `agent-function-configuration` ainda estão em mudança ativa e entram nos specs principais quando
     ela for arquivada. Este delta só acrescenta requisitos novos. -->

## Impact

- **Contratos**: schemas da expectativa, da análise de cobertura (lacunas, itens sugeridos) e a regra
  dos marcadores `[preencher: …]` (`packages/contracts`), junto de `reviewFunctionAnswers` (aviso de
  marcador pendente).
- **Backend**: nova rota de cobertura no módulo `function-review` (`POST .../review/:reviewId/gaps`),
  prompt de cobertura, validação da saída e dos itens sugeridos contra o template, débito de um campo.
  Sem tabela nova.
- **Frontend**: campo "O que você espera do agente" no painel de revisão, lista de lacunas com itens
  sugeridos e "Adicionar", aviso de marcador pendente.
- **Externo**: mesmas chamadas ao Vibecode de `agent-knowledge-review`; uma chamada a mais por revisão
  que informar expectativa.
