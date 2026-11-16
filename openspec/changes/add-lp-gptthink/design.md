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
- **Só as abas são componente de cliente**; os textos chegam por props (o indicador "Passo X de N" já vem formatado do servidor). O seletor de idioma é um conjunto de links `<a>` em componente de servidor.
- **`lang` num `<div lang>`** dentro da página, sem tocar no layout raiz.
- **Link do Market** como constante em `lib/landing.ts`, provisório até o link real do app ser informado.

## Risks / Trade-offs

- [Link do Market provisório aponta para a raiz do Market] → comentário no código, aviso no PR e pendência registrada nas tasks.
- [Textos de produto escritos a partir do código e da skill do Conector] → revisão de conteúdo pelo time antes do release; sem preços/planos para não prometer o que o backoffice controla.
- [`lang` só no `<div>`, o `<html>` segue `pt-BR`] → aceitável para leitores de tela e buscadores; revisitar se a LP crescer para mais rotas.
