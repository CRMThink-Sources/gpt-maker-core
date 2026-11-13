# Proposal

## Why

O aplicativo será publicado no marketplace do Bitrix24, que exige interface em mais de um idioma. Hoje toda a UI do portal do cliente (`/app`), as mensagens de erro, as notificações e os avisos ao cliente final estão fixos em português. É preciso suportar **pt-BR, en e es**.

## What Changes

- Infraestrutura de i18n no frontend (`next-intl` sem prefixo de URL, dicionários JSON `pt-BR`/`en`/`es`), com `<html lang>` dinâmico.
- Idioma da interface `/app` definido pelo idioma do portal Bitrix (`BX24.getLang()`), com fallback `en`; o usuário pode trocar manualmente e a escolha persiste.
- Extração de todas as strings hardcoded do portal do cliente (`/app`, `components/`, `lib/`) para os dicionários.
- Formatação de datas, números e moeda conforme o idioma ativo (hoje fixa em `pt-BR`). A moeda de cobrança continua BRL (dado de negócio).
- Erros de API: o frontend traduz pelo `error.code` estável do `DomainError`, usando `error.message` (pt-BR) apenas como fallback. Sem mudar o contrato de erro.
- Backend: o tenant passa a ter `locale` (nova coluna + migration). Notificações Bitrix (`notifications/messages.ts`) e o aviso de falta de créditos no canal (`no-credit.handler.ts`) são emitidos no idioma do tenant.
- Teste que garante paridade de chaves entre os três dicionários.
- Fora do escopo: backoffice `/admin` (uso interno da CRMThink, permanece pt-BR), templates de função/guidance de CRM (conteúdo do agente no GPTMaker), logs e mensagens de `DomainError` no backend.

## Capabilities

### New Capabilities
- `app-i18n`: idioma da interface do portal do cliente (detecção, troca, persistência, dicionários, formatação localizada, tradução de erros por código).
- `notification-i18n`: idioma das mensagens geradas pelo backend para o tenant (notificações Bitrix e aviso de sem créditos no canal).

### Modified Capabilities
<!-- Nenhuma: não altera requisitos das specs existentes. -->

## Impact

- `frontend/`: novo provider de i18n, `layout.tsx`, ~110 arquivos de UI, `lib/bx24.ts` (tipar `getLang`), `lib/*` com rótulos, testes de componentes (que assumem texto pt-BR).
- `backend/`: schema do tenant + migration, `modules/notifications`, `modules/channel/no-credit.handler.ts`, endpoint para ler/gravar o locale do tenant.
- `packages/contracts`: tipo `Locale` e campo `locale` na view do tenant/sessão.
- Dependência nova: `next-intl` (exige validar compatibilidade com Next 16.3.6).
- Sem breaking change de API.
