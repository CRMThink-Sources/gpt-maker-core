# Proposal

## Why

Quem acabou de instalar o GPTThink não tem um lugar público que explique o que fazer em seguida, e quem está só conhecendo o app não tem uma página que mostre o que ele faz. Os outros apps da CRMThink (ex.: ThinkZap em `hubthink.crmthink.com.br/lp/thinkzap`) já têm landing page, e o GPTThink precisa de uma no mesmo padrão para que as LPs dos apps sejam consistentes.

## What Changes

- Nova rota pública **`/lp/gptthink`** (pt-BR) e **`/lp/gptthink/en`**, **`/lp/gptthink/es`**, no frontend deste repositório, fora do `/app` (iframe do Bitrix) e do `/admin`.
- Estrutura igual à da LP do ThinkZap: cabeçalho com âncoras, seletor de idioma e botão Instalar; hero com mockup de conversa; grade de funcionalidades; **Primeiros passos** em abas (no lugar dos tutoriais); FAQ; CTA final; rodapé.
- Páginas estáticas, com o idioma na URL, metadados por idioma e `hreflang`.
- Textos nos três idiomas, num namespace novo de mensagens (`landing`).
- Todo CTA de instalar leva ao Market do Bitrix24, em nova aba.
- Sem backend, sem migration, sem alteração de contrato. Sem preços, planos, depoimentos ou formulário.

## Capabilities

### New Capabilities
- `landing-page`: LP pública do GPTThink (rotas e idiomas, conteúdo e estrutura, abas de primeiros passos, CTAs de instalação, metadados).

### Modified Capabilities
<!-- Nenhuma: os textos novos seguem o sistema de mensagens já existente (`app-i18n`) sem mudar seus requisitos. -->

## Impact

- `frontend/src/app/lp/gptthink/` (rotas), `frontend/src/components/landing/` (componentes), `frontend/src/lib/landing.ts` (helpers e link do Market).
- `frontend/src/i18n/config.ts` e `frontend/src/i18n/messages/{pt-BR,en,es}/landing.json`.
- Infra: nenhuma mudança; o Caddy já encaminha tudo que não é `/app` ao frontend com `frame-ancestors 'self'`.
- Pendente de negócio: o link real do GPTThink no Market do Bitrix24 (hoje provisório).
- Sem breaking change.
