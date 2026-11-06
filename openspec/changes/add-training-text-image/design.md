# Design

## Context

O GPTMaker aceita `image` (URL) no `POST /v2/agent/{id}/trainings` (TEXT) e no `PUT /v2/training/{id}`; os schemas do app (`createTrainingSchema`, `updateTextTrainingSchema`, `trainingSchema`) já têm o campo. O que falta é do nosso lado: não há upload de imagem (o upload de documento foi removido e `POST /app/agents/:id/trainings` é só JSON), e texto só nasce hoje pela publicação da função (`function-publisher.ts` → `TrainingService.create/updateText` com `managed`), com `trainingHash` sendo apenas o hash do texto. O `ObjectStorage` (Spaces/SeaweedFS, chave aleatória por tenant, URL pré-assinada de até 7 dias) e a cota do plano (`assertWithinLimits`, `maxDocumentStorageMb`) já existem para documentos. Motivação em `proposal.md`; requisitos em `specs/agent-training-image/spec.md`.

## Goals / Non-Goals

**Goals:**

- Imagem opcional em treinamento de texto, manual e gerado pela função, com o mesmo fluxo de criação, edição, reenvio e remoção que o texto já tem.
- Reaproveitar storage, cota, lock por agente e padrões de limpeza existentes.
- Mudar só a imagem de um item republicar só aquele treinamento.

**Non-Goals:**

- Várias imagens por treinamento (o GPTMaker aceita uma).
- Imagem em treinamento de site, vídeo ou documento.
- Editor, recorte ou compressão de imagem; a imagem vai como enviada.
- Imagem em outros recursos da função (intenções, perfil).

## Decisions

**D1. Upload em duas etapas, devolvendo `imageId`.** `POST /app/agents/:agentId/trainings/images` (multipart, campo `file`, `@AppAuth('manage')`) valida, grava no storage e cria uma linha em `training_image` (`id`, `tenantId`, `agentId`, `objectKey`, `fileName`, `mimetype`, `sizeBytes`, `createdAt`). Criar/editar treinamento e os itens da função só citam `imageId`. Isso mantém o JSON de `POST /trainings` e as respostas da função (JSONB) livres de binário e deixa a tela mostrar a miniatura antes de salvar. Alternativa: enviar a imagem junto no `POST` do treinamento (multipart): rejeitada porque os itens da função são salvos no formulário da função, não pelo endpoint de treinamentos, e teriam que reenviar o arquivo a cada publicação.

**D2. Tabela `training_image` e `training.image_id`.** O treinamento aponta para a imagem (`image_id uuid null`, FK). A imagem pode existir sem treinamento (enviada, ainda não salva). Ligar = gravar `image_id` ao criar/editar com sucesso no GPTMaker. Alternativa: reusar as colunas `document_*` do `training`; rejeitada por misturar dois conceitos (a troca de imagem de um TEXT não é um documento) e quebrar a lógica de `DOCUMENT`.

**D3. Validação por conteúdo e limites.** PNG/JPEG/WebP conferidos pelos bytes iniciais (assinatura do arquivo), 5 MB, tipo gravado = o detectado. Multer em memória com `limits.fileSize` de 5 MB (`FileInterceptor` do `@nestjs/platform-express`, `@types/multer` já está no backend). O nome em disco é a chave aleatória de `newTrainingKey`; o nome original só vai em `fileName`.

**D4. `imageId` nos contratos.** `createTrainingSchema` TEXT ganha `imageId: uuid().optional()`; `updateTrainingSchema` vira `{ text?, imageId? }` com `imageId: null` removendo e ausente mantendo (ao menos um dos dois). `TrainingView.image` = `{ id, url, mimetype, sizeBytes } | null`, com `url` pré-assinada de leitura para a miniatura. `KnowledgeItem` ganha `imageId: uuid().optional()`. `CompiledTraining` ganha `imageId?`; `trainingHash` passa a hashear `{ text, imageId }`.

**D5. Efeito do hash na publicação.** Treinamentos publicados antes da mudança têm hash só do texto; com o novo hash, o primeiro plano os mostraria como alterados. Para evitar um "update" em massa sem diferença real, `trainingHash` mantém o hash antigo (`contentHash(text)`) quando não há imagem, e só usa `{ text, imageId }` quando há. Itens sem imagem ficam idênticos ao que já foi publicado.

**D6. Envio ao GPTMaker.** Um único ponto, `imageUrlFor(image)`, devolve a URL pré-assinada (`storage.presignedUrl`, TTL de `STORAGE_PRESIGN_TTL_SECONDS`). `create` manda `image`; `updateText` manda `text` e `image`; `remotePayloadOf` (reenvio) gera URL nova. `matcherFor` continua casando pelo texto. Troca de imagem: GPTMaker é atualizado primeiro; depois o registro local aponta para a nova e a antiga é apagada (storage e linha). Falha no GPTMaker mantém tudo como estava, como no `updateText` de hoje. **Atualização (teste em dev, 2026-11-06):** o GPTMaker guarda a URL como veio e, ao criar, cria o treinamento e responde 500 se não consegue buscar a imagem (a URL pré-assinada rejeita `HEAD`). Por isso `imageUrlFor` devolve uma URL estável da nossa API, `GET|HEAD /public/training-images/<token>` (`training_image.public_token`, aleatório por imagem, `inline`, 404 após apagar), e a criação ambígua (`GPTMAKER_UNAVAILABLE`) remove do GPTMaker o treinamento que ficou lá sem registro local.

