# Proposal

## Why

O cliente tem dúvidas sobre configurar e criar o agente. Uma skill baixada no próprio app permite que ele pergunte no Claude dele, com conteúdo que acompanha as funções publicadas no backoffice.

Desenho aprovado: `docs/superpowers/specs/2026-11-25-skill-ajuda-cliente-design.md`.

## What Changes

- Rota pública que entrega o conteúdo de ajuda em Markdown: guia escrito mais as funções publicadas e as perguntas dos formulários.
- Rota pública que entrega a skill em `.zip` (`SKILL.md` e uma cópia reserva do conteúdo, com a data).
- A skill busca o conteúdo atual e usa a cópia quando não consegue. Ela só tira dúvidas: não acessa a conta nem altera nada.
- Cartão na página Ajuda (`/app/help`) para baixar a skill, com instruções de instalação e de liberação do acesso, em `pt-BR`, `en` e `es`.

## Capabilities

### New Capabilities
- `customer-help-skill`: conteúdo público de ajuda, pacote da skill, comportamento da skill e download pelo portal do cliente.

### Modified Capabilities
<!-- Nenhuma: `app-help` ainda vive no change `pagina-ajuda-e-menu-avancado`, e os requisitos dela não mudam; a página só ganha o cartão, descrito na capability nova. -->

## Impact

- **Backend**: novo módulo `help-skill`; consulta nova no `FunctionCatalog` (funções sem restrição de portais); arquivos Markdown copiados no build; variável opcional `PUBLIC_SUPPORT_URL` também lida pela API; dependência pequena para gerar `.zip`.
- **Frontend**: `frontend/src/app/app/help/` e `help.json` nos três idiomas.
- **Segurança**: duas rotas sem autenticação, somente leitura de dados globais de template. As perguntas dos formulários passam a ser públicas.
- Sem migration. Depende da página Ajuda (change `pagina-ajuda-e-menu-avancado`), já presente em `develop`.
