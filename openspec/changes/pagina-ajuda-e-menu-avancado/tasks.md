# Tasks

## 1. Menu em grupos

- [x] 1.1 Em `app-shell.tsx`, criar o grupo `advanced` com `crm` e `aiKey` (mantendo `href`, `match`, `adminOnly`, `requiresCrm`) e remover os dois itens dos grupos atuais
- [x] 1.2 Adicionar o item `help` (`/app/help`, `HelpIcon`, sem `adminOnly`) no grupo Suporte, antes do link externo
- [x] 1.3 Adicionar `HelpIcon` em `frontend/src/components/icons.tsx`
- [x] 1.4 Adicionar `advanced` e `help` em `shell.json` (`pt-BR`, `en`, `es`)
- [x] 1.5 Estender `app-shell.test.tsx`: ordem dos grupos, CRM e Vibecode em Avançado, visibilidade por papel/CRM, grupo Avançado oculto quando vazio, Ajuda visível a todos e sem depender de `supportUrl`

## 2. Página Ajuda

- [x] 2.1 Consultar `node_modules/next/dist/docs/` sobre páginas do App Router antes de criar a rota
- [x] 2.2 Criar `frontend/src/app/app/help/page.tsx` com `PageHeader`, guia de primeiros passos, FAQ por tema (`<details>/<summary>`) e botão de suporte condicionado a `config.supportUrl`
- [x] 2.3 Criar `help.json` em `pt-BR`, `en` e `es` com o mesmo conjunto de chaves (temas: criar e treinar o agente, créditos e plano, canal aberto, transferência para humano) e registrar o namespace se `config.ts` exigir
- [x] 2.4 Escrever `help/page.test.tsx`: perguntas recolhidas ao abrir e expansão ao acionar, botão de suporte com `target="_blank"`/`rel` e ausente sem URL, textos em outro idioma

## 3. Verificação

- [x] 3.1 Rodar `npm run format:check`, `npm run lint`, `npm run typecheck` e `npm test -w frontend`; conferir o teste de paridade de i18n
- [ ] 3.2 Conferir no navegador (desktop e gaveta no celular, como admin e como não admin) o menu e a página Ajuda
- [ ] 3.3 Revisar o texto da Ajuda com o time e rodar o agente `revisor-frontend`
