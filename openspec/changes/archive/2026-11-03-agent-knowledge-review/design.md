# Design

## Context

Motivação e escopo em `proposal.md`; comportamento em `specs/`. Estado atual que molda o desenho:

- O template da função é declarado nos contratos (`packages/contracts/src/agent-functions.ts`) e as respostas são validadas por `validateFunctionAnswers` (`agent-function-answers.ts`), usado pelo app (prévia) e pelo backend (publicação). Os textos de base só entram pelo formulário (`FunctionTrainingPolicy`, `TRAINING_FORM_ONLY`).
- As respostas de `BITRIX_SPA` guardam `fields: { valor: códigoDoCampo }` e `lists: { valor: { opção: idDoItem } }`. O tipo do campo do portal não fica nas respostas.
- O backend não chama nenhum provedor de IA hoje; toda IA passa pelo GPT Maker.
- Já existem: `encryptedText` (AES-256-GCM em repouso, `shared/database/columns.ts`), `RedisRateLimiter` (`shared/redis/rate-limiter.ts`) e `AppSessionGuard` com acessos `read`, `manage` e `admin` (só admin do portal).
- Vibecode: `POST /v1/chat/completions` no contrato da OpenAI, `response_format: json_object` (sem `json_schema`), `GET /v1/models`, limite por minuto por chave e por usuário, limite de tamanho da requisição não publicado (413 `ai_payload_too_large`).

## Goals / Non-Goals

**Goals:**
- Regras fixas idênticas no app e no backend, a partir de uma única implementação.
- Revisão por IA que devolve resultado por campo, aguenta falha parcial e não depende do limite de tamanho desconhecido do Vibecode.
- Nenhum estado novo em banco além da chave do cliente; a cobrança usa o razão de créditos existente.
- Cobrança por campo que não cobra duas vezes nem deixa revisar sem cobrar.

**Non-Goals:**
- Guardar histórico de revisões ou notas.
- Revisar a função no backoffice (templates); a revisão é das respostas do cliente.
- Preço por token ou por plano; o preço por campo é um só.
- Escolha de modelo pelo cliente.

## Decisions

### D1. Regras fixas como função pura nos contratos
`reviewFunctionAnswers(content, answers): FunctionReviewWarning[]` em `packages/contracts`, ao lado de `validateFunctionAnswers`. O app chama a cada alteração (é síncrona e barata) e o backend chama na publicação só para registrar a quantidade de avisos em log.

- *Por quê*: o app já roda a validação localmente; a mesma função garante que tela e servidor contam os mesmos avisos.
- *Alternativa*: endpoint no backend. Descartada: ida e volta a cada tecla, sem ganho.
- A função recebe respostas parciais e aplica `visibleFields` como a validação, para não avisar sobre dependentes ocultos.
- Normalização para "itens repetidos": minúsculas, `NFD` sem diacríticos, pontuação removida, espaços colapsados; compara igualdade, não similaridade. Similaridade fica para a IA. Na base, compara só o primeiro subcampo (o título do item: problema, pergunta, nome): dois itens com o mesmo problema e soluções diferentes são o caso a apontar.
- Regras do SPA usam só as respostas: códigos repetidos em `fields`, e `lists[valor]` com parte das `options` declaradas.

### D2. `review` no schema do template
Campo opcional nos schemas zod de `TEXT`, `TEXT_LIST`, `KNOWLEDGE` e do subcampo de base, com `superRefine` para os limites (`recommendedItems <= maxItems`, `minLength <= maxLength`). O compilador ignora `review`; o cálculo do pior caso do orçamento não muda. A versão publicada do template guarda o conteúdo inteiro, então `review` congela junto sem mudança de banco.

- *Alternativa*: tabela de critérios por função. Descartada: o autor já edita tudo no JSON do template, e o critério precisa andar com a versão.

