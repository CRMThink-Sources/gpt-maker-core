# Design

## Context

Treinamentos vivem em `backend/src/modules/training/`. `TrainingService.create` já valida (`createTrainingSchema`), aplica a política de mídia da função, cria o registro local `PROCESSING` e o treinamento no GPTMaker sob `withAgentLock`, e confere o limite do plano (`assertWithinLimits`, erro `PLAN_TRAINING_LIMIT`). Não existe spec viva `agent-training`; o comportamento está no código e em `agent-training-image`. Motivação em `proposal.md - Why`; requisitos em `specs/agent-training-transfer/spec.md`.

## Goals / Non-Goals

**Goals:**
- Exportar e importar sem duplicar regra de negócio: a importação é um laço sobre `TrainingService.create`.
- Formato de arquivo versionado, portátil entre agentes e tenants, sem nenhum dado interno.
- Importação parcial com relatório por item, sem estado intermediário inconsistente.

**Non-Goals:**
- Exportar documentos ou treinamentos `managed` (gerados pela função), ou embutir o binário das imagens no arquivo (só o link vai).
- Detectar duplicados, mesclar ou substituir treinamentos existentes.
- Importação assíncrona por fila, progresso em tempo real ou arquivos com mais de 100 itens.
- Migration, nova tabela ou novo evento.

## Decisions

**D1. Formato JSON versionado, sem identificadores.** O arquivo é `{ version: 1, exportedAt, trainings: [...] }`, onde cada item é o `createTrainingSchema` com `imageUrl` no lugar de `imageId` (`{type:'TEXT',text,imageUrl?}`, `{type:'WEBSITE',url,trainingSubPages,trainingInterval}`, `{type:'VIDEO',url}`). `imageUrl` é a URL pública estável da imagem (`TrainingImageService.imageUrlFor`); o `imageId` interno nunca sai. Assim a importação reutiliza o schema existente e qualquer evolução da criação vale nos dois lados. Alternativas: CSV (ruim para texto multilinha e campos opcionais) e exportar a linha crua do banco (vaza `id`, `gptmakerTrainingId`, `callbackTokenHash`, e não é portável). O `version` literal permite recusar formatos futuros em vez de interpretá-los errado. O schema do arquivo fica em `packages/contracts/src/trainings.ts` (`trainingExportSchema`, `trainingImportRequestSchema`) para backend e frontend; o resultado da importação é só tipo TypeScript (`TrainingImportResult`), por ser saída da API.

**D2. Exportação filtra no banco, só `managed = false`, tipos `TEXT|WEBSITE|VIDEO`, `deletedAt is null`.** Reaproveita a consulta de `list` por `tenantId` + `agentId` do dono resolvido por `agents.getById` (404 entre tenants, como o resto do módulo). Não inclui `status`: um treinamento `FAILED` também é exportado, pois o conteúdo está correto e pode ser reimportado. `GET .../trainings/export` responde `application/json` com `Content-Disposition: attachment` e nome `treinamentos-<slug-do-agente>-<data>.json`; o download é feito no cliente a partir do `Blob` da resposta da API (a chamada passa pelo cliente autenticado do iframe, que um `<a href>` simples não consegue usar).

**D3. Importação síncrona, item a item, em `TrainingTransferService.import`.** Fluxo: (1) valida o envelope com zod (`version`, `trainings` com no máximo 100 itens `unknown`); falha aqui recusa tudo (`400`/`422`); (2) para cada item, `createTrainingSchema.safeParse`; inválido vira resultado `REJECTED` com o motivo, sem chamar nada; (3) válidos são criados em ordem chamando `TrainingService.create`, capturando `DomainError`/`GptmakerError` por item. `create` já faz limite, política de mídia, GPTMaker e rollback local do registro quando o GPTMaker recusa, então o serviço novo não reimplementa nada. Resultado por item: `CREATED` (com `id`), `REJECTED` (inválido, limite, mídia) ou `FAILED` (erro do GPTMaker). Alternativa: transação tudo-ou-nada. Descartada: o GPTMaker não participa de transação, então desfazer os já criados exigiria chamadas de remoção que podem falhar; o relatório parcial é mais simples e honesto.

**D4. Limite do plano e concorrência herdados do lock do agente.** `create` confere `assertWithinLimits` dentro de `withAgentLock`, então cada item respeita o limite no momento em que é criado e importações simultâneas do mesmo agente se serializam. Para o spec "primeiros até o limite": quando um item volta `PLAN_TRAINING_LIMIT`, o laço marca esse e os seguintes como `REJECTED` por limite sem chamar mais o `create` (o limite não volta a sobrar no meio da importação). Dois agentes do mesmo tenant importando juntos podem passar um item do limite; é o risco já documentado em `assertWithinLimits` e fica igual. Para cumprir "MUST NOT ultrapassar", o design adota um lock por tenant em volta da importação inteira (`DistributedLock`, chave `training-import:<tenantId>`), que fecha a janela entre agentes do mesmo tenant para importações; criação manual simultânea continua sujeita ao risco existente e fica como limitação conhecida.

