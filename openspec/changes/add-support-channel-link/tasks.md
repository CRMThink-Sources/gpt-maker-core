## 1. Configuração de ambiente

- [x] 1.1 Adicionar `supportUrl: string | null` ao tipo da config em `frontend/src/lib/platform-session.ts` e preencher em `frontend/src/app/app/layout.tsx` com `process.env.PUBLIC_SUPPORT_URL || null`. Verificar: `npm run typecheck`.
- [x] 1.2 Repassar `PUBLIC_SUPPORT_URL` ao container do frontend em `infra/docker-compose.prod.yml` (`${PUBLIC_SUPPORT_URL:-}`) e `infra/docker-compose.yml` (`${SUPPORT_URL:-}`). Verificar: `docker compose -f infra/docker-compose.yml config` mostra a variável.
- [x] 1.3 Documentar a variável em `infra/.env.prod.example` e definir o valor em `infra/.env.staging`, `infra/.env.staging.github` e `infra/.env.production` (link do canal informado no pedido). Verificar: `git diff infra/` só traz a variável nova.

## 2. Item Suporte no aside

- [x] 2.1 Usar um ícone de chat em `frontend/src/components/icons.tsx` (o `ChatIcon` já existia; nada a adicionar). Verificar: renderiza no aside (2.3).
- [x] 2.2 Textos `support` (rótulo e título do grupo) em `frontend/src/i18n/messages/{pt-BR,en,es}/shell.json`. Verificar: `npx vitest run src/i18n/i18n.test.tsx` (paridade de chaves) em `frontend/`.
- [x] 2.3 Em `frontend/src/app/app/app-shell.tsx`: suportar item de link externo no `NavItem`, renderizado como `<a target="_blank" rel="noopener noreferrer">`, sem `aria-current`; criar o grupo "Suporte" no fim do `NAV`, sem filtro de papel e exibido só quando `config.supportUrl` existir; fechar a gaveta ao acionar. Verificar: teste do 2.4.
- [x] 2.4 Teste `frontend/src/app/app/app-shell.test.tsx` (Testing Library, pt-BR): o item aparece com a URL configurada e leva `href` igual à URL, `target="_blank"` e `rel` com `noopener`; não aparece sem URL (nula ou vazia); aparece para usuário somente leitura; no celular, acioná-lo fecha a gaveta. Verificar: `npx vitest run src/app/app/app-shell.test.tsx` em `frontend/`.

## 3. Verificação final

- [x] 3.1 Rodar o que o CI roda: `npm run build -w @gptmaker/contracts`, `npm run format:check && npm run lint && npm run typecheck && npm run depcruise`, `npm test`. Verificar: sem falhas novas além dos ruídos já listados em `CLAUDE.md` (Pontos a confirmar).
- [ ] 3.2 Conferir no navegador (`npm run dev -w frontend`, com `PUBLIC_SUPPORT_URL` definida) que o item aparece em desktop e celular e abre o canal em nova aba; sem a variável, o item não aparece. Rodar o `revisor-frontend` no diff.
- [ ] 3.3 Após o deploy no staging, validar no portal de teste que o link abre o fluxo do Bitrix24.Network e adiciona a conversa. Verificar: conversa visível no messenger do portal.