### D3. Revisão por IA dirigida pelo app, uma requisição por campo
```
app (tela da função)                       backend                         Vibecode
 ├─ POST /agents/:id/function/review ──────▶ cria revisão (Redis, 30 min):
 │     { fieldIds }                          reviewId, chave usada, campos
 │  ◀── { reviewId, keySource, creditsPerField }
 ├─ POST .../review/:reviewId/field ───────▶ reserva o campo (1x por revisão)
 │     { fieldId, answers }  (até 2 ao mesmo  confere saldo (chave CRMThink)
 │      tempo)                                monta prompt do campo ──────▶ /v1/chat/completions
 │                                            valida saída (zod) ◀───────── json_object
 │                                            debita o campo (chave CRMThink)
 │  ◀── { items[], problems[], suggestions[] }
 └─ POST .../review/:reviewId/cross ───────▶ resumos dos campos ─────────▶ (1 chamada, sem cobrança)
       { answers, summaries }               ◀── { contradictions[] }
```
- O app cria a revisão com os campos revisáveis preenchidos, percorre-os com no máximo 2 requisições simultâneas e, ao fim, pede a chamada de contradições com os resumos devolvidos por campo. Revisar de novo um campo desatualizado cria uma revisão nova só com ele.
- A revisão vive só no Redis (TTL de 30 min): `reviewId`, tenant, agente, origem da chave e campos permitidos, com a marca de cada campo já reservado. Um campo só é chamado uma vez por revisão (`SET NX`), o que impede reusar o `reviewId` para revisar de novo sem cobrar. Falha do campo libera a reserva, para o app poder tentar de novo na mesma revisão.
- Cada requisição é síncrona (timeout de 60 s). Não há fila nem tabela de execução.
- *Por quê*: resultado aparece por campo sem polling; falha de um campo não afeta os outros; requisição pequena evita o 413 de tamanho desconhecido; sem estado para limpar.
- *Alternativa*: job no RabbitMQ com tabela de execução e polling. Descartada: mais peças para uma operação de segundos, cujo resultado o spec diz que não é guardado.
- *Alternativa*: base inteira numa chamada. Descartada: uma base cheia passa de 50 mil caracteres e o limite do Vibecode não é publicado.
- O backend recebe as respostas da tela (salvas ou não), revalida com `validateFunctionAnswers(..., { partial: true })` e só usa campos visíveis. O template é a versão a que a configuração do agente está presa, nunca o que vem do app.

### D4. Prompt e formato de saída
- `system`: papel de revisor, regras de saída e o formato JSON esperado, em pt-BR. Instrução explícita de que o conteúdo do cliente é dado a avaliar, não instrução.
- `user`: contexto curto (empresa, função, rótulo, `help`, `rubric` do campo, limites de caracteres de cada subcampo) e os itens numerados.
- Saída por campo: `{ summary, items: [{ index, problems: [{ code, text }], suggestion?: { [subcampo]: texto } }] }`; `summary` (até 500 caracteres) alimenta a chamada de contradições.
- Saída de contradições: `{ contradictions: [{ fields: [fieldId, ...], items?, text }] }`.
- `temperature: 0.2`. Resposta validada com zod; inválida → uma nova tentativa com a mensagem do erro de validação; inválida de novo → falha "não pôde ser revisado".
- Sugestão é validada no backend contra os limites do subcampo; acima do limite volta marcada como `applicable: false`. O app confere de novo antes de mostrar "Aplicar".

### D5. Cliente do Vibecode
Módulo `vibecode` no backend com `chat()` e `listModels()` sobre `fetch`, autenticação `Authorization: Bearer`. Tradução de erros:

| Vibecode | Resultado |
|---|---|
| 401, `scope_missing` 403 | `AI_KEY_INVALID` / `AI_KEY_SCOPE` |
| `insufficient_balance`, `ai_quota_exhausted` 402 | `AI_NO_BALANCE` |
| `ai_model_not_found` 404, `model_unavailable` 503 | `AI_MODEL_UNAVAILABLE` |
| `ai_congested` 429, `rate_limit_exceeded` 429, `ai_provider_timeout` 503, 502 | até 2 novas tentativas com espera (`Retry-After` quando vier), depois `AI_UNAVAILABLE` |
| `ai_payload_too_large` 413 | `AI_FIELD_TOO_LARGE` (campo não revisado) |

O modelo vem da configuração `VIBECODE_REVIEW_MODEL` (padrão `bitrix/bitrixgpt-5.5`) e `VIBECODE_BASE_URL` (padrão `https://vibecode.bitrix24.com`). A chave da CRMThink vem de `VIBECODE_PLATFORM_API_KEY` (opcional). Com a chave da CRMThink, os erros de chave, saldo e cota viram `AI_UNAVAILABLE` para o cliente e um log com `alert: true` para o time.