**D7. Cota: imagem entra em `documentBytes`.** `usage()` soma `document_size_bytes` dos treinamentos mais `size_bytes` das imagens não removidas (ligadas ou não). `assertWithinLimits` ganha a checagem no upload (recusa com `PLAN_TRAINING_LIMIT`, `kind: 'documentBytes'`). Alternativa: cota própria de imagens; rejeitada por exigir coluna nova em `plan_entitlement` e na tela de planos sem demanda.

**D8. Remoção e limpeza.** `remove` do treinamento, troca e remoção de imagem apagam o objeto e marcam a linha como removida, sem falhar a operação se o storage falhar (log + o mesmo job de limpeza refaz). Novo `@Cron` diário em `training-sync.service.ts` (com `DistributedLock`) apaga imagens sem treinamento criadas há mais de 24 h e as removidas cujo objeto ainda existe. Mesmo padrão do `training-sync` e do `discardObject` do serviço.

**D9. Texto manual liberado, com imagem.** `AddTrainingModal` ganha o tipo "Texto" (campo de texto até 1.028 e imagem opcional); a lista mostra miniatura, marca cada texto como "da função" ou "manual" (`managed`) e permite editar/remover o manual (reusando `PATCH`/`DELETE`). Hoje `FunctionTrainingPolicy.refusal` devolve `TRAINING_FORM_ONLY` para `TEXT` em qualquer agente com função; passa a devolver `null` para `TEXT` (a regra de site/vídeo só no modo avançado não muda) e a recusa `TRAINING_FORM_ONLY` e sua mensagem saem. O limite de treinamentos do plano segue valendo (`assertWithinLimits`). Treinamento `managed` continua só pelo formulário da função (`assertAccess`). Coexistência com a publicação: a publicação só mexe em treinamentos ligados a um recurso gerenciado, e a adoção de órfãos (`orphanTraining`) já filtra `managed = true`, então um manual com o mesmo texto de um item nunca é adotado nem alterado; o plano de publicação não os lista. Alternativa: manter a recusa e só liberar texto manual em modo avançado; rejeitada porque o pedido é justamente complementar a base do formulário.

**D10. Formulário da função.** Cada item da base ganha "Adicionar imagem": envia pelo endpoint de D1 usando o `agentId` do formulário e guarda o `imageId` no item. Itens fora do plano de publicação aparecem com a diferença de imagem no diff do plano.

## Risks / Trade-offs

- [GPTMaker só referenciar a URL, que expira em até 7 dias, e a imagem sumir do agente] → Confirmar em staging (tarefa 1.1); `imageUrlFor` isolado permite trocar para URL estável sem tocar no resto.
- [Não saber como limpar a imagem via `PUT` (omitir, `null` ou `""`)] → Confirmar em staging (tarefa 1.1); fallback: remover e recriar o treinamento (perde o `id` no GPTMaker, mas o app já trata o id remoto por listagem).
- [Imagens órfãs ocupando cota] → Contam na cota por design (D7) e a limpeza de 24 h (D8) as apaga; a UI mostra a imagem logo após o envio para o usuário saber o que está pendente.
- [Cota de treinamentos consumida por textos manuais e a publicação da função falhar por limite] → A publicação já recusa por limite antes de chamar o GPTMaker (`PLAN_TRAINING_LIMIT`); a mensagem de erro e a lista deixam claro quantos são manuais.
- [Hash novo causar republicação em massa] → D5 preserva o hash antigo sem imagem.
- [Upload de arquivo malicioso disfarçado de imagem] → Validação por assinatura, nome aleatório, objeto privado e `Content-Disposition: attachment`; sem processamento no servidor.
- [Troca de imagem falhar entre o GPTMaker e o banco] → Mesma ordem do `updateText` (GPTMaker, depois banco); o job de limpeza recolhe o objeto antigo.

## Migration Plan

1. Migração Drizzle: tabela `training_image` e `training.image_id` nulo; sem backfill.
2. Deploy do backend (endpoint, serviço, limpeza); sem imagem tudo se comporta como hoje.
3. Deploy do front (modal de texto, miniaturas, itens da função).
Rollback: reverter o deploy; a tabela e a coluna ficam inofensivas. Imagens já ligadas continuam no GPTMaker; desligar o recurso só impede novos envios.

## Open Questions

- Limite de 5 MB e formatos PNG/JPEG/WebP são escolhas nossas (o GPTMaker não documenta limites); podem ser ajustados depois de ver o que o GPTMaker aceita, sem mudar a abordagem.
