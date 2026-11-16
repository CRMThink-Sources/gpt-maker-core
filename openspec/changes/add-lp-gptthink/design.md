# Design

## Context

O frontend só tinha `/app` (iframe do Bitrix, com `I18nProvider` que depende de `BX24`) e `/admin`; a raiz `/` redireciona para `/app` e o layout raiz é neutro (`lang="pt-BR"`). O Caddy encaminha tudo que não é `/app` ao frontend com `frame-ancestors 'self'`, então uma rota pública nova não exige mudança de infra. O sistema de mensagens (`frontend/src/i18n`, next-intl `createTranslator`) já tem pt-BR/en/es com teste de paridade de chaves. Ver `proposal.md` para a motivação. Detalhes e alternativas em `docs/superpowers/specs/2026-11-16-lp-gptthink-design.md`.

## Goals / Non-Goals

**Goals:**
- Páginas estáticas, no idioma certo desde o primeiro byte, sem depender de Bitrix, sessão ou backend.
- Reaproveitar o sistema de mensagens e o tema (`brand-*`) existentes.

**Non-Goals:**
- Alterar o layout raiz, `/app`, `/admin`, `I18nProvider` ou o redirect de `/`.
- Capturas de tela reais, tema escuro, preços ou captura de leads.

## Decisions

- **Idioma na URL** (`/lp/gptthink`, `/lp/gptthink/en`, `/lp/gptthink/es`) em vez de seletor no cliente: a página sai estática no idioma certo, sem troca depois do carregamento, e buscadores veem as três versões. Custo: mais rotas.
- **Duas rotas**: `page.tsx` (pt-BR) e `[locale]/page.tsx` com `generateStaticParams` (`en`, `es`) e `dynamicParams = false`; `pt-BR` só existe na URL sem sufixo, para não haver duas URLs do mesmo conteúdo.
- **Textos com `landingT(locale)` em componentes de servidor** (`createTranslator` do next-intl sobre `MESSAGES`), sem `I18nProvider` (que usa `BX24`). O `createT` de `@/i18n` não serve: esse módulo é `'use client'` e não pode ser chamado de componente de servidor. Namespace `landing` novo, um JSON por idioma.
- **Primeiros passos como simulação visual**, no formato da LP do ThinkZap: texto à esquerda e, à direita, uma réplica da tela (JSX/Tailwind, sem imagens) com um destaque laranja clicável. As 18 telas (6 abas × 3 passos) são componentes de servidor em `components/landing/tutorial/`, montadas por `buildTutorialTabs(locale)`; os rótulos delas vêm dos próprios textos do app (`shell`, `agentDetail`, `trainings`…), para espelharem a interface real e ficarem nos três idiomas sem texto duplicado. O `Hotspot` é o único elemento de cliente dentro delas e avança o passo por contexto fornecido pelas abas. Alternativa descartada: capturas de tela reais (o `/app` exige sessão do Bitrix e a imagem envelhece a cada mudança de interface).
- **Identidade visual própria, no padrão das LPs da CRMThink**: títulos em Montserrat e texto em Inter (as mesmas fontes da LP do ThinkZap, carregadas com `next/font` só em `app/lp/layout.tsx`), cores do logo do GPTThink (violeta `#5A1FE0`, tinta `#1C1640`, laranja `#FF8A4C` do raio do robô) como tokens `lp-*` em `globals.css`, e o logo oficial (`LogoMark`). Cards de borda fina e raio 14px, faixas de fundo alternadas, FAQ em lista e ícone próprio por funcionalidade. Evita o visual de kit genérico (ícone repetido, sombras e cantos exagerados, bloco de CTA gigante). O `/app` e o `/admin` não mudam.
- **Só as abas e o destaque são componentes de cliente**; os textos chegam por props (o indicador "Passo X de N" já vem formatado do servidor). O seletor de idioma é um conjunto de links `<a>` em componente de servidor.
- **`lang` num `<div lang>`** dentro da página, sem tocar no layout raiz.
- **Link do Market** como constante em `lib/landing.ts`, provisório até o link real do app ser informado.

## Risks / Trade-offs

- [Link do Market provisório aponta para a raiz do Market] → comentário no código, aviso no PR e pendência registrada nas tasks.
- [Textos de produto escritos a partir do código e da skill do Conector] → revisão de conteúdo pelo time antes do release; sem preços/planos para não prometer o que o backoffice controla.
- [`lang` só no `<div>`, o `<html>` segue `pt-BR`] → aceitável para leitores de tela e buscadores; revisitar se a LP crescer para mais rotas.
