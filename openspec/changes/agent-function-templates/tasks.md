# Tasks

> Estimativas em horas de trabalho focado de 1 dev sênior full-stack, incluindo testes.

## 1. Contratos: definição de template e compilador

- [x] 1.1 Schema zod da definição de template em `packages/contracts` (campos, opções com `label`/`snippet`, dependentes, itens da base, intenções, settings, marcadores); testes unitários aceitando um template válido e recusando marcador inexistente, opção sem trecho e dependente órfão (~4h)
- [x] 1.2 Schema zod das respostas do formulário (com `itemKey` nos itens da base) e validação contra a versão do template (obrigatórios, limites, dependentes, URLs); testes cobrindo cada regra da spec "Respostas do formulário" (~4h)
- [x] 1.3 Compilador puro `compileAgent` (marcadores, listas como tópicos, múltipla escolha concatenada, seções omitidas, instruções adicionais só em `ADVANCED`, comportamento assumido em `TAKEN_OVER`, treinamentos ≤ 1028 com prefixo de título, intenções ativadas por escolha, settings derivados, relatório de caracteres por campo); testes de determinismo, de cada tipo de campo e de falha acima de 3000 sem truncar (~8h)
- [x] 1.4 Cálculo do pior caso de orçamento a partir da definição; testes com um template acima e outro dentro de 3000, verificando o total e a contribuição por campo (~3h)
- [x] 1.5 Cálculo do plano de publicação (criar/atualizar/remover por chave e hash, diff do comportamento e dos settings); testes para item editado, removido, adicionado e "nada mudou" (~4h)
- [x] 1.6 Ajustar `createAgentSchema`/`updateAgentSchema` (função + formulário; sem `behavior`/`type`/`jobDescription` livres; settings só operacionais) e remover `DOCUMENT` de `createTrainingSchema`; `npm run typecheck` passa em todos os workspaces (~2h)

## 2. Dados e migração

- [x] 2.1 Schema Drizzle + migração: `agent_function_template`, `agent_function_template_version`, `agent_function_block`, `agent_function_config`, `agent_managed_resource`, `tenant.is_partner`, `training.managed`, `agent_intention.managed`; migração aplica em banco limpo, com padrões e unicidades verificados em `agent-function-schema.test.ts` (o projeto não usa migrações de reversão) (~4h)
- [x] 2.2 Script de descarte dos agentes de teste (remove no GPT Maker e marca `DELETED` localmente, idempotente); teste de integração com GPT Maker simulado e roteiro em `docs/staging.md` (~3h)

## 3. Backoffice: blocos e templates

- [x] 3.1 Serviço e rotas de blocos (rascunho, publicar) com auditoria; testes de integração de acesso restrito ao backoffice (~3h)
- [x] 3.2 Serviço e rotas de templates: editar rascunho, publicar versão (expandindo blocos, validando marcadores e orçamento), listar versões com contagem de agentes, comparar e restaurar como nova versão; testes de integração para "Publicar nova versão", "Rollback", "Pior caso acima do limite" e "Marcador de campo inexistente" (~8h)
- [x] 3.3 Agente de sandbox: criação sob demanda com nome reservado, registro na configuração do workspace e publicação da prévia pelo executor de publicação (grupo 5); teste de integração verificando que nenhum tenant é afetado (~4h)
- [x] 3.4 Marcar/desmarcar tenant parceiro na gestão de tenants, com auditoria; teste de integração dos dois cenários da spec "Tenant parceiro" (~2h)
- [x] 3.5 Telas `/admin/functions`: lista de templates, editor do rascunho (JSON com validação ao vivo e prévia com respostas de exemplo), versões com contagem de agentes, diff entre versões, restaurar e testar no sandbox; telas `/admin/functions/blocks`; verificar no navegador o fluxo editar → prévia → sandbox → publicar (~12h)

- [x] 3.6 Inativar, reativar e excluir função (`active` e `deleted_at` no template, migração; criação e lista do app só com ativas; exclusão lógica só sem agentes não removidos; auditoria; botões na tela da função); testes de integração dos quatro cenários da spec "Inativar e excluir função" (~5h)

- [x] 3.7 Restaurar versão também volta o rascunho (montado com `collapseBlocks`, na mesma transação da nova versão; mantido quando um bloco mudou depois dela), com o rascunho anterior na auditoria e o aviso na tela só quando não deu para trocar; testes de integração para "Rollback volta o rascunho" e "Rollback com bloco alterado depois da versão" (~2h)

## 4. Seed das quatro funções

