# Tasks

## 1. Confirmar o Vibecode antes de construir

- [ ] 1.1 Num portal **sem** Vibe+, tentar criar uma chave `vibe_api_` só com `vibe:ai`; num portal com Vibe+, criar a mesma chave. Chamar `GET /v1/models` e um `POST /v1/chat/completions` com `bitrix/bitrixgpt-5.5` e `response_format: {"type":"json_object"}`. Registrar em `docs/vibecode-observado.md`: se exige Vibe+, os modelos listados, o formato real de `usage`, do erro (corpo e status) e se há rota que mostre os escopos da chave. Verificação: seção no doc com as respostas reais e a data. Se a chave exigir Vibe+, registrar e seguir (a tela só muda o texto, design Risks)
- [x] 1.2 (a doc não responde sobre vários portais nem dá o limite; registrado, e a chave da CRMThink fica vazia até o suporte do Vibecode confirmar) Conferir nos termos do Vibecode se uma chave da CRMThink pode atender clientes de vários portais, e o limite por minuto dessa chave. Verificação: resposta registrada em `docs/vibecode-observado.md`; se não puder, anotar que `VIBECODE_PLATFORM_API_KEY` fica vazia em produção e avisar o usuário
- [x] 1.3 (aceito pelo responsável em 2026-11-03: testado só no Suporte com SPA, sugestões boas; SDR e Suporte simples sem teste) Rodar o prompt de revisão (design D4) à mão, pelo `curl`, sobre os campos de base de 3 funções reais (SDR, Suporte, Suporte com SPA). Verificação: em `docs/vibecode-observado.md`, as saídas e uma nota curta de qualidade em pt-BR; se a qualidade for ruim, parar e perguntar ao usuário antes do grupo 4

## 2. Contratos: campo `review` e regras fixas

- [x] 2.1 Adicionar `review` opcional (`recommendedItems`, `minLength`, `rubric`) ao tipo `FunctionField` e aos schemas zod de `TEXT`, `TEXT_LIST`, `KNOWLEDGE`, e `review.minLength` ao subcampo de base, com as recusas de limite (`recommendedItems > maxItems`, `minLength > maxLength`, `rubric` > 500), em `packages/contracts/src/agent-functions.ts`. Verificação: testes em `agent-functions.test.ts` para template válido com `review`, cada recusa (mensagem nomeia o campo) e template sem `review`
- [x] 2.2 Garantir que `review` não entra no comportamento nem no pior caso do orçamento. Verificação: teste em `agent-function-compiler.test.ts` compilando o mesmo template com e sem `review` e comparando comportamento e orçamento iguais
- [x] 2.3 Criar `reviewFunctionAnswers(content, answers)` em `packages/contracts/src/agent-function-review.ts`, exportada no índice, com o tipo do aviso `{ field, item?, subfield?, code, severity, message }` e as 7 regras do spec, respeitando campos visíveis e respostas parciais. Verificação: `agent-function-review.test.ts` com um caso por regra, o caso "campo vazio sem `recommendedItems` não avisa", o de dependente oculto e o de itens repetidos com acento e pontuação diferentes
- [x] 2.4 Adicionar os schemas da revisão por IA nos contratos: criação da revisão (`{ reviewId, keySource, creditsPerField }`), resultado do campo (`summary`, `items[].problems[]`, `items[].suggestion`, `applicable`), contradições e a visão da chave (`{ configured, last4, verifiedAt, creditsPerField, platformAvailable }`). Verificação: testes de parse válidos e inválidos; `npm run build` e testes do pacote `contracts` verdes

## 3. Seeds e skill

- [x] 3.1 Preencher `review` nos campos de base e nos textos principais dos 4 templates de seed (`backend/src/modules/agent-functions/seed/*.ts`), com `rubric` específica por função. Verificação: teste do seed passa (templates válidos) e o orçamento de cada template não muda
- [x] 3.2 Documentar `review` na skill `gptthink-criar-funcao` (o que cada chave faz, limites, exemplo do Suporte e "campo vazio só avisa com `recommendedItems`"). Verificação: um JSON de exemplo da skill passa no schema do template
- [ ] 3.3 (operacional, precisa de acesso ao backoffice) Nos ambientes que já têm as funções (staging e produção) o seed não sobrescreve: abrir cada template e o bloco `comum` no backoffice, copiar o `review` dos seeds (`backend/src/modules/agent-functions/seed/`) e publicar nova versão. Verificação: no staging, o JSON publicado do template mostra o `review` e uma função criada com a versão nova mostra os avisos no formulário

