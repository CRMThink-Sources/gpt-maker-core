# Tasks

## 1. Confirmar o comportamento do GPTMaker

- [ ] 1.1 Em staging, com um agente de teste, criar e editar um treinamento TEXT com `image` por URL pré-assinada e registrar em `docs/gptmaker-api.md` (§4.2/§4.3): se o GPTMaker copia o arquivo ou guarda a URL (esperar a URL expirar ou usar TTL curto), como remover a imagem no `PUT` (omitir, `null` ou `""`) e quais formatos recusa; verificar que as três respostas estão documentadas e, se a URL for apenas referenciada, ajustar a decisão D6 do design antes de seguir
  - **Arquivada com a 1.1 parcial (2026-11-06):** confirmado em dev que o GPTMaker guarda a URL como veio, que cria o treinamento e responde 500 se não alcança a imagem e que a URL pré-assinada falha (`HEAD` 403). Por isso a URL passou a ser estável, da API. **Não testado:** trocar a imagem, removê-la (`PUT` com `image: null`) e os formatos/tamanhos que o GPTMaker recusa.

## 2. Contratos e banco

- [x] 2.1 Em `packages/contracts`: `imageId` no TEXT de `createTrainingSchema`, `updateTrainingSchema` com `{ text?, imageId? }` (`null` remove, ao menos um campo), `TrainingView.image`, `KnowledgeItem.imageId` e `CompiledTraining.imageId`; verificar com testes de schema (criar com/sem imagem, `null` remove, ausente mantém, UUID inválido recusado)
- [x] 2.2 `trainingHash` com `{ text, imageId }` só quando há imagem e o hash antigo sem imagem, e `compileAgent` levando o `imageId` do item; verificar com testes de que um item sem imagem mantém exatamente o hash anterior e de que trocar só a imagem muda o hash e aparece no plano
- [x] 2.3 Criar a tabela `training_image` e `training.image_id` em `shared/database/schema/agents.ts` e gerar a migração em `backend/drizzle`; verificar que aplica em banco limpo e sobre dados existentes (treinamentos antigos ficam com `image_id` nulo) pela suíte de integração

## 3. Upload e armazenamento

- [x] 3.1 Implementar o upload `POST /app/agents/:agentId/trainings/images` (multipart, `manage`, 5 MB, PNG/JPEG/WebP por assinatura do arquivo, chave aleatória no `ObjectStorage`, linha em `training_image`); verificar com testes de integração: válido, tipo falso (`.png` com outro conteúdo), grande demais, agente de outro tenant e perfil somente consulta
- [x] 3.2 Contar o tamanho das imagens em `usage()` e recusar o envio que ultrapassa a cota (`PLAN_TRAINING_LIMIT`, `kind: 'documentBytes'`); verificar com testes de integração de cota estourada, plano sem limite e liberação de espaço ao remover o treinamento

## 4. Treinamento de texto com imagem

- [x] 4.1 Tornar `imageUrlFor` o ponto único da URL enviada e usar `image` em `create`, `updateText` e `remotePayloadOf` (reenvio com URL nova), checando que a imagem é do mesmo agente e tenant (404 `TRAINING_IMAGE_NOT_FOUND` caso contrário); verificar com testes de integração contra o stub do GPTMaker: criar com imagem, editar só a imagem, remover a imagem, reenviar após falha e imagem de outro agente
- [x] 4.2 Apagar a imagem do storage e a linha ao trocar, remover a imagem ou remover o treinamento, sem falhar a operação se o storage falhar, e adicionar o `@Cron` diário de limpeza (sem treinamento há mais de 24 h, e removidas com objeto restante) com `DistributedLock`; verificar com testes de integração de cada caso e de que falha do GPTMaker mantém treinamento e arquivo como estavam
- [x] 4.3 Passar `imageId` do plano de publicação ao `create`/`updateText` em `function-publisher.ts`, inclusive remover a imagem de um item e remover um item com imagem; verificar com testes de integração da publicação: item com imagem, só a imagem mudou, imagem removida e item removido

- [x] 4.4 Liberar `TEXT` manual em agentes com função: `FunctionTrainingPolicy.refusal` devolve `null` para `TEXT`, removendo `TRAINING_FORM_ONLY` e sua mensagem; verificar com testes de integração: criar texto manual em agente com função, editar e remover o manual, recusa ao editar/remover um da função, limite do plano, e republicar a função com um manual de texto igual a um item sem adotá-lo, alterá-lo ou removê-lo

## 5. Telas

- [x] 5.1 Modal "Adicionar treinamento" com o tipo Texto (até 1.028 caracteres) e imagem opcional (envio, miniatura, remover), e lista de treinamentos com miniatura, selo "da função"/"manual" e edição/remoção só do manual, com troca/remoção da imagem; verificar com testes de componente (criar com imagem, trocar, remover, erro de formato e de tamanho, ações ocultas no texto da função)
- [x] 5.2 Anexar imagem a cada item da base no formulário da função (envio pelo endpoint da tarefa 3.1, miniatura, remover) e mostrar a diferença de imagem no plano de publicação; verificar com testes de componente do `function-form` e do diff do plano

## 6. Documentação e integração

- [x] 6.1 Documentar o recurso (limites, cota, onde anexar a imagem, o que acontece ao remover) em `docs/training-images.md` e verificar que o texto bate com a spec
- [x] 6.2 Rodar `npm run typecheck`, a suíte unitária e a de integração do backend, os testes de contratos e do frontend, e verificar que passam; testar em staging: texto manual com imagem, item da função com imagem, troca, remoção e reenvio, conferindo no GPTMaker que o agente usa a imagem
