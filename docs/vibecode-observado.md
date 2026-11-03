# Vibecode observado

O que a documentação do Vibecode do Bitrix24 diz e o que foi visto de verdade, para a mudança
`agent-knowledge-review`. Seções marcadas **pendente** esperam teste com uma chave real.

## Documentação (lida em 2026-11-02)

Fontes: [chaves e autenticação](https://vibecode.bitrix24.com/docs-content-en/keys-auth.md),
[IA](https://vibecode.bitrix24.com/docs-content-en/ai.md),
[preços](https://vibecode.bitrix24.com/docs-content-en/ai/pricing.md).

- **Chamada**: `POST /v1/chat/completions` no contrato da OpenAI (`model`, `messages`,
  `temperature`, `tools`, `stream`, `response_format`). JSON só por `{"type":"json_object"}`; a
  doc não descreve `json_schema`.
- **Autenticação**: `X-Api-Key`, ou `Authorization: Bearer` para chave pessoal `vibe_api_`.
- **Modelos**: `GET /v1/models` lista os da conta. A doc cita só `bitrix/bitrixgpt-5.5`. Modelos
  `bitrix/*` "estão disponíveis para todos sem chave própria de provedor"; "a maioria é gratuita"
  (ai.md). A página de preços não nomeia modelo gratuito e avisa que `prompt`/`completion` iguais a
  0 não significam chamada gratuita.
- **Preço**: em Vibes (moeda interna), em `pricing.prompt` e `pricing.completion` (por 1 milhão de
  tokens), `pricing.perMinute`, `pricing.perCall` de `GET /v1/models`. Quem paga um modelo da
  plataforma com chave comum: a cota mensal de IA da empresa dona da chave, depois o saldo da conta.
  Todas as chaves da empresa consomem a mesma cota.
- **Limite**: por chave e por usuário, por minuto, sem número publicado (página própria de limites,
  não lida). Campo opcional de limite por minuto na criação da chave, só para admin da conta. Na
  borda, 60 requisições por segundo por IP, com pico de 100.
- **Escopos**: `GET /v1/me` descreve a chave: tipo, conta do Bitrix24, escopos, limites e
  capacidades. Serve para recusar chave com escopos além de `vibe:ai`. Um escopo novo do Bitrix24
  aparece na lista mesmo quando as chamadas ainda falham com `BITRIX_ACCESS_DENIED`.
- **Erros** (ai.md): `scope_missing` 403, `ai_model_not_found` 404, `ai_provider_rejected` 400,
  `ai_payload_too_large` 413, `insufficient_balance` 402, `ai_credentials_not_configured` 402,
  `ai_quota_exhausted` 402, `ai_congested` 429 (sem cobrança), `rate_limit_exceeded` 429,
  `ai_provider_unavailable` 502, `ai_provider_timeout` 503, `model_unavailable` 503.

### Tarefa 1.2: termos e uma chave para vários portais

A documentação **não responde**:

- A chave é "ligada a uma única conta do Bitrix24" (keys-auth). Para chamadas de IA isso significa
  que a conta da CRMThink arca com a cota e o saldo; a doc não fala de usar uma chave para
  atender clientes de outros portais nem de revenda.
- Não há número para o limite por minuto da chave.
- Exigência de Vibe+ para criar chave: a doc não menciona (a visão geral diz "gratuito para quem
  tem Vibe+").

Ação: confirmar por escrito com o suporte do Vibecode (uso de uma chave da CRMThink para a revisão
de clientes, limite por minuto e preço dos modelos `bitrix/*`). Até lá, `VIBECODE_PLATFORM_API_KEY`
fica vazia em produção, e só quem tem chave própria revisa por IA (a configuração já prevê isso).

## Teste com chave real (tarefas 1.1 e 1.3)

### Teste local, 2026-11-03 (parcial)

Ambiente local, uma chave `vibe_api_` do cliente (final `5dfe`), modelo `bitrix/bitrixgpt-5.5`. Função
**Suporte com SPA** (10 campos revisáveis preenchidos). Registrado a partir do que o responsável
viu na tela e do banco e Redis locais; o log do backend não foi guardado.

- **Chave:** salva e aceita (`GET /v1/models` trouxe o modelo fixo). Nada foi anotado sobre
  `GET /v1/me`: o código aceita a chave mesmo se o formato vier inesperado.
- **Revisão:** os 10 campos voltaram com resultado (todos ficaram reservados no Redis; falha libera
  a reserva). Com chave do cliente, nenhum débito no razão, como esperado.
- **Qualidade (1.3, parcial):** as sugestões vieram boas em pt-BR, segundo o responsável. Testado só
  no Suporte com SPA; **SDR e Suporte simples ainda não**.
- **Contradições:** a primeira rodada não mostrou nada. Causas tratadas no código: a tela não dizia
  nada quando a lista vinha vazia (agora diz "Nenhuma contradição encontrada") e o modelo pode citar
  o nome do campo em vez do id (agora aceitos os dois). Na segunda rodada as contradições apareceram.
- **Ajuste de tela:** aplicar uma sugestão marcava o campo como "desatualizado". Agora o item fica
  "Sugestão aplicada" e só uma edição manual marca o campo como desatualizado.

### Ainda pendente

- **1.1:** criar a chave num portal **sem** Vibe+ (se exige Vibe+ ou não), o corpo de `GET /v1/me`,
  os modelos com `pricing`, o formato de `usage` e o corpo e status de cada erro.
- **1.3:** rodar o prompt de revisão também sobre **SDR** e **Suporte**, com nota de qualidade.
- **7.1:** roteiro no staging com a chave da CRMThink (débito no extrato igual a preço × campos).