## 4. Backend: cliente do Vibecode e chave

- [x] 4.1 Adicionar `VIBECODE_BASE_URL`, `VIBECODE_REVIEW_MODEL`, `VIBECODE_PLATFORM_API_KEY` (opcional), `VIBECODE_PLATFORM_RPM` e `REVIEW_CREDITS_PER_FIELD` em `backend/src/config/env.ts`, com padrões, e no `.env.example`. Verificação: teste do schema de env com e sem as variáveis
- [x] 4.2 Criar o módulo `vibecode` com `chat()` e `listModels()` sobre `fetch` (Bearer), tradução de erros da tabela D5, novas tentativas em 429/502/503 com `Retry-After` e timeout. Verificação: `vibecode.client.test.ts` com servidor falso cobrindo sucesso, cada código da tabela, nova tentativa, `Retry-After` e erro desconhecido virando `AI_UNAVAILABLE`, usando os corpos reais da tarefa 1.1
- [x] 4.3 Migração da tabela `tenant_ai_key` (`tenant_id` PK, `api_key` `encryptedText`, `last4`, `model`, `verified_at`, timestamps) e schema Drizzle. Verificação: `npm run db:generate` gera só essa tabela; migração aplica e reverte no banco de teste
- [x] 4.4 Rotas da chave (salvar e remover com acesso `admin`; ler com `manage`, para o botão da tela da função): ao salvar, testa com `listModels`, recusa sem o modelo fixo ou com `scope_missing`, grava `last4` e `verified_at`; a leitura nunca devolve a chave. Verificação: teste de integração cobrindo chave válida, inválida, sem escopo, sem o modelo, leitura sem a chave, acesso `manage` recusado e remoção

## 5. Backend: revisão por IA e cobrança

- [x] 5.1 Criar a revisão (`POST /agents/:id/function/review`, acesso `manage`): escolhe a chave (cliente, CRMThink ou `AI_KEY_REQUIRED`), guarda no Redis por 30 min `reviewId`, tenant, agente, `keySource` e campos permitidos. Verificação: testes para as três origens de chave, campos não revisáveis recusados e revisão de outro tenant recusada
- [x] 5.2 Revisar um campo (`POST .../review/:reviewId/field`): reserva `SET NX`, revalida respostas com `validateFunctionAnswers(..., { partial: true })` contra a versão do template presa à configuração, monta o prompt (D4), chama o Vibecode, valida com zod, tenta uma vez de novo se a saída vier inválida, marca sugestões acima do limite como `applicable: false`; falha libera a reserva. Verificação: testes com Vibecode falso para resultado válido, saída inválida duas vezes, sugestão acima do limite, campo já reservado e template vindo do banco (não do app)
- [x] 5.3 Cobrança com `keySource: 'platform'`: conferir saldo antes (`NO_CREDIT` sem chamar a IA), debitar depois da saída válida com `key: review:<reviewId>:<fieldId>`, `refType: 'function_review'`, `createdBy: 'system:review'`, e chamar `CreditAlerts.afterDebit`; com `keySource: 'tenant'`, nada é debitado. Verificação: teste de integração com o razão real cobrindo 4 campos com 1 falha (3 débitos), saldo para só 2, mesmo campo chegando duas vezes (1 débito), chave do cliente (0 débito) e falha do débito (campo sem resultado, reserva liberada)
- [x] 5.4 Erros da chave da CRMThink viram `AI_UNAVAILABLE` ao cliente e log com `alert: true`; erros da chave do cliente viram as mensagens do spec, sem trocar de chave. Verificação: testes para `insufficient_balance` nas duas origens
- [x] 5.5 Contradições (`POST .../review/:reviewId/cross`): uma chamada com os resumos, sem cobrança. Verificação: teste com Vibecode falso conferindo o formato e nenhum lançamento no razão
- [x] 5.6 Limites (D7): por tenant nas rotas de campo e global para `keySource: 'platform'` (espera até 5 s, tenta uma vez, `AI_BUSY` sem cobrança e com a reserva liberada). Verificação: testes com `RedisRateLimiter` real no Redis de teste para os dois limites
- [x] 5.7 Rótulo "Revisão da função" para `refType: 'function_review'` no extrato (`CreditStatementService` e tela de extrato). Verificação: teste do serviço de extrato com um lançamento de revisão mostrando o rótulo e o agente