- [x] 4.1 Blocos compartilhados no seed: bloco comum, "onde registrar", "abrir chamado / registrar dúvida", "transferir para atendente"; o seed passa no schema do item 1.1 (~3h)
- [x] 4.2 Templates SDR e Suporte no seed, conforme o documento de produto (campos, trechos, intenções, settings); teste de que o pior caso de cada um fica ≤ 3000 (~6h)
- [x] 4.3 Templates Agendamento e Pós-venda no seed (links no comportamento, intenções de avaliação com corte fixo); teste de pior caso ≤ 3000 (~6h)
- [x] 4.4 Aplicação do seed como versão 1, uma única vez (não sobrescreve versões publicadas pelo backoffice); teste de integração rodando o seed duas vezes (~2h)
- [x] 4.5 Skill de escrita de templates em `.claude/skills/` (estrutura, orçamento, padrões de escrita do comportamento, checklist antes de publicar); revisar a skill contra os quatro templates do seed (~3h)

## 5. Publicação do agente

- [x] 5.1 Serviço de configuração do agente: escolher função na criação, salvar rascunho das respostas, prévia (compila + plano) e recusa de troca de função; testes de integração para "Salvar rascunho", "Resposta inválida" e "Troca de função" (~5h)
- [x] 5.2 Executor de publicação no worker (fila RabbitMQ): ordem de D5, progresso em `agent_managed_resource`, associação de ids de treinamentos por texto e de intenções por descrição, estados `PENDING`/`FAILED`, repetição aplicando só o que falta; testes de integração para "Publicar", "Falha parcial" sem duplicar e "Nada mudou" (~10h)
- [x] 5.3 Primeira publicação cria o agente reaproveitando a criação atual (`agent_creation_attempt`, webhooks, `prefferModel`, chatbot só após publicar); teste de integração do cenário "Criação com sucesso" da spec agent-management (~4h)
- [x] 5.4 Limite de treinamentos do plano na prévia e na publicação; teste de `PLAN_TRAINING_LIMIT` com treinamentos gerados (~2h)
- [x] 5.5 Versão fixada e aviso de versão nova (diff do comportamento; republicar sempre na mais recente, pedindo campos novos); testes para "Template atualizado" e "Republicar com campo novo" (~4h)

## 6. Recursos gerenciados e modos

- [x] 6.1 Recusar edição/remoção direta de treinamentos e intenções gerenciados e de campos derivados da função; descrição de intenção do cliente não pode repetir a de uma gerenciada; testes de integração dos cenários das specs agent-training, agent-intentions e agent-management (~4h)
- [x] 6.2 Modo avançado: ligar com aviso, instruções adicionais ≤ 400, site e vídeo liberados só nele, desligar removendo-os na próxima publicação; remover rota e serviço de upload de documento; testes para os cenários de "Modo avançado" e "Site ou vídeo sem modo avançado" (~5h)
- [x] 6.3 Assumir controle: só `is_partner`, edição livre ≤ 3000, sem aviso de versão nova, volta ao formulário descartando a edição; testes para os três cenários da spec (~4h)
- [x] 6.4 Sincronização com o GPT Maker marca a configuração para republicação quando um treinamento gerado some; teste de integração (~2h)

## 7. Frontend do app

- [x] 7.1 Assistente de criação: escolha da função (cards com descrição) e formulário dinâmico renderizado da definição (todos os tipos de campo, dependentes, listas, itens da base, seletor de usuário e de funil/etapa do Bitrix24) com contador de caracteres ao vivo pelo compilador compartilhado; testes de componente para dependentes e contador (~12h)
- [x] 7.2 Tela de prévia/diff (comportamento, treinamentos, intenções, settings), confirmação e acompanhamento da publicação com erro e "tentar de novo"; verificar no navegador uma publicação com falha simulada e repetição (~6h)
- [x] 7.3 Página do agente: editar respostas, aviso de versão nova com diff, ligar/desligar modo avançado com aviso, assumir controle e voltar ao formulário (só parceiros); treinamentos e intenções gerenciados marcados como "da função" e sem ações de edição; remover a opção de documento; verificar no navegador cada modo (~8h)
- [x] 7.4 Remover os campos livres de comportamento e descrição da empresa das telas antigas (`agent-form.tsx`, `agent-fields.tsx`, `create-agent-wizard.tsx`); `npm run lint` e `npm run typecheck` passam (~2h)

## 8. Editor visual de templates e blocos

