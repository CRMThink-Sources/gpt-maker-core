# Proposal

## Why

Hoje o cliente só cria treinamentos um a um na aba Treinamentos do agente. Quem tem vários agentes parecidos (ou quer migrar a base de um agente de teste para o de produção, fazer backup ou revisar o conteúdo fora do app) precisa recriar cada texto, site e vídeo na mão. Exportar e importar os treinamentos resolve a duplicação de trabalho e dá ao cliente uma cópia portátil do que o agente sabe.

## What Changes

- Novo botão **Exportar** na aba Treinamentos: baixa um arquivo JSON versionado com os treinamentos **manuais** do agente (texto, site e vídeo).
- Novo botão **Importar** na aba Treinamentos: o cliente envia um arquivo exportado e o sistema cria os treinamentos no agente atual, informando o resultado item a item (criados, ignorados, recusados).
- A importação passa pelo mesmo caminho da criação manual (`TrainingService.create`): respeita o limite de treinamentos do plano, a política de mídia da função (site e vídeo só no modo avançado) e o envio ao GPTMaker.
- Novos endpoints no controller de treinamentos: `GET app/agents/:agentId/trainings/export` e `POST app/agents/:agentId/trainings/import`.
- Novos schemas em `@gptmaker/contracts` para o arquivo de exportação e para o resultado da importação.
- Textos com imagem: o arquivo leva a URL pública da imagem; na importação o backend resolve essa URL internamente (só as do próprio `API_PUBLIC_URL`) e **copia** a imagem para o agente de destino, respeitando tipo, 5 MB e a cota do plano. Se a imagem não puder ser copiada (apagada, de outro ambiente, sem cota), o texto é importado sem ela e o resultado avisa.
- **Fora do escopo**: treinamentos gerados pela função (`managed`) e de tipo `DOCUMENT` não são exportados; imagens não são embutidas no arquivo (só o link). Sem migration de banco.

## Capabilities

### New Capabilities

- `agent-training-transfer`: exportar os treinamentos manuais de um agente para um arquivo e importar um arquivo exportado em outro (ou no mesmo) agente do tenant, com validação, limites do plano e relatório por item.

### Modified Capabilities

<!-- Nenhuma: o comportamento de criar, editar e remover treinamento não muda. Não existe spec viva `agent-training`; a importação reutiliza a criação sem alterar seus requisitos. -->

## Impact

- Backend: `backend/src/modules/training/` (novo `training-transfer.service.ts`, método de cópia de imagem por URL em `training-image.service.ts`, rotas em `trainings.controller.ts`, testes unitários e de integração do fluxo).
- Contratos: `packages/contracts/src/trainings.ts` (schemas de arquivo e resultado) e re-export no `index.ts`.
- Frontend: `frontend/src/app/app/agents/[id]/trainings/page.tsx` (botões e modal de resultado), `frontend/src/lib/trainings.ts`, textos i18n do namespace `trainings`, testes do componente.
- Sem mudança de schema, filas, billing (treinamento não debita créditos) nem integração nova com GPTMaker além das chamadas de criação já existentes.