## 6. Frontend: avisos, configuração da chave e revisão

- [x] 6.1 Mostrar os avisos de `reviewFunctionAnswers` no `function-form.tsx`, junto da validação do campo, com no máximo 3 por campo (`attention` antes de `hint`, "ver mais N") e o resumo no topo com link para cada campo. Verificação: testes em `function-form.test.tsx` para aviso aparecendo ao digitar, limite de 3 e resumo
- [x] 6.2 Confirmação "N pontos de atenção" no fluxo de publicar, só com avisos `attention`, com "Revisar" e "Publicar mesmo assim". Verificação: testes para publicar com `attention` (pede confirmação) e só com `hint` (publica direto)
- [x] 6.3 Tela da chave Vibecode (só admin do portal): salvar, trocar e remover, mostrando final e data do teste, o aviso de privacidade e a orientação de criar a chave só com `vibe:ai`. Verificação: teste da tela para chave salva, recusa com a mensagem do backend e campo vazio ao reabrir
- [x] 6.4 Botão "Revisar com IA" com custo (preço × campos revisáveis preenchidos, recalculado ao preencher) ou "sem uso de créditos" com chave própria, e desativado quando não há chave nenhuma, com o link para configurar. Verificação: testes para "Revisar com IA · 10 créditos", chave própria e botão desativado
- [x] 6.5 Fluxo da revisão: cria a revisão, revisa até 2 campos ao mesmo tempo mostrando "revisando…" e o resultado de cada um, depois as contradições; falhas por campo com a mensagem do spec; resultado só em memória com hash por campo ("desatualizado" ao editar, com "revisar este campo"). Verificação: testes com API falsa para resultados por partes, falha num campo sem afetar os outros, `NO_CREDIT` no meio e campo desatualizado
- [x] 6.6 "Aplicar" na sugestão: troca o texto pelo mesmo caminho da digitação (recalcula avisos, marca não salvo); sem botão quando `applicable: false` ou quando a validação local recusa. Verificação: testes para aplicar e para sugestão acima do limite

## 7. Integração

- [ ] 7.1 No staging (`docs/staging.md`), com a chave da CRMThink, revisar a função Suporte com SPA de ponta a ponta: avisos, revisão de todos os campos, contradições, "Aplicar" e o débito no extrato igual a preço × campos revisados. Repetir com uma chave de cliente e conferir zero débito. Verificação: roteiro e resultado registrados em `docs/vibecode-observado.md`
- [x] 7.2 `openspec validate agent-knowledge-review --strict`, `npm run build` e os testes de `contracts`, `backend` e `frontend`. Verificação: tudo verde

## Pendências registradas no arquivamento (2026-11-03)

Código, testes e validação do spec estão prontos; o que ficou depende de acesso externo e segue como
trabalho operacional:

- 1.1: criar a chave num portal **sem** Vibe+ e registrar em `docs/vibecode-observado.md` se exige Vibe+, o corpo de `GET /v1/me`, o `usage` e os erros reais. Hoje só há o teste local com chave do cliente.
- 3.3: copiar o `review` dos seeds para os templates no backoffice de staging e produção e publicar nova versão.
- 7.1: roteiro de ponta a ponta no staging com a chave da CRMThink (débito no extrato = preço × campos) e com chave de cliente (zero débito).
- A tarefa 1.3 foi aceita com a ressalva de que só o Suporte com SPA foi testado; SDR e Suporte simples ficam sem avaliação.