**D4b. Parada e limite.** Só o `PLAN_TRAINING_LIMIT` com `details.kind === 'trainings'` (quantidade) encerra a importação; o de armazenamento (`documentBytes`) é do item. Depois de 3 `GPTMAKER_UNAVAILABLE` seguidos os demais itens válidos viram falhos sem chamar o GPTMaker (cada chamada esperaria o timeout e o lock de 15 min poderia expirar no meio); uma criação bem-sucedida zera a contagem.

**D5. Segurança de entrada.** Item com campos extras (`managed`, `imageId`, `documentKey`, `id`; `imageUrl` é o único campo de imagem aceito, só em `TEXT`) é validado com o schema por tipo em modo estrito para a importação: chave desconhecida é motivo de recusa do item, para o arquivo nunca criar treinamento `managed`, de documento ou ligar imagem de outro tenant. O corpo tem limite de tamanho (100 itens × 1.028 caracteres + URLs ≈ poucas centenas de KB; limite do body parser de 1 MB nessa rota) e o texto é tratado como dado: nada do arquivo é interpolado em log; logs registram só `tenantId`, `agentId` e contagens (contexto via `enrichContext`).

**D5b. Cópia da imagem por URL, sem requisição de rede.** `TrainingImageService.readFromPublicUrl(url)` + `TrainingService.uploadImage` (a cópia reaproveita o envio normal): (1) faz `new URL`, exige `origin` igual ao de `API_PUBLIC_URL` e caminho `/public/training-images/<token>` (qualquer outra coisa → aviso `IMAGE_URL_NOT_SUPPORTED`, sem acessar nada); (2) com o token, usa `readPublic` (banco + storage), então não há `fetch` e o SSRF fica impossível por construção; imagem inexistente → `IMAGE_NOT_FOUND`; (3) lê o corpo para memória (máx. 5 MB); `uploadImage` reconfere o tipo pelo conteúdo e a cota (as mesmas regras do envio) e grava para o agente de destino, gerando novo `id`, `objectKey` e `publicToken`. O `imageId` novo vai para `TrainingService.create` (`usableImage` já valida dono). Falha em qualquer passo → o texto é criado sem imagem e o item do resultado ganha `warnings: [{code, message}]` (`IMAGE_NOT_FOUND`, `IMAGE_URL_NOT_SUPPORTED`, `IMAGE_INVALID`, `IMAGE_QUOTA`). Alternativas: baixar por HTTP (abre SSRF e depende de rede entre ambientes) e reaproveitar a mesma imagem no destino (apagar o treinamento de origem apagaria o arquivo, via `discard`). A cópia ocorre dentro do lock do agente/tenant, antes de `create`; se `create` falhar depois, a imagem copiada é descartada com `discard` (senão fica órfã até a limpeza de 24 h). O token público da origem é uma "senha" que passa a estar no arquivo: aceito porque a imagem já é pública por token, e o aviso na tela e a spec deixam isso explícito.

**D6. Permissões.** Exportar: `@AppAuth()` (consulta basta, como `list`). Importar: `@AppAuth('manage')`, igual a `create`. Agente `OUT_OF_SYNC` segue a regra de `trainableAgent` já usada em `create`.

**D7. Frontend.** Na página Treinamentos (`trainings/page.tsx`), dois botões ao lado de "Adicionar": **Exportar** (visível a todos; desativado sem itens manuais) e **Importar** (só `canManage`). Importar abre um modal com seletor de arquivo (`.json`), aviso de que soma aos existentes e de que imagens não vão no arquivo, e após o envio mostra o resumo e a lista de itens não criados. O arquivo é lido no cliente (`File.text()` + `JSON.parse`) e enviado como JSON a `POST .../import`; arquivo que não é JSON é recusado no cliente com a mensagem, sem chamar a API. Depois do resultado, `reload()` e o polling existente acompanham o status `PROCESSING`. Textos no namespace i18n `trainings` (pt/en/es conforme `app-i18n`). Lógica de montagem do nome do arquivo e de leitura/validação do envelope vai em `lib/trainings.ts`, testada sem renderizar.

## Risks / Trade-offs

- [Importação longa: 100 itens × chamada ao GPTMaker pode passar do timeout HTTP] → limite de 100 itens e relatório parcial; se o cliente cair no meio, os criados permanecem e o reenvio duplicaria; mitigado pelo aviso de que a importação não detecta duplicados e pela lista que mostra o que foi criado. Se a medição no staging mostrar timeout, mover para fila é a evolução natural (fora deste escopo).
- [Duplicados ao reimportar] → decisão consciente (Non-Goal); o aviso no modal e o spec deixam explícito.
- [Imagem some se a original for apagada, ou o arquivo vai a outro ambiente] → o texto é importado sem a imagem e o resultado avisa por item; embutir o binário no arquivo (base64) é a evolução se isso incomodar.
- [Link da imagem no arquivo dá acesso a ela] → já é pública por token; aviso na exportação e perda do acesso ao apagar a imagem.
- [Lock por tenant segura outras importações do mesmo tenant] → espera limitada (`LOCK_WAIT_MS`); estourar vira erro claro de "importação em andamento".
- [Formato congelado em `version: 1`] → mudança incompatível futura sobe a versão; versões desconhecidas são recusadas.

## Migration Plan

Sem migration e sem mudança de dados: deploy normal (`develop` → staging, depois release). Rollback é reverter o deploy; treinamentos já importados são treinamentos manuais comuns e permanecem. Não há flag.
