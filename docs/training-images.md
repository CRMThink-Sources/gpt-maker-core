# Imagem em treinamento de texto

O treinamento de texto do agente pode levar uma imagem (campo `image` do GPTMaker). O agente usa a imagem junto com o texto ao responder.

## Onde anexar

- **Itens da base de conhecimento** (aba **Função**): cada item tem "Adicionar imagem". Ao publicar, o treinamento gerado para o item leva a imagem. Mudar só a imagem republica só aquele treinamento; remover a imagem do item a tira do treinamento.
- **Texto manual** (aba **Treinamentos → Adicionar treinamento → Texto**): texto de até 1.028 caracteres com imagem opcional. Vale também para agentes que já têm função: o cliente monta a base pelo formulário e depois acrescenta textos manuais. O texto manual pode ser editado (texto e imagem) e removido; os textos "da função" só mudam pelo formulário.

## Limites

- PNG, JPEG ou WebP, até **5 MB**. O tipo é conferido pelo conteúdo do arquivo, não pelo nome.
- O tamanho das imagens entra na **cota de armazenamento do plano**, junto com os documentos (`maxDocumentStorageMb`). Envio que ultrapassa a cota é recusado com `PLAN_TRAINING_LIMIT`.
- Textos manuais contam no limite de treinamentos do plano.

## Como funciona

1. `POST /app/agents/:agentId/trainings/images` (`multipart/form-data`, campo `file`, permissão de gerenciar) guarda o arquivo no storage privado e devolve `{ id, url, mimetype, sizeBytes, fileName }`. `id` é o `imageId`.
2. `POST /app/agents/:agentId/trainings` (`{ type: 'TEXT', text, imageId? }`) e `PATCH .../trainings/:id` (`{ text?, imageId? }`; `imageId: null` remove, ausente mantém) ligam a imagem ao treinamento. Nos itens da função, o `imageId` fica no item da base.
3. O GPTMaker recebe a imagem como **URL estável da nossa API** (`image` = `<API_PUBLIC_URL>/public/training-images/<token>`). O token é aleatório por imagem; a rota aceita `GET` e `HEAD`, serve a imagem `inline` e para de responder (404) quando a imagem é apagada. O arquivo continua privado no storage; só a API o lê.

## Armazenamento

Os arquivos ficam num bucket S3 privado (DigitalOcean Spaces em staging e produção; SeaweedFS em dev), lido só pela API. Staging e produção dividem o mesmo bucket e se separam pelo prefixo `STORAGE_KEY_PREFIX` (`staging/` e `production/`) e por chaves de acesso distintas. Variáveis em `infra/.env.prod.example`.

## Remoção e limpeza

- Remover o treinamento, trocar a imagem ou removê-la apaga o arquivo do storage. Falha ao apagar não falha a operação: fica no log e a limpeza repete.
- Uma limpeza diária (`training-image-cleanup`, 04:15) apaga imagens enviadas e **não ligadas a nenhum treinamento há mais de 24 h**, exceto as citadas pelas respostas do formulário da função (publicadas ou rascunho).

## Comportamento do GPTMaker (observado em dev, 2026-11-06)

- Ele **guarda a URL como veio** (`image` volta igual na listagem), não copia o arquivo. Por isso a URL tem de ser estável: a pré-assinada do storage expira (até 7 dias) e a imagem sumiria do agente.
- Ao criar com `image`, ele **cria o treinamento e depois responde `500 "Fail on train assistant."`** se não consegue buscar a imagem. Com URL pré-assinada S3 (que rejeita `HEAD`: 403) e com `localhost` isso aconteceu; com uma URL pública que aceita `GET`/`HEAD` criou normalmente. Como o treinamento fica criado mesmo com o 500, o app desfaz a criação ambígua (`GPTMAKER_UNAVAILABLE`): remove do GPTMaker o treinamento sem registro local que casa com o conteúdo.
- Em dev a API precisa estar num endereço público (`API_PUBLIC_URL`, túnel), senão o GPTMaker não alcança a imagem.

## Ainda a confirmar (staging)

- Como **remover** a imagem no `PUT /v2/training/{id}`. Hoje o app envia `image: null`; se o GPTMaker exigir omitir o campo ou mandar `""`, ajustar `updateTextTrainingSchema` e `TrainingService.updateText`.
- Quais formatos e tamanhos ele recusa.
