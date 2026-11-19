# Proposal

## Why

Para a aprovação no marketplace do Bitrix24, o app precisa estar inteiramente traduzido (`pt-BR`, `en`, `es`). O portal já está traduzido (spec `app-i18n`), mas o formulário das funções do agente não: nome, descrição, rótulos, ajudas e opções vêm do template gravado no banco, só em português, e aparecem assim na criação e na edição do agente, mesmo com a interface em inglês ou espanhol.

## What Changes

- O conteúdo do template (e dos blocos compartilhados) passa a aceitar **traduções por idioma** (`en`, `es`) dos textos que o cliente lê: nome e descrição da função, rótulo, ajuda e placeholder dos campos, rótulo das opções, subcampos da base de conhecimento, valores de SPA e perguntas do assistente de IA. O português continua sendo o texto-base.
- A API do app devolve o formulário **no idioma ativo da interface**, com volta ao português quando falta tradução de um texto. O app envia o idioma ativo em cada chamada.
- O backoffice ganha uma aba **Traduções** no editor de função e de bloco: o texto em português ao lado do campo de cada idioma, com indicação do que falta. Faltar tradução **não** bloqueia a publicação, só avisa.
- As quatro funções do seed (SDR, Suporte, Agendamento, Pós-venda) e os blocos compartilhados são entregues com tradução para `en` e `es`.
- As skills `gptthink-function-templates` e `gptthink-criar-funcao`, o validador `validar.mjs`, os exemplos de referência e o agente `autor-funcao-agente` passam a produzir e conferir funções já com traduções, para que funções novas não voltem a nascer só em português.
- Fora de escopo: o texto que vai para o GPTMaker (comportamento compilado, trechos das opções, treinamentos e intenções) continua em português; o idioma de fala do agente é uma decisão de produto à parte.

## Capabilities

### New Capabilities
- `function-template-i18n`: traduções do formulário das funções do agente (modelo, resolução por idioma, edição no backoffice e conteúdo do seed).

### Modified Capabilities
<!-- Nenhum: a spec `agent-function-templates` ainda é uma change em andamento (não está em openspec/specs). Esta change a estende sem alterar requisitos já arquivados. -->

## Impact

- `packages/contracts`: schemas do template e dos blocos (campo `translations`), função de resolução por idioma, expansão e colapso de blocos, validação das traduções.
- Backend: `agent-functions` (rotas `/app/agent-functions`, `/app/agents/:id/function`), `function-catalog.service`, seed das funções; leitura do idioma pelo cabeçalho da requisição.
- Frontend: cliente de API do `/app` (cabeçalho de idioma e recarga ao trocar de idioma), editor do `/admin/functions`.
- `.claude/skills/gptthink-*` (SKILL.md, `scripts/validar.mjs`, `referencia/`, `exemplos/`) e `.claude/agents/autor-funcao-agente.md`.
- Sem migration: as traduções vão no JSON `draft`/`content` já existente.