- *Alternativa*: SDK da OpenAI apontando para o Vibecode. Descartada: dependência nova para duas rotas, e os códigos de erro do Vibecode vêm no corpo, que o SDK esconde.

### D6. Chave por tenant
Tabela `tenant_ai_key` (`tenant_id` PK, `api_key` `encryptedText`, `last4`, `model`, `verified_at`, timestamps). Uma chave por tenant.

- Salvar: `GET /v1/models` com a chave; recusa se falhar ou se o modelo fixo não estiver na lista; grava `verified_at`. Também chama `GET /v1/me` (descreve a chave, com os escopos) e recusa a chave com escopos além de `vibe:ai`. Se `/v1/me` falhar ou vier em formato inesperado, só a orientação na tela vale e a chave é aceita.
- Salvar e remover a chave com acesso `admin` (só admin do portal), porque a chave pode abrir dados do portal. Ver o estado da chave (`configured`, `last4`, preço, chave da CRMThink) com acesso `manage`: quem edita a função precisa dele para o botão "Revisar com IA". Rotas de revisão com acesso `manage`, como a edição da função.
- A API devolve só `{ configured, last4, verifiedAt }`.
- Falha `AI_KEY_INVALID`/`AI_KEY_SCOPE` durante uma revisão não apaga a chave; a tela orienta a trocar.
- Escolha da chave na criação da revisão: chave do tenant salva → `keySource: 'tenant'`; senão `VIBECODE_PLATFORM_API_KEY` presente → `'platform'`; senão a revisão é recusada com `AI_KEY_REQUIRED`. A origem fica presa à revisão: se a chave do cliente falhar no meio, não há troca para a da CRMThink.

### D7. Limite de uso
- Por tenant: `RedisRateLimiter` nas rotas de campo (ex.: 60 campos por 10 minutos), para não esgotar a cota do cliente no Vibecode por clique repetido nem segurar conexões do backend. Estourado → 429 com mensagem "aguarde alguns minutos".
- Global, só para `keySource: 'platform'`: `RedisRateLimiter` com chave única, abaixo do limite por minuto da chave da CRMThink no Vibecode (valor em `VIBECODE_PLATFORM_RPM`). Estourado → espera até 5 s e tenta uma vez; continua estourado → `AI_BUSY` ("muitas revisões agora, tente em instantes"), sem cobrança e com a reserva do campo liberada.

### D9. Cobrança por campo
- Preço em `REVIEW_CREDITS_PER_FIELD` (configuração do backend), devolvido na criação da revisão e na leitura da configuração da chave, para o botão calcular o custo. Trocar o preço não precisa de deploy de código, só de configuração.
- Antes de chamar o Vibecode com `keySource: 'platform'`: `BalanceReader.total(tenant) >= REVIEW_CREDITS_PER_FIELD`; senão `NO_CREDIT` no campo, sem chamar a IA.
- Depois de validar a saída do campo: `LedgerService.debit` com `key: review:<reviewId>:<fieldId>`, `refType: 'function_review'`, `refId: reviewId`, `agentId`, `amount` e `unitCost` iguais ao preço, `createdBy: 'system:review'`; em seguida `CreditAlerts.afterDebit`, como o débito de mensagens. A `key` torna o débito idempotente se o mesmo campo chegar duas vezes.
- Débito síncrono, não por evento no RabbitMQ: o valor é fixo e não depende de catálogo de modelo, e o resultado só volta ao app depois de cobrado. Falha do débito → o campo volta com erro e sem resultado, e a reserva é liberada; a IA já foi chamada, e esse custo fica conosco.
- *Alternativa*: publicar `usage.response` com um `source` novo. Descartada: o consumidor cobra pelo preço do modelo de atendimento (`ai_model.creditsPerResponse`), que não se aplica aqui.
- Extrato: `refType: 'function_review'` aparece como "Revisão da função" na tela de extrato existente (`CreditStatementService`).
- O saldo lido vem do cache de 60 s do `BalanceReader`. Duas revisões simultâneas do mesmo tenant podem passar um pouco do saldo, como já acontece com mensagens; o razão aceita o débito e o saldo fica zerado.

