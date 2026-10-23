# Tasks

> Estimativas em horas de trabalho focado de 1 dev sênior full-stack, incluindo testes.

## 1. Contratos: definição de template e compilador

- [ ] 1.1 Schema zod da definição de template em `packages/contracts` (campos, opções com `label`/`snippet`, dependentes, itens da base, intenções, settings, marcadores); testes unitários aceitando um template válido e recusando marcador inexistente, opção sem trecho e dependente órfão (~4h)
- [ ] 1.2 Schema zod das respostas do formulário (com `itemKey` nos itens da base) e validação contra a versão do template (obrigatórios, limites, dependentes, URLs); testes cobrindo cada regra da spec "Respostas do formulário" (~4h)
- [ ] 1.3 Compilador puro `compileAgent` (marcadores, listas como tópicos, múltipla escolha concatenada, seções omitidas, instruções adicionais só em `ADVANCED`, comportamento assumido em `TAKEN_OVER`, treinamentos ≤ 1028 com prefixo de título, intenções ativadas por escolha, settings derivados, relatório de caracteres por campo); testes de determinismo, de cada tipo de campo e de falha acima de 3000 sem truncar (~8h)
- [ ] 1.4 Cálculo do pior caso de orçamento a partir da definição; testes com um template acima e outro dentro de 3000, verificando o total e a contribuição por campo (~3h)
- [ ] 1.5 Cálculo do plano de publicação (criar/atualizar/remover por chave e hash, diff do comportamento e dos settings); testes para item editado, removido, adicionado e "nada mudou" (~4h)
- [ ] 1.6 Ajustar `createAgentSchema`/`updateAgentSchema` (função + formulário; sem `behavior`/`type`/`jobDescription` livres; settings só operacionais) e remover `DOCUMENT` de `createTrainingSchema`; `npm run typecheck` passa em todos os workspaces (~2h)

## 2. Dados e migração

- [ ] 2.1 Schema Drizzle + migração: `agent_function_template`, `agent_function_template_version`, `agent_function_block`, `agent_function_config`, `agent_managed_resource`, `tenant.is_partner`, `training.managed`, `agent_intention.managed`; migração aplica e reverte em banco limpo nos testes de integração (~4h)
- [ ] 2.2 Script de descarte dos agentes de teste (remove no GPT Maker e marca `DELETED` localmente, idempotente); teste de integração com GPT Maker simulado e roteiro em `docs/staging.md` (~3h)

## 3. Backoffice: blocos e templates

- [ ] 3.1 Serviço e rotas de blocos (rascunho, publicar) com auditoria; testes de integração de acesso restrito ao backoffice (~3h)
- [ ] 3.2 Serviço e rotas de templates: editar rascunho, publicar versão (expandindo blocos, validando marcadores e orçamento), listar versões com contagem de agentes, comparar e restaurar como nova versão; testes de integração para "Publicar nova versão", "Rollback", "Pior caso acima do limite" e "Marcador de campo inexistente" (~8h)
- [ ] 3.3 Agente de sandbox: criação sob demanda com nome reservado, registro na configuração do workspace e publicação da prévia pelo executor de publicação (grupo 5); teste de integração verificando que nenhum tenant é afetado (~4h)
- [ ] 3.4 Marcar/desmarcar tenant parceiro na gestão de tenants, com auditoria; teste de integração dos dois cenários da spec "Tenant parceiro" (~2h)
- [ ] 3.5 Telas `/admin/functions`: lista de templates, editor do rascunho (JSON com validação ao vivo e prévia com respostas de exemplo), versões com contagem de agentes, diff entre versões, restaurar e testar no sandbox; telas `/admin/functions/blocks`; verificar no navegador o fluxo editar → prévia → sandbox → publicar (~12h)

## 4. Seed das quatro funções

- [ ] 4.1 Blocos compartilhados no seed: bloco comum, "onde registrar", "abrir chamado / registrar dúvida", "transferir para atendente"; o seed passa no schema do item 1.1 (~3h)
- [ ] 4.2 Templates SDR e Suporte no seed, conforme o documento de produto (campos, trechos, intenções, settings); teste de que o pior caso de cada um fica ≤ 3000 (~6h)
- [ ] 4.3 Templates Agendamento e Pós-venda no seed (links no comportamento, intenções de avaliação com corte fixo); teste de pior caso ≤ 3000 (~6h)
- [ ] 4.4 Aplicação do seed como versão 1, uma única vez (não sobrescreve versões publicadas pelo backoffice); teste de integração rodando o seed duas vezes (~2h)
- [ ] 4.5 Skill de escrita de templates em `.claude/skills/` (estrutura, orçamento, padrões de escrita do comportamento, checklist antes de publicar); revisar a skill contra os quatro templates do seed (~3h)

