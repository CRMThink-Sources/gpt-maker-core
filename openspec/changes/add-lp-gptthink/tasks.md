# Tasks

## 1. Textos e helpers

- [x] 1.1 Criar `frontend/src/lib/landing.ts` (`GPTTHINK_MARKET_URL`, `landingPath`, `landingLocaleFromParam`, ids de abas/funcionalidades/FAQ) com teste em `frontend/src/lib/landing.test.ts`. Verificar: `npx vitest run src/lib/landing.test.ts` em `frontend/`.
- [x] 1.2 Criar o namespace `landing` em `frontend/src/i18n/messages/{pt-BR,en,es}/landing.json` e registrá-lo em `frontend/src/i18n/config.ts`. Verificar: `npx vitest run src/i18n/i18n.test.tsx` (paridade de chaves).

## 2. Componentes

- [ ] 2.1 `frontend/src/components/landing/landing-tabs.tsx` (cliente): abas com 3 passos, Voltar/Próximo, limites e reset ao trocar de aba, `role="tablist"/"tab"/"tabpanel"`. Verificar: `landing-tabs.test.tsx` (navegação, limites, reset, `aria-selected`).
- [ ] 2.2 `frontend/src/components/landing/language-switcher.tsx` (servidor): links para as três URLs, idioma atual com `aria-current="page"`. Verificar: `language-switcher.test.tsx`.

## 3. Página e rotas

- [ ] 3.1 `gptthink-landing.tsx` (cabeçalho, hero com mockup, funcionalidades, abas, FAQ, CTA final, rodapé; `<div lang>`; CTAs com `rel="noopener noreferrer"`) e `landing-metadata.ts` (título, descrição, canonical e `hreflang`). Verificar: `gptthink-landing.test.tsx` nos três idiomas.
- [ ] 3.2 Rotas `frontend/src/app/lp/gptthink/page.tsx` e `[locale]/page.tsx` (`generateStaticParams` en/es, `dynamicParams = false`, `notFound()` para outros valores), conferindo antes os docs do Next 16 em `node_modules/next/dist/docs/`. Verificar: `routes.test.ts` (params estáticos, 404 para `pt-BR` e `fr`).

## 4. Verificação final

- [ ] 4.1 Rodar o que o CI roda: `npm run build -w @gptmaker/contracts`, `npm run format:check && npm run lint && npm run typecheck && npm run depcruise`, `npm test`, `npm run build` (as três URLs saem estáticas). Verificar: sem falhas novas além dos ruídos listados em `CLAUDE.md` (Pontos a confirmar).
- [ ] 4.2 Conferir no navegador (`npm run dev -w frontend`) as três URLs em celular e desktop, as abas e o FAQ, e que `/lp/gptthink/pt-BR` e `/lp/gptthink/fr` dão 404. Rodar `revisor-frontend` e `revisor-codigo` no diff.
- [ ] 4.3 Substituir o `GPTTHINK_MARKET_URL` provisório pelo link real do GPTThink no Market do Bitrix24 e revisar os textos com o time. Verificar: os botões Instalar abrem a página do app.