- [x] 8.1 Contratos: problemas estruturados do template (`where` com seção, campo, opção, intenção e ação) derivando as mensagens atuais, e lista de marcadores válidos por contexto (texto do agente, trecho de opção, textos de intenção); testes unitários dos dois, sem mudar as mensagens já testadas (~5h)
- [x] 8.2 Backend: `copyFrom` na criação de função (copia o rascunho, sem versões), mapa dos campos já publicados na visão do template (o editor trava o id deles) e recusa de id publicado com outro tipo (`FUNCTION_FIELD_LOCKED`; renomear não é detectável no backend, remover campo continua permitido); testes de integração (~3h)
- [x] 8.3 Editor: seção Geral (nome, descrição, tipo, settings derivados, blocos, dados da empresa) e Texto do agente (inserir marcador, destaque de marcador inexistente); verificar no navegador (~6h)
- [x] 8.4 Editor: seção Formulário (todos os tipos, opções com rótulo, trecho e efeitos, dependentes aninhados, subcampos e formato da base, reordenar, id gerado do rótulo); verificar no navegador os cenários "Criar campo de escolha sem JSON" e "Campo dependente" (~12h)
- [x] 8.5 Editor: seção Ações (nome, quando usar, condição, campos coletados ou `collectFrom`, ações por tipo com funil, responsável e prazo vindos dos campos); verificar no navegador uma intenção de tarefa com responsável do formulário (~8h)
- [x] 8.6 Editor: seção JSON sincronizada, checagem ao vivo (pior caso com contribuição por campo e problemas apontando o local) e prévia ao vivo com respostas de exemplo; verificar no navegador os cenários "Problema visto antes de publicar" e "JSON inválido na seção avançada" (~6h)
- [x] 8.7 Editor de blocos (mesmas seções, sem a Geral) e "Nova função a partir de outra" na lista de funções; verificar no navegador (~4h)
- [x] 8.8 Atualizar a skill `gptthink-function-templates` para o editor visual (onde fica cada parte, quando usar o JSON); revisar contra o editor (~1h)

## 9. Portais da função

- [x] 9.1 Migração `agent_function_template_tenant`, filtro por portal em `listPublished`/`latestPublished` (app recebe o portal da sessão), `PUT /admin/functions/:code/tenants` só ADMIN com auditoria `function.tenants`; testes de integração (restrição, portal inexistente, agente existente segue, SUPPORT 403) (~4h)
- [x] 9.2 Backoffice: seção Portais na aba Geral (todos / só os escolhidos, busca de portal), indicador de portais no cabeçalho e no card da lista (~3h)
- [x] 9.3 Verificar no navegador: restringir uma função, conferir que some na criação de agente de outro portal e voltar para todos (~1h)

## 10. Validação integrada

- [ ] 10.1 Em staging: criar um agente de cada função, conversar e verificar comportamento, base, intenções ("Registrar dúvida", qualificação, link de agenda, avaliação) e registros no Bitrix24; registrar os resultados em `docs/staging.md` (~6h)
- [ ] 10.2 Em staging: comparar respostas com `knowledgeByFunction` ligado e desligado em perguntas fora da base; registrar o resultado e, se favorável, publicar nova versão dos templates com o setting ligado (~3h)

## 11. Usuários múltiplos, canal aberto e transferência entre agentes

- [x] 11.1 Contratos: `BITRIX_USER.multiple`, campos `BITRIX_OPENLINE` e `AGENT`, `transfers` no template e no bloco, `TRANSFER_TO_HUMAN` com `target: 'LINE'`/`lineId`, `responsibleId`/`userId` aceitando lista; respostas, checagem (inclusive `transfers`), compilação (`compiled.transfers`, marcador de campo múltiplo vira lista) e pior caso; testes unitários (~6h)
- [x] 11.2 Backend: rodízio na execução (intenção e gatilho, `INCR` por ação), `target: 'LINE'` no handoff (`QUEUE_ID`), `GET /bitrix/openlines`, `onTransfer` sem `HumanHandoff.start` (D18); testes de integração (~5h)
- [x] 11.3 Backend: cliente das regras de transferência do GPT Maker, recurso gerenciado `TRANSFER_RULE` (migração), passo de publicação com tradução e checagem do agente de destino, aviso ao remover agente usado como destino; testes de integração com o fake do GPT Maker (~6h)
- [ ] 11.4 Frontend: seletor de vários usuários, de canal aberto e de agente no formulário do app; editor do backoffice (tipos novos, `multiple`, destino "Canal aberto" e seção de transferências); verificar no navegador (~8h)
- [ ] 11.5 Em staging: rodízio de transferência e de tarefa, transferência para canal aberto (confirmar `QUEUE_ID`) e transferência entre agentes (mesmo chat e bot; `onTransfer` sem atendimento humano); registrar em `docs/staging.md` (~2h)
- [x] 11.6 Skill `gptthink-criar-funcao` em `.claude/skills/` com o formato novo, o validador cobrindo os tipos novos e `transfers`, e o script que gera `blocos.json` e os exemplos do seed; atualizar `gptthink-function-templates` (~3h)