## 5. Publicação do agente

- [ ] 5.1 Serviço de configuração do agente: escolher função na criação, salvar rascunho das respostas, prévia (compila + plano) e recusa de troca de função; testes de integração para "Salvar rascunho", "Resposta inválida" e "Troca de função" (~5h)
- [ ] 5.2 Executor de publicação no worker (fila RabbitMQ): ordem de D5, progresso em `agent_managed_resource`, associação de ids de treinamentos por texto e de intenções por descrição, estados `PENDING`/`FAILED`, repetição aplicando só o que falta; testes de integração para "Publicar", "Falha parcial" sem duplicar e "Nada mudou" (~10h)
- [ ] 5.3 Primeira publicação cria o agente reaproveitando a criação atual (`agent_creation_attempt`, webhooks, `prefferModel`, chatbot só após publicar); teste de integração do cenário "Criação com sucesso" da spec agent-management (~4h)
- [ ] 5.4 Limite de treinamentos do plano na prévia e na publicação; teste de `PLAN_TRAINING_LIMIT` com treinamentos gerados (~2h)
- [ ] 5.5 Versão fixada e aviso de versão nova (diff do comportamento; republicar sempre na mais recente, pedindo campos novos); testes para "Template atualizado" e "Republicar com campo novo" (~4h)

## 6. Recursos gerenciados e modos

- [ ] 6.1 Recusar edição/remoção direta de treinamentos e intenções gerenciados e de campos derivados da função; descrição de intenção do cliente não pode repetir a de uma gerenciada; testes de integração dos cenários das specs agent-training, agent-intentions e agent-management (~4h)
- [ ] 6.2 Modo avançado: ligar com aviso, instruções adicionais ≤ 400, site e vídeo liberados só nele, desligar removendo-os na próxima publicação; remover rota e serviço de upload de documento; testes para os cenários de "Modo avançado" e "Site ou vídeo sem modo avançado" (~5h)
- [ ] 6.3 Assumir controle: só `is_partner`, edição livre ≤ 3000, sem aviso de versão nova, volta ao formulário descartando a edição; testes para os três cenários da spec (~4h)
- [ ] 6.4 Sincronização com o GPT Maker marca a configuração para republicação quando um treinamento gerado some; teste de integração (~2h)

## 7. Frontend do app

- [ ] 7.1 Assistente de criação: escolha da função (cards com descrição) e formulário dinâmico renderizado da definição (todos os tipos de campo, dependentes, listas, itens da base, seletor de usuário e de funil/etapa do Bitrix24) com contador de caracteres ao vivo pelo compilador compartilhado; testes de componente para dependentes e contador (~12h)
- [ ] 7.2 Tela de prévia/diff (comportamento, treinamentos, intenções, settings), confirmação e acompanhamento da publicação com erro e "tentar de novo"; verificar no navegador uma publicação com falha simulada e repetição (~6h)
- [ ] 7.3 Página do agente: editar respostas, aviso de versão nova com diff, ligar/desligar modo avançado com aviso, assumir controle e voltar ao formulário (só parceiros); treinamentos e intenções gerenciados marcados como "da função" e sem ações de edição; remover a opção de documento; verificar no navegador cada modo (~8h)
- [ ] 7.4 Remover os campos livres de comportamento e descrição da empresa das telas antigas (`agent-form.tsx`, `agent-fields.tsx`, `create-agent-wizard.tsx`); `npm run lint` e `npm run typecheck` passam (~2h)

## 8. Validação integrada

- [ ] 8.1 Em staging: criar um agente de cada função, conversar e verificar comportamento, base, intenções ("Registrar dúvida", qualificação, link de agenda, avaliação) e registros no Bitrix24; registrar os resultados em `docs/staging.md` (~6h)
- [ ] 8.2 Em staging: comparar respostas com `knowledgeByFunction` ligado e desligado em perguntas fora da base; registrar o resultado e, se favorável, publicar nova versão dos templates com o setting ligado (~3h)
