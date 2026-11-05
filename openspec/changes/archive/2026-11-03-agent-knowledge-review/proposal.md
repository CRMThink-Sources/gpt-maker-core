# Proposal

> **Exploração (2026-10-30, atualizada 2026-11-02).** Todas as questões decididas; specs e design
> escritos. Falta `tasks.md`.

## Why

A função garante que o comportamento do agente sai bem escrito, mas a **qualidade da base de conhecimento e das respostas do formulário** continua nas mãos do cliente. Na prática ele deixa a base vazia ou rasa, mistura dois problemas num item, escreve critérios longos ou vagos e esquece políticas que o agente acaba prometendo. No teste da função "Suporte com chamado (SPA)" isso apareceu: critérios de prioridade acima do limite e campos do SPA ligados errado. Hoje o app só confere limites e obrigatórios. Não diz se a base está boa para o agente atender.

## What Changes

- **Revisão da base do agente**, em dois níveis que entram juntos nesta mudança:
  1. **Regras fixas, sem IA, para todos**: avisos no próprio campo enquanto o cliente preenche (texto curto, poucos itens, exemplo esquecido, itens repetidos, perto do limite, ligação do SPA suspeita). Configuradas pelo campo `review` do template.
  2. **Leitura por IA (Vibecode do Bitrix24)**: o cliente pede "Revisar com IA". A IA lê cada campo com o roteiro (`review.rubric`) do template, aponta problemas por item, contradições entre itens e entre respostas, e sugere o texto reescrito com o botão **"Aplicar"** no item.
- **Chave de IA**: o cliente pode informar a chave `vibe_api_…` dele, com o escopo `vibe:ai`, e não paga créditos pela revisão. Sem chave do cliente, a revisão usa a chave Vibecode da CRMThink e **debita créditos do app por campo revisado**. O app chama `POST https://vibecode.bitrix24.com/v1/chat/completions` (contrato da OpenAI) com um modelo `bitrix/*` fixo.
- **Fora desta mudança**: o chat de teste continua como hoje, com as perguntas indo direto para o GPT Maker para testar o agente. A revisão não gera conversas de teste.

## Capabilities

### New Capabilities
- `agent-knowledge-review`: regras fixas e leitura por IA do preenchimento da função e da base, configuração da chave do Vibecode e exibição dos avisos e sugestões.

### Modified Capabilities
- `agent-function-templates`: os campos e subcampos do template ganham o `review` opcional.
- `agent-function-configuration`: a tela da função mostra os avisos do nível 1, o botão "Revisar com IA" (com o custo em créditos quando usa a chave da CRMThink) e o "Aplicar" das sugestões.

## Decisões

| Tema | Decisão (2026-11-02) |
|---|---|
| Quem paga a IA | Caminho C (atualizado 2026-11-02): com chave Vibecode do cliente, sem créditos; sem chave, a chave Vibecode da CRMThink, cobrando créditos do app |
| Cobrança com a nossa chave | Por campo revisado com sucesso; o custo aparece no botão, sem confirmação extra; vale para todos os planos |
| Modelo | Fixo, um modelo `bitrix/*` (padrão `bitrix/bitrixgpt-5.5`, em configuração do backend). Sem escolha do cliente por ora |
| Sugestões | Diagnóstico e texto reescrito com "Aplicar" no item |
| Chat de teste | Sem mudança. A revisão não usa o chat de teste (o antigo nível 3 sai) |
| Roteiro por função | No template, campo `review` |
| Agente revisor no GPT Maker | Descartado: o GPT Maker é feito para conversar, não para devolver uma avaliação estruturada e estável |

## Desenho do campo `review`

O critério da revisão fica **no template da função**, editável no backoffice, junto de `help` e `format`. Templates sem `review` continuam válidos e recebem só as regras genéricas.

```ts
// Em TEXT, TEXT_LIST e KNOWLEDGE (opcional)
review?: {
  /** Abaixo disso, aviso "poucos itens". Não bloqueia: obrigatoriedade continua em required/minItems. */
  recommendedItems?: number;   // TEXT_LIST e KNOWLEDGE; 1..maxItems
  /** Texto abaixo disso, aviso "texto curto". */
  minLength?: number;          // só TEXT; 1..maxLength
  /** O que um bom preenchimento tem. Lido só pela IA (nível 2). */
  rubric?: string;             // até 500 caracteres
}

// Em cada subcampo de KNOWLEDGE (opcional)
review?: { minLength?: number } // 1..maxLength do subcampo
```

Exemplo (Suporte, `base.problemas`):

```ts
review: {
  recommendedItems: 3,
  rubric: 'A solução vem em passos numerados que o cliente consegue seguir sozinho; diz quando abrir chamado.',
},
subfields: [
  { id: 'problema', /* ... */ },
  { id: 'solucao', /* ... */, review: { minLength: 80 } },
],
```

**Regras do nível 1**

| Regra | Configurada por | Onde vale |
|---|---|---|
| Campo vazio ou com menos itens que o recomendado | `review.recommendedItems` | TEXT_LIST, KNOWLEDGE |
| Texto curto | `review.minLength` (campo ou subcampo) | TEXT, subcampo de KNOWLEDGE |
| Texto igual ao exemplo (`placeholder`) | genérica | TEXT, TEXT_LIST |
| Itens repetidos ou quase iguais (texto normalizado) | genérica | TEXT_LIST, KNOWLEDGE |
| Texto acima de 90% do limite | genérica | todo campo com limite |
| Mapeamento do SPA suspeito (mesmo campo para dois valores; valor com opções ligado a campo que não é lista) | genérica | BITRIX_SPA (conferir o formato das respostas) |

**Regras de comportamento**

