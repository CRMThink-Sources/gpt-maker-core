# Proposal

## Why

O GPTMaker permite anexar uma imagem a um treinamento de texto (campo `image`, URL, na criação e na edição), e o agente passa a usá-la ao responder. Nossa aplicação não expõe isso: o texto do treinamento só carrega texto. Clientes querem que o agente mostre ou considere uma imagem (cardápio, tabela de preços, planta, foto de produto) junto com a explicação em texto.

## What Changes

- Novo **upload de imagem** por agente (PNG, JPEG ou WebP, até 5 MB), guardado no storage já usado pelo app; devolve um `imageId` que depois é ligado a um treinamento.
- **Treinamento de texto manual é liberado** na tela de Treinamentos (Adicionar → Texto), com imagem opcional, **mesmo em agentes que têm função**: o cliente monta a base pelo formulário da função e depois acrescenta textos manuais. Hoje o app recusa texto manual nesses agentes (`TRAINING_FORM_ONLY`); essa recusa sai. Texto manual pode ser editado e removido; os gerados pela função continuam só pelo formulário.
- A lista de treinamentos distingue os textos "da função" dos "manuais".
- **Itens da base de conhecimento da função** ganham imagem opcional no formulário; ao publicar, o treinamento gerado leva a imagem. Mudar só a imagem de um item republica aquele treinamento.
- O GPTMaker recebe a imagem como URL pré-assinada (`image`), na criação e na edição; o reenvio de um treinamento com falha gera uma URL nova.
- Remover o treinamento (ou a imagem) apaga o arquivo do storage; imagens enviadas e nunca ligadas a um treinamento são limpas depois de 24 h.
- O tamanho das imagens entra na cota de armazenamento do plano, junto com a dos documentos.
- Novas colunas e tabela de imagens (migração Drizzle). Sem mudança de comportamento para treinamentos existentes.

## Capabilities

### New Capabilities

- `agent-training-image`: upload, limites, ligação de uma imagem a treinamentos de texto (manuais e gerados pela função), envio ao GPTMaker, troca, remoção e limpeza.

### Modified Capabilities

<!-- Nenhuma: não há spec principal de treinamentos em openspec/specs. -->

## Impact

- Backend: `modules/agent-functions/function-training-policy.ts` (para de recusar `TEXT`), `modules/training` (upload, `create`/`updateText`/`remove`/`retry`, `remotePayloadOf`, uso da cota), `modules/gptmaker` (`image` já aceito nos schemas), `modules/agent-functions/function-publisher.ts` (imagem no plano e na publicação), `shared/storage/object-storage.ts` (chave de imagem), `shared/database/schema/agents.ts` + migração, rotina de limpeza.
- Contratos: `trainings.ts` (`imageId`, `TrainingView.image`), `agent-function-answers.ts` (`KnowledgeItem.imageId`), `agent-function-compiler.ts` e `agent-function-plan.ts` (hash do treinamento inclui a imagem).
- Frontend: modal de adicionar treinamento, lista de treinamentos, formulário da função (itens da base).
- Dependência externa: comportamento do GPTMaker com a URL da imagem (validade, remoção, formatos); confirmado em staging na primeira tarefa.
