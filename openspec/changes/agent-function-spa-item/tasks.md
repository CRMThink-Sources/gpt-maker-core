# Tasks

## 1. Confirmar o Bitrix24 num portal real

- [x] 1.1 Num portal de teste, chamar `imopenlines.dialog.get` num chat com sessão aberta e comparar o 6º segmento de `entity_data_1` com o id da sessão (histórico/`imopenlines.session.*`); registrar em `docs/bitrix-observado.md`. Verificação: seção nova no doc com a resposta real e a data. Se não bater, parar a parte da sessão (design D5) e perguntar ao usuário
- [x] 1.2 (leitura feita; o `crm.item.add` real ficou para a 6.1, escrita no portal precisa de você) No mesmo portal, chamar `crm.type.list`, `crm.item.fields { entityTypeId }` e `crm.item.add` com um campo lista (id do item) e `title`; anotar o formato real das chaves (camelCase), dos itens de lista (`items[].ID/VALUE/XML_ID`) e se `title` é aceito com o título desativado. Verificação: trecho registrado em `docs/bitrix-observado.md`

## 2. Contratos: ação, variáveis e campo de SPA

- [x] 2.1 Adicionar `CREATE_SPA_ITEM` ao schema das ações de intenção em `packages/contracts/src/triggers.ts` (`entityTypeId`, `categoryId?`, `stageId?`, `title`, `fields`, `lists?`) e ao `intentionActionTypeSchema`. Verificação: testes em `intentions.test.ts` para config válida, `entityTypeId` ausente e `lists` com id não positivo
- [x] 2.2 Adicionar `dialog.chatId` e `dialog.sessionId` ao `TemplateContext` e ao `TEMPLATE_VARIABLES` em `templates.ts`. Verificação: teste de `templateErrors` aceitando as duas e de `renderTemplate` com valores vazios
- [x] 2.3 Adicionar o campo `BITRIX_SPA` (com `values[]` e `options?`) em `agent-functions.ts`, a forma da resposta em `agent-function-answers.ts` e a validação das respostas (SPA obrigatório, valor obrigatório com código, opção ligada só a número). Verificação: testes em `agent-functions.test.ts` e `agent-function-answers.test.ts`
- [x] 2.4 Checagens do template (`checkTemplate`): `{{x.spa}}` proibido em textos; `spa` é marcador sozinho de `BITRIX_SPA`; chaves de `values` declaradas; valor declarado sem uso; dependente sem `when`. Verificação: um teste por mensagem em `agent-functions.test.ts`
- [x] 2.5 Compilação: traduzir `spa`/`values` em `entityTypeId`/`categoryId`/`stageId`/`fields`/`lists` antes do `renderConfig`, omitindo valores sem código; peso 0 no orçamento e `fieldText` vazio para `BITRIX_SPA`. Verificação: teste em `agent-function-compiler.test.ts` compilando o Suporte com SPA e conferindo a ação final validada pelo schema da intenção
- [x] 2.6 Fixture do SPA em `agent-function-spa.test.ts` (em vez de `agent-functions.fixture.ts`, para não mexer nos testes do SDR) e rodar `npm run build` e os testes do pacote `contracts`. Verificação: tudo verde

## 3. Backend: execução

- [x] 3.1 Extrair chat e sessão do diálogo: `chatId` de `dialog.id` e `sessionId` de `entity_data_1` no mesmo `imopenlines.dialog.get` do vínculo (lazy, só se algum texto usar). Verificação: teste de unidade do parser com a resposta real da tarefa 1.1 e teste em `crm-binding.test.ts`
- [x] 3.2 Preencher `dialog.chatId`/`dialog.sessionId` no contexto do `intention-runner.ts` (e no `buildTemplateContext` dos gatilhos, por consistência). Verificação: `template-context.test.ts` e `intention-runner.test.ts`
- [x] 3.3 Implementar o caso `CREATE_SPA_ITEM` no `TriggerActionExecutor`: `crm.item.fields` (sem cache, ver design D4), tradução das listas (ligação → `VALUE`/`XML_ID` → omite com aviso), valores vazios fora, `crm.item.add` com `entityTypeId`, `categoryId`, `stageId`, `title`; devolve `{ itemId, entityTypeId, warnings? }`. Verificação: testes de integração em `trigger-actions.test.ts` (criado, lista por ligação, lista por nome, lista sem correspondência, recusa do Bitrix definitiva)
- [x] 3.4 Garantir que a falha da ação de SPA não impede o passo seguinte de transferência na mesma intenção. Verificação: caso em `intention-runner.test.ts` com SPA falhando e `TRANSFER_TO_HUMAN` agendado