### D8. Tela
- Avisos do nível 1 junto da mensagem de validação do campo, com resumo no topo e limite de 3 por campo.
- Confirmação "N pontos de atenção" no fluxo de publicação já existente, só com `attention`.
- Resultado da IA guardado só no estado da tela, com hash das respostas de cada campo: hash diferente → "desatualizado".
- "Aplicar" altera o estado do formulário pelo mesmo caminho da digitação, o que recalcula avisos e marca alterações não salvas.

## Risks / Trade-offs

- [O Vibecode pode exigir Vibe+ para criar a chave] → Confirmar num portal sem Vibe+ antes de implementar a tela; se exigir, a configuração diz isso e o nível 1 segue para todos.
- [Vibecode em beta: rotas, códigos de erro e modelo podem mudar] → Cliente isolado no módulo `vibecode`, modelo em configuração, erros desconhecidos viram `AI_UNAVAILABLE` com log do corpo.
- [`json_object` sem schema: saída instável] → Validação zod, uma nova tentativa com o erro, falha por campo sem derrubar a revisão.
- [Modelo `bitrix/*` fraco em pt-BR ou na tarefa] → Avaliar com 3 funções reais (SDR, Suporte, Suporte com SPA) antes de liberar; trocar o modelo é só configuração.
- [Conteúdo do cliente tenta mudar o comportamento do revisor] → Conteúdo delimitado como dado; saída validada; sugestão só entra com clique do cliente e passa pela validação do campo.
- [Chamada de contradições vê só resumos] → Contradições finas podem escapar; aceito para ficar abaixo do limite de tamanho. Contradições dentro de um campo saem na chamada do próprio campo.
- [Termos do Vibecode podem não permitir a chave da CRMThink para vários portais] → Conferir antes de implementar; sem permissão, `VIBECODE_PLATFORM_API_KEY` fica vazia e só vale a chave do cliente, sem mudar código.
- [Chave da CRMThink compartilhada vira gargalo] → Limite global (D7) e `AI_BUSY` sem cobrança; medir uso e pedir aumento de limite ao Vibecode se preciso.
- [Preço por campo descolado do custo real quando o Vibecode publicar preços] → Preço em configuração; o log de cada chamada guarda os tokens de `usage` para comparar.
- [Débito falha depois da chamada à IA] → Resultado não é entregue; custo da chamada fica conosco; log com `alert: true`.
- [Requisição síncrona longa segura conexão do backend] → Timeout de 60 s, no máximo 2 por tela, limite por tenant (D7).
- [Avisos demais e o cliente passa a ignorar] → Limite por campo, ordem por gravidade, e `recommendedItems` só nos campos que o autor marcar.

## Migration Plan

1. Contratos: `review` no schema e `reviewFunctionAnswers`. Compatível: templates sem `review` continuam válidos.
2. Seeds: preencher `review` nos campos de base e nos textos principais dos 4 templates e nos blocos. O seed só cria o que ainda não existe (`seedAgentFunctions`, `onConflictDoNothing`), então isso vale só para bancos novos. Nos ambientes que já têm as funções (staging e produção), o `review` entra pelo backoffice: abrir cada template, copiar o `review` do seed e publicar uma nova versão. Pelo D3, uma função já criada usa a versão do template a que está presa; o `review` só aparece nela quando passar para a versão nova.
3. Banco: migração criando `tenant_ai_key`. Rollback: remover a tabela; nada mais depende dela.
4. Backend: módulo `vibecode`, rotas da chave e da revisão, débito por campo. Sem `VIBECODE_PLATFORM_API_KEY`, só quem tem chave própria revisa por IA; os demais `VIBECODE_*` e `REVIEW_CREDITS_PER_FIELD` têm padrão.
5. Frontend: avisos e confirmação primeiro (funcionam sem chave), depois a configuração da chave e a revisão por IA.
6. Skill `gptthink-criar-funcao`: documentar `review`.

A IA pode ser desligada escondendo o botão no app (sem chave salva, o botão fica desativado por spec); o nível 1 não depende de nada externo.

## Open Questions

- Valores finais de `recommendedItems`, `minLength` e `rubric` em cada template de seed: decididos ao escrever os seeds.
- Valor do limite por tenant e do global (D7): ajustar depois de medir o tempo médio por campo e o limite real da chave da CRMThink.
- Valor de `REVIEW_CREDITS_PER_FIELD`: decisão comercial, só configuração.
