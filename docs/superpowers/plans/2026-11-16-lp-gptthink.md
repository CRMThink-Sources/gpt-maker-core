# LP pública do GPTThink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar a landing page do GPTThink em `/lp/gptthink` (pt-BR) e `/lp/gptthink/{en,es}`, no padrão da `/lp/thinkzap`.

**Architecture:** Duas rotas do App Router (`page.tsx` para pt-BR, `[locale]/page.tsx` para en/es, estática) renderizam o mesmo componente `GptthinkLanding({ locale })`. Os textos vêm de um namespace novo `landing` do sistema de mensagens existente, lido com `landingT(locale)` (`createTranslator` direto; o `createT` de `@/i18n` é `'use client'`), sem `I18nProvider` e sem `BX24`. Só as abas de "Primeiros passos" são componente de cliente.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind 4, next-intl (`createTranslator`), Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-11-16-lp-gptthink-design.md`

## Global Constraints

- Next.js 16: antes de escrever código de Next, consultar `node_modules/next/dist/docs/` (na raiz do monorepo). `params` é `Promise`; usar `PageProps<'/lp/gptthink/[locale]'>`.
- Rotas: `/lp/gptthink` = pt-BR; `/lp/gptthink/en` e `/lp/gptthink/es`; qualquer outro valor (inclusive `pt-BR`) = 404 (`dynamicParams = false`).
- `lang` do idioma vai num `<div lang={locale}>`; **não** mexer em `frontend/src/app/layout.tsx`, `/app`, `/admin`, `I18nProvider` nem no redirect de `/`.
- Sem `BX24`, sessão ou chamada ao backend. Sem preços, planos, depoimentos, formulário, imagens externas ou tema escuro.
- Cor da marca: tokens `brand-*` de `frontend/src/app/globals.css`. Mobile primeiro.
- Textos: pt-BR é a fonte; `en` e `es` com as mesmas chaves (o teste de paridade em `frontend/src/i18n/i18n.test.tsx` cobre).
- Código em inglês/português misto como já existe; **comentários, commits e textos pt-BR em português**. Arquivos em `kebab-case`.
- Commits: `git add` só dos caminhos da tarefa (a árvore tem mudanças de OpenSpec alheias a este trabalho). Rodapé: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Infra: `site.caddy.tmpl` já encaminha tudo que não é `/app` ao frontend com `frame-ancestors 'self'`; `/lp/*` **não** exige mudança no Caddy.

## Review Focus

1. `/lp/gptthink/pt-BR` e `/lp/gptthink/fr`: devem dar 404, não renderizar (Task 4).
2. Abas: "Voltar" desabilitado no passo 1, "Próximo" desabilitado no último; trocar de aba volta ao passo 1 (Task 2).
3. Idioma atual do seletor marcado com `aria-current="page"` e links com as três URLs corretas (Task 3).
4. `GPTTHINK_MARKET_URL` nunca vazio e sempre `https://`; link externo com `rel="noopener noreferrer"` (Tasks 1 e 4).
5. `hreflang` (`alternates.languages`) com as três URLs e canonical do idioma da página (Task 4).

---

### Task 1: Branch, OpenSpec, textos e helpers

**Files:**
- Create: `frontend/src/lib/landing.ts`, `frontend/src/lib/landing.test.ts`
- Create: `frontend/src/i18n/messages/{pt-BR,en,es}/landing.json`
- Modify: `frontend/src/i18n/config.ts` (importar e registrar `landing` nos três idiomas)
- Create: change OpenSpec `add-lp-gptthink` (via `/opsx:propose`, usando o design como entrada)

**Interfaces:**
- Produces (`@/lib/landing`):
  - `GPTTHINK_MARKET_URL: string` (https; valor provisório = raiz do Market do Bitrix24 até o usuário informar o link real; deixar comentário em português apontando isso)
  - `landingPath(locale: Locale): string` → `'/lp/gptthink'` | `'/lp/gptthink/en'` | `'/lp/gptthink/es'`
  - `landingLocaleFromParam(param: string): Locale | null` → só `'en'`/`'es'`; `'pt-BR'`, `'fr'` etc. → `null`
  - `LANDING_TAB_IDS = ['activate','create','train','intentions','channel','credits'] as const`
  - `LANDING_FEATURE_IDS = ['agents','training','intentions','functions','crm','handoff','offHours','testChat','credits'] as const`
  - `LANDING_FAQ_IDS = [1,2,3,4,5,6] as const`
- Produces (`landing.json`, chaves por idioma): `meta.{title,description}`; `nav.{features,start,faq,install,language}`; `hero.{title,subtitle,ctaInstall,ctaStart}`; `mock.{contact,customer,agent,note}`; `features.title` e `features.items.<id>.{title,description}`; `start.{title,subtitle,back,next,stepOf}` (`stepOf` = "Passo {current} de {total}") e `start.tabs.<id>.{label,title,step1,step2,step3}`; `faq.title` e `faq.q<n>`/`faq.a<n>`; `cta.{title,text,button}`; `footer.text`.

- [ ] **Step 1: Branch.** `git switch develop && git pull && git switch -c feat/lp-gptthink`. As mudanças pendentes do OpenSpec vão junto na árvore; não adicioná-las aos commits.
- [ ] **Step 2: Escrever `landing.test.ts` (falha).** Casos: `landingPath('pt-BR')==='/lp/gptthink'`, `landingPath('en')==='/lp/gptthink/en'`, `landingPath('es')==='/lp/gptthink/es'`; `it.each` de `landingLocaleFromParam` (`'en'`→`'en'`, `'es'`→`'es'`, `'pt-BR'`/`'fr'`/`''`→`null`); `GPTTHINK_MARKET_URL` começa com `https://`.
- [ ] **Step 3: Rodar e ver falhar.** `npx vitest run src/lib/landing.test.ts` em `frontend/` → FAIL (módulo inexistente).
- [ ] **Step 4: Implementar `lib/landing.ts`** com as assinaturas acima (reusar `Locale`/`isLocale` de `@gptmaker/contracts`).
- [ ] **Step 5: Escrever os três `landing.json`** com todas as chaves acima. Rascunho em pt-BR a partir do código e da skill `anthropic-skills:gptmaker-conector` (nada que prometa o que o produto não faz; sem preços/planos); `en` e `es` traduzidos fielmente. Registrar `landing` em `config.ts` nos três blocos (import + objeto `ptBR`/`en`/`es`).
- [ ] **Step 6: Verificar.** `npx vitest run src/lib/landing.test.ts src/i18n/i18n.test.tsx` → PASS (paridade inclusa).
- [ ] **Step 7: OpenSpec.** Rodar `/opsx:propose` para `add-lp-gptthink` com o design aprovado como base; commitar apenas `openspec/changes/add-lp-gptthink/`.
- [ ] **Step 8: Commit** dos arquivos da tarefa + `docs/superpowers/specs/2026-11-16-lp-gptthink-design.md` + este plano: `feat(lp): textos e helpers da LP do GPTThink`.

---

### Task 2: Abas "Primeiros passos" (cliente)

**Files:**
- Create: `frontend/src/components/landing/landing-tabs.tsx`
- Test: `frontend/src/components/landing/landing-tabs.test.tsx`

**Interfaces:**
- Produces: `LandingTabs(props: { tabs: LandingTab[]; backLabel: string; nextLabel: string })` com `LandingTab = { id: string; label: string; title: string; steps: { text: string; counter: string }[] }` (o `counter` já vem formatado, ex. "Passo 1 de 3", montado no servidor). Exportar o tipo `LandingTab`.

- [ ] **Step 1: Escrever o teste (falha).** Com 2 abas de 3 passos: (a) mostra a 1ª aba e o passo 1 e seu `counter`; (b) "Próximo" avança e "Voltar" retorna; (c) "Voltar" desabilitado no passo 1 e "Próximo" desabilitado no último; (d) clicar noutra aba mostra o título dela **no passo 1**, mesmo se a anterior estava no passo 3; (e) abas usam `role="tablist"/"tab"` com `aria-selected` na ativa.
- [ ] **Step 2: Rodar** `npx vitest run src/components/landing/landing-tabs.test.tsx` → FAIL.
- [ ] **Step 3: Implementar** `'use client'`, estado `{tabId, step}`; painel com `role="tabpanel"`; estilo Tailwind com `brand-*`.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat(lp): abas de primeiros passos da LP`.

---

### Task 3: Seletor de idioma (servidor)

**Files:**
- Create: `frontend/src/components/landing/language-switcher.tsx`
- Test: `frontend/src/components/landing/language-switcher.test.tsx`

**Interfaces:**
- Consumes: `landingPath`, `LOCALE_LABELS` de `@/i18n/config`, `LOCALES` de `@gptmaker/contracts`.
- Produces: `LanguageSwitcher(props: { current: Locale; label: string })` — três links `<a>` (rótulos de `LOCALE_LABELS`), o atual com `aria-current="page"`, dentro de `<nav aria-label={label}>`. Sem estado nem JS de cliente (desvio do design: menu simplificado para links inline).

- [ ] **Step 1: Teste (falha):** com `current="en"` há 3 links com `href` `/lp/gptthink`, `/lp/gptthink/en`, `/lp/gptthink/es`; só o de "English" tem `aria-current="page"`; o `nav` tem o `aria-label` recebido.
- [ ] **Step 2: Rodar** → FAIL. **Step 3: Implementar.** **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat(lp): seletor de idioma da LP`.

---

### Task 4: Página, rotas e metadados

**Files:**
- Create: `frontend/src/components/landing/gptthink-landing.tsx`, `frontend/src/components/landing/gptthink-landing.test.tsx`
- Create: `frontend/src/components/landing/landing-metadata.ts`
- Create: `frontend/src/app/lp/gptthink/page.tsx`, `frontend/src/app/lp/gptthink/[locale]/page.tsx`
- Test: `frontend/src/app/lp/gptthink/routes.test.ts`

**Interfaces:**
- Consumes: `landingT` (`components/landing/landing-t.ts`, criado nesta tarefa), `LandingTabs`/`LandingTab`, `LanguageSwitcher`, helpers de `@/lib/landing`.
- Produces:
  - `GptthinkLanding(props: { locale: Locale }): JSX.Element` — componente síncrono (sem `async`/hooks) que monta `<div lang={locale}>` com: cabeçalho (âncoras `#funcionalidades`, `#primeiros-passos`, `#duvidas` — ids fixos nos três idiomas; seletor; botão Instalar), hero com mockup de conversa em JSX, grade de 9 cards, `LandingTabs` (6 abas, 3 passos cada, `counter` via `t('start.stepOf', { current, total: 3 })`), FAQ em `<details>`, CTA final, rodapé. Todo CTA de instalar = `<a href={GPTTHINK_MARKET_URL} target="_blank" rel="noopener noreferrer">`.
  - `landingMetadata(locale: Locale): Metadata` — `title`/`description` de `landing.meta`, `alternates: { canonical: landingPath(locale), languages: { 'pt-BR': …, en: …, es: … } }`.
  - `[locale]/page.tsx`: `export const dynamicParams = false`; `generateStaticParams()` → `[{locale:'en'},{locale:'es'}]`; `generateMetadata` e página usam `landingLocaleFromParam` e `notFound()` se `null`.

- [ ] **Step 1: Teste do componente (falha):** `render(<GptthinkLanding locale="en" />)` mostra o título do hero de `MESSAGES.en.landing.hero.title`; o ancestral com `lang="en"` existe; os dois CTAs de instalar têm `href=GPTTHINK_MARKET_URL` e `rel` com `noopener`; 9 cards de funcionalidade e 6 itens de FAQ; repetir para `pt-BR` e `es` com `it.each`.
- [ ] **Step 2: Teste das rotas (falha):** `generateStaticParams()` de `[locale]/page.tsx` devolve exatamente `en` e `es`; `dynamicParams === false`; `landingMetadata('es').alternates.languages` tem as três URLs e `canonical === '/lp/gptthink/es'`; página com `params: Promise.resolve({locale:'pt-BR'})` e `{locale:'fr'}` lança o erro de `notFound()` (mockar `next/navigation` se necessário).
- [ ] **Step 3: Rodar** `npx vitest run src/components/landing src/app/lp` → FAIL.
- [ ] **Step 4: Implementar** os arquivos acima (consultar os docs do Next 16 antes de escrever as páginas).
- [ ] **Step 5: Rodar** → PASS.
- [ ] **Step 6: Commit** `feat(lp): página e rotas públicas /lp/gptthink`.

---

### Task 5: Verificação final

- [ ] **Step 1:** `npm run build -w @gptmaker/contracts`
- [ ] **Step 2:** `npm run format:check && npm run lint && npm run typecheck && npm run depcruise` — ruído conhecido fora do código da aplicação (`.claude/worktrees/`, `.agents/skills/`, `.superpowers/`) está em "Pontos a confirmar" do `CLAUDE.md`; os arquivos desta tarefa devem estar limpos (`npx prettier --check` e `npx eslint` nos caminhos criados).
- [ ] **Step 3:** `npm test` e `npm run build` (rota nova do Next); conferir no output do build que `/lp/gptthink`, `/lp/gptthink/en` e `/lp/gptthink/es` saem como estáticas (●/○).
- [ ] **Step 4:** `npm run dev -w frontend` e abrir as três URLs, mais `/lp/gptthink/pt-BR` e `/lp/gptthink/fr` (esperado 404), em largura de celular e desktop; navegar pelas abas e FAQ.
- [ ] **Step 5:** Rodar os subagentes `revisor-frontend` e `revisor-codigo` no diff; corrigir apontamentos.
- [ ] **Step 6:** Push da branch e PR para `develop` (nunca para `master`). Informar no PR que `GPTTHINK_MARKET_URL` é provisório se o link real ainda não tiver sido informado.

---

## Self-review

- **Cobertura do spec:** rotas e 404 (Task 4), idioma na URL e `lang` (Task 4), seletor (Task 3), abas (Task 2), textos nos 3 idiomas e paridade (Task 1), metadados/hreflang (Task 4), OpenSpec e branch (Task 1), verificação do CI (Task 5), Caddy (resolvido: sem mudança). Sem capturas de tela, preços ou BX24 por construção.
- **Desvio do spec:** seletor de idioma virou links inline em componente de servidor (menos JS de cliente); as abas continuam sendo o único componente de cliente.
- **Consistência de tipos:** `LandingTab`, `landingPath`, `landingLocaleFromParam`, `GPTTHINK_MARKET_URL` e os ids de `landing.json` são definidos na Task 1/2 e só consumidos depois.
- **Pendente do usuário:** link real do Market e revisão dos textos.