- Sem `recommendedItems`, um campo vazio não gera aviso. Assim, uma FAQ opcional do SDR não acusa nada.
- A função `reviewFunctionAnswers(content, answers)` fica nos contratos, junto de `validateFunctionAnswers`, e roda no app e no backend. Ela devolve avisos `{ field, item?, subfield?, code, severity, message }` com `severity` `attention` ou `hint`. Os avisos nunca bloqueiam a publicação.
- `review` não entra no comportamento compilado, então não conta no orçamento de 3000 caracteres. Ele fica congelado com a versão publicada do template, como o resto.
- O schema recusa `recommendedItems` maior que `maxItems` e `minLength` maior que `maxLength`.
- A tela mostra os avisos em ordem de gravidade e limita a quantidade, para o cliente não passar a ignorá-los.

## Leitura por IA (nível 2)

```
 tela da função ──"Revisar com IA"──▶ backend ──por campo──▶ Vibecode /v1/chat/completions
      ▲                                  │                  (bitrix/*, json_object)
      └──── avisos + texto sugerido ◀────┘ valida com zod; fora do formato tenta 1x
```

- **Uma chamada por campo** de base ou de texto revisável, não a base inteira numa chamada. O limite de tamanho do Vibecode não é publicado (`ai_payload_too_large`, 413), e uma base cheia passa de 50 mil caracteres. As contradições entre campos vêm numa chamada final, com um resumo curto de cada campo.
- **Entrada**: o rótulo, o `help` e o `rubric` do campo, os itens e um contexto curto da função (nome da empresa e função escolhida).
- **Saída**: em `json_object`, validada com zod. Para cada item: problemas (código e texto) e o texto sugerido opcional. Fora do formato, tenta de novo uma vez; se falhar de novo, aquele campo fica sem leitura e a tela avisa.
- **"Aplicar"** troca a resposta do item no formulário, sem salvar nem publicar. A sugestão passa pela mesma validação (`maxLength`, obrigatórios); se não passar, o botão não aparece.
- **Ritmo**: poucas chamadas ao mesmo tempo, por causa do limite por minuto (por chave e por usuário). `ai_congested` (429) e `ai_provider_timeout` (503) tentam de novo com espera; o 429 não é cobrado.
- **Erros que viram mensagem ao cliente**: `scope_missing` (403), chave inválida, `insufficient_balance` e `ai_quota_exhausted` (402), `ai_model_not_found` e `model_unavailable`.

## Cuidados

- **Escopo da chave**: a `vibe_api_` também abre dados do Bitrix24 nos escopos escolhidos (CRM, tarefas…). Orientar a criar a chave **só com `vibe:ai`** e, se der para verificar, recusar chave com outros escopos.
- **Guarda**: cifrada como os tokens das intenções (`backend/src/shared/crypto/field-cipher.ts`); nunca devolvida à tela depois de salva. Ao salvar, testar com `GET /v1/models` e conferir se o modelo fixo está na lista.
- **Plano do cliente**: o Vibecode se apresenta como "gratuito para quem tem Vibe+". A documentação não diz se a chave funciona sem Vibe+. **Conferir antes do design**: se exigir Vibe+, o nível 2 só alcança esses clientes, e a tela precisa dizer isso.
- **Dependência em beta**: o Vibecode está em beta e os preços só saem depois. Os modelos `bitrix/*` são "na maioria grátis", o que reduz esse risco. Tratar a IA como opcional, com mensagem clara quando a chave falhar ou ficar sem saldo.
- **Privacidade**: a base e as respostas vão para o Vibecode, na conta do cliente ou na da CRMThink. Avisar na configuração da chave e junto do botão.
- **Chave da CRMThink compartilhada**: o limite por minuto do Vibecode é por chave e por usuário, então todos os clientes sem chave disputam o mesmo limite. Precisa de limite global além do limite por tenant.
- **Termos do Vibecode**: conferir se uma chave da CRMThink pode atender clientes de vários portais.

## Questões em aberto

1. ~~Escopo~~: decidido (2026-11-02). O formulário inteiro e a base, porque os erros do teste do SPA estavam no formulário.
2. ~~Momento~~: decidido (2026-11-02). Avisos do nível 1 sempre visíveis no campo; ao publicar, resumo "N pontos de atenção" com "publicar mesmo assim"; IA só pelo botão. Nunca bloqueia.
3. ~~Sugestões~~: decidido (ver "Decisões").
4. ~~Pagamento~~: decidido (ver "Decisões").
5. ~~Roteiro por função~~: decidido (ver "Desenho do campo `review`").
6. ~~Níveis~~: decidido. Níveis 1 e 2 juntos; o chat de teste não muda.

## Impact

- **Contratos**: campo `review` no schema do template (`packages/contracts/src/agent-functions.ts`), `reviewFunctionAnswers` e os schemas do resultado da leitura por IA e da configuração da chave.
- **Backend**: módulo novo de revisão (cliente do Vibecode, uma chamada por campo, validação da saída), configuração da chave por tenant (cifrada), chave da CRMThink e modelo fixo em configuração, débito por campo no razão de créditos (`credit_ledger`).
- **Frontend**: configuração da chave (app), avisos no campo, botão "Revisar com IA", sugestões com "Aplicar".
- **Seeds e skill**: preencher `review` nos campos dos templates de seed e documentar o campo na skill `gptthink-criar-funcao`.
- **Externo**: API do Vibecode (`/v1/chat/completions`, `/v1/models`, escopo `vibe:ai`), em beta.

Fontes: [Vibecode: chaves e autenticação](https://vibecode.bitrix24.com/docs-content-en/keys-auth.md), [Vibecode: IA](https://vibecode.bitrix24.com/docs-content-en/ai.md), [Vibecode: visão geral](https://vibecode.bitrix24.com/gb-en/overview).