## 4. Frontend: formulário do cliente e editor do backoffice

- [x] 4.1 Hooks em `frontend/src/lib/crm-fields` para tipos de SPA, funis, etapas e campos de um SPA via BX24. Verificação: teste dos hooks com BX24 simulado
- [x] 4.2 `SpaFields` em `bitrix-pickers.tsx` e o caso `BITRIX_SPA` em `function-form.tsx`: SPA, funil, etapa, campo por valor, ligação das opções com sugestão por nome, limpeza ao trocar o SPA e fallback digitado. Verificação: `function-form.test.tsx` cobrindo sugestão, limpeza e obrigatório; conferir no app dentro do Bitrix24
- [x] 4.3 Backoffice: campo `BITRIX_SPA` em `field-editor.tsx`/`model.ts`/`kit.tsx` (lista de valores com opções) e a ação "Criar item de SPA" em `intention-editor.tsx` (escolher o campo e preencher cada valor declarado). Verificação: criar no editor a função do exemplo e ver "Estrutura válida" na aba JSON

## 5. Skill `gptthink-criar-funcao`

- [x] 5.1 `referencia/formato.md`: linha do `BITRIX_SPA` na tabela de campos, passo `CREATE_SPA_ITEM` na tabela de ações, variáveis `dialog.chatId`/`dialog.sessionId`, regras de `values`. Verificação: leitura cruzada com os schemas da tarefa 2
- [x] 5.2 `scripts/validar.mjs`: mesmas checagens da 2.4 e peso 0 do campo. Verificação: o exemplo novo passa com `OK`; cópias com valor sem uso e valor não declarado falham com a mensagem certa; `skill-validator.test.ts` verde
- [x] 5.3 Novo exemplo `exemplos/suporte-spa.json`: Suporte que tenta resolver pela base e, sem solução, usa "Abrir chamado" com Origem `CHAT`, Prioridade (critérios do cliente por nível no formulário), Problema relatado, Chat de origem, Diálogo de origem e Sessão, seguido de transferir para usuário escolhido. Verificação: `node .claude/skills/gptthink-criar-funcao/scripts/validar.mjs .claude/skills/gptthink-criar-funcao/exemplos/suporte-spa.json` dá `OK` e pior caso ≤ 3000
- [x] 5.4 `SKILL.md`: seção "Funções que abrem item de SPA" (quando usar, como declarar os valores, prioridade pelo agente, transferir depois, o que o cliente faz no formulário) e linhas na tabela de erros comuns. Verificação: a skill cita o exemplo novo e os nomes de erro batem com os do validador

## 6. Integração

- [x] 6.1 (2026-10-30: item criado no SPA com os campos certos, prioridade e origem como itens de lista, e conversa transferida) Publicar a função do exemplo num agente de teste do portal, mapear um SPA real e conversar até abrir o chamado. Verificação: item criado no SPA com os seis valores corretos (prioridade como item da lista) e conversa transferida ao usuário escolhido
- [x] 6.2 Rodar `openspec validate agent-function-spa-item --strict`, lint e todos os testes do monorepo. Verificação: tudo verde

## 7. Lacunas do mapeamento achadas no teste (2026-10-30)

- [ ] 7.1 Recusar o mesmo campo do SPA para dois valores (respostas e na publicação), apontando os valores repetidos. Verificação: teste em `agent-function-spa.test.ts` e aviso no seletor (`spa-fields.test.tsx`)
- [ ] 7.2 No seletor, oferecer só campos de texto, número e lista (fora data, usuário, dinheiro etc.) e, para valor com opções, listar primeiro os campos lista. Verificação: `crm-fields.test.ts` com um campo `datetime` fora da lista
