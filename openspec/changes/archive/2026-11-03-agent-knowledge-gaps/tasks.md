# Tasks

## 1. Pré-requisito e contratos

- [ ] 1.1 Conferir que a tarefa 1.3 de `agent-knowledge-review` (qualidade do modelo em SDR, Suporte e Suporte com SPA) está concluída e anotar no fim de `docs/vibecode-observado.md` o teste do prompt de cobertura à mão (`curl`) sobre as mesmas 3 funções, com a expectativa escrita. Verificação: seção no doc com as saídas e uma nota curta de qualidade; se o modelo inventar prazo ou valor sem marcador, parar e perguntar ao usuário antes do grupo 2
- [x] 1.2 Em `packages/contracts`, criar `REVIEW_PLACEHOLDER` (`/\[preencher:[^\]]*\]/i`) e `findPlaceholders(answers, content)`; adicionar o código `PENDING_PLACEHOLDER` (`attention`) em `reviewFunctionAnswers`, apontando campo, item e subcampo. Verificação: testes em `agent-function-review.test.ts` com marcador num texto, num item de lista e num subcampo da base, e sem aviso quando não há marcador
- [x] 1.3 Em `validateFunctionAnswers`, recusar resposta com marcador `[preencher: …]` quando **não** é parcial, dizendo o campo e o item; parcial (rascunho) segue aceitando. Verificação: testes em `agent-functions.test.ts` para publicar recusado, rascunho aceito e marcador preenchido aceito
- [x] 1.4 Adicionar nos contratos `withGaps?` na criação da revisão, o corpo da rota `gaps` (`expectation` de 20 a 1000 caracteres, `answers`, `summaries`) e os schemas da saída da IA e do resultado (`gaps[]` com `fieldId`, `title`, `why`, `item`, `applicable`, `reason`; `covered[]`). Verificação: testes de parse válidos e inválidos (expectativa curta, lacuna sem campo) e `npm run build` do pacote verde

## 2. Backend

- [x] 2.1 Na criação da revisão, com `withGaps`, gravar na sessão `gapFieldIds` com todos os campos `KNOWLEDGE` do template (não só os preenchidos). Verificação: teste de integração em `function-review.test.ts` com campo de base vazio incluído e campo que não é de base recusado
- [x] 2.2 Criar o prompt de cobertura e a validação do rascunho (D3 e D4): regra dos marcadores no `system`, títulos existentes no `user`, descarte de campo ou subcampo desconhecido e de título repetido, `applicable` e `reason` (`FULL`, `LIMIT`, `REQUIRED`). Verificação: testes unitários de `review-prompt` com título repetido com acento diferente, campo cheio contando lacunas anteriores, subcampo acima do limite e rascunho com marcador aceito
- [x] 2.3 Rota `POST .../review/:reviewId/gaps` (acesso `manage`): revalida as respostas com `partial: true` contra a versão presa do template, reserva `__gaps__` com `SET NX`, confere o saldo (chave da CRMThink), chama o Vibecode com uma nova tentativa se a saída vier fora do formato, aplica os limites por tenant e o global e libera a reserva em qualquer falha. Verificação: testes de integração com Vibecode falso para resultado válido, saída inválida duas vezes (`AI_BAD_OUTPUT`, sem cobrança, reserva liberada), segunda chamada na mesma revisão, `NO_CREDIT` sem chamar a IA e revisão de outro tenant recusada
- [x] 2.4 Cobrança da cobertura: débito de um campo (`key: review:<reviewId>:__gaps__`, `refType: 'function_review'`) só com chave da CRMThink e saída válida, com `CreditAlerts.afterDebit`; chave do cliente não debita. Verificação: teste de integração com o razão real: 4 campos e a cobertura somam 5 débitos, cobertura repetida cobra uma vez, chave do cliente zera, falha do débito libera a reserva
- [x] 2.5 Barrar a publicação e a criação do agente com marcador pendente (D5), apontando campo e item na mensagem; confirmar que o rascunho segue permitido. Verificação: teste de integração em `agent-function-publication.test.ts` para publicar recusado, criar recusado, rascunho salvo e publicação com o marcador preenchido

## 3. Frontend

- [x] 3.1 Campo "O que você espera do agente? (opcional)" no painel de revisão, com contador, validação de 20 a 1000 caracteres e o custo do botão somando a cobertura quando a expectativa é válida. Verificação: testes em `review.test.tsx` para botão sem expectativa, com expectativa (custo + 1 campo), chave própria ("sem uso de créditos") e expectativa curta com o motivo
- [x] 3.2 Fluxo: criar a revisão com `withGaps` quando há expectativa, chamar `/gaps` depois das contradições e guardar lacunas, cobertura e falha no estado da revisão, sem afetar os resultados dos campos. Verificação: testes em `use-function-review.test.tsx` com API falsa para sucesso, falha só da cobertura e `NO_CREDIT`
- [x] 3.3 Seção "Lacunas" com título, motivo, rascunho, "Adicionar" (insere item novo com `itemKey` novo no fim do campo, mesma validação local do "Aplicar") e "Adicionado"; sem botão quando `applicable: false`, dizendo o motivo; "Nenhuma lacuna encontrada" e a lista do que a base já cobre. Verificação: testes para adicionar, campo cheio, lacuna acima do limite e base já cobre
- [x] 3.4 Mostrar o aviso `PENDING_PLACEHOLDER` no item do campo e tratar a recusa de publicar com marcador (mensagem do backend com o campo e o item, link do resumo para o campo). Verificação: teste de formulário com item contendo `[preencher: prazo]` mostrando o aviso, e que o aviso some ao preencher

## 4. Documentação e fechamento

- [x] 4.1 Documentar na skill `gptthink-criar-funcao` que os textos de exemplo do `placeholder` não podem usar `[preencher: …]` e acrescentar a regra ao validador da skill. Verificação: `node .claude/skills/gptthink-criar-funcao/scripts/validar.mjs` recusa um exemplo com o marcador e aceita os atuais
- [ ] 4.2 No staging, com a chave da CRMThink, rodar a Suporte com SPA com a expectativa preenchida: lacunas, "Adicionar", marcador bloqueando a publicação e débito de campos mais a cobertura no extrato; repetir com chave do cliente e conferir zero débito. Verificação: roteiro e resultado registrados em `docs/vibecode-observado.md`
- [x] 4.3 `openspec validate agent-knowledge-gaps --strict`, `npm run build` e os testes de `contracts`, `backend` e `frontend`. Verificação: tudo verde

## Pendências registradas no arquivamento (2026-11-03)

Código, testes e validação do spec estão prontos. O teste do prompt de cobertura foi feito pelo app
no Suporte com SPA e funcionou segundo o responsável; o que ficou depende de acesso externo:

- 1.1: o teste à mão do prompt de cobertura sobre SDR e Suporte simples, e o registro das saídas em `docs/vibecode-observado.md`.
- 4.2: o roteiro no staging com a chave da CRMThink (campos mais a cobertura no extrato) e com chave de cliente (zero débito).
- Defeito conhecido: ao adicionar um item de lacuna, as outras sugestões do mesmo campo aparecem como "desatualizado" (a correção, rebasear a revisão do campo no hook, foi revertida junto do assistente).
