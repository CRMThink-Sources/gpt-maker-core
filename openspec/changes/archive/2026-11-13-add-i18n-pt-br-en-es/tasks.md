# Tasks

## 1. Fundação

- [x] 1.1 Validar `next-intl` com Next 16.3.6/React 19.2 num spike; se incompatível, adotar dicionários próprios conforme a doc local do Next
- [x] 1.2 Adicionar `Locale` (`pt-BR | en | es`) e `locale` na view do tenant em `packages/contracts`; rebuild do pacote
- [x] 1.3 Tipar `BX24.getLang()` em `frontend/src/lib/bx24.ts` e criar o mapeamento portal → locale com testes
- [x] 1.4 Criar `frontend/src/i18n/` (provider de cliente, resolução do idioma, persistência em `localStorage`, `document.documentElement.lang`) e ligar no `session-provider` do `/app`
- [x] 1.5 `useFormat`/`createFormat` em `i18n/` (data/hora/número/BRL por locale) com teste; sem provider vale pt-BR, então os testes existentes não precisam de wrapper
- [x] 1.6 Seletor de idioma no `app-shell` com teste
- [x] 1.7 Teste de paridade de chaves entre `pt-BR.json`, `en.json` e `es.json`

## 2. Extração de textos do frontend

- [x] 2.1 `components/` (`ui`, `stepper`, `modal`, `logo`) e `app-shell`/`page` do `/app`
- [x] 2.2 `app/app/agents` (45 arquivos: formulário, intenções, treinamentos, gatilhos, CRM, calendário, chat de teste, assistente, revisão)
- [x] 2.3 `app/app/plan`, `ai-key`, `permissions`, `crm`, `notifications`
- [x] 2.4 Rótulos e erros em `lib/*.ts` (`triggers`, `trainings`, `crm`, `crm-fields`, `calendar`, `agents`, `agent-tests`, `bx24`, `platform-session`, `portal-users`)
- [x] 2.5 Namespace `errors` por `error.code` + helper com fallback para `message`; trocar os usos de `.message` do `/app`
- [x] 2.6 Substituir `'pt-BR'`/`toLocale*`/`Intl` fixos do `/app` por `lib/format.ts` (manter BRL, `en-CA` ISO e fuso dos ciclos)
- [x] 2.7 `metadata` do layout raiz e `<html lang>` dinâmico
- [x] 2.8 Traduzir `en` e `es` e solicitar revisão humana
- [x] 2.9 Ajustar testes existentes do frontend ao provider e adicionar testes de troca de idioma e fallback

## 3. Backend

- [x] 3.1 Coluna `locale` em `tenants` (default `pt-BR`, check), `npm run db:generate -w backend`, conferir que só a migration nova aparece; rodar `guardiao-migracoes`
- [x] 3.2 Endpoint `@AppAuth()` para atualizar o locale do tenant (zod de contracts, filtrado por `tenantId`) e expô-lo na view; frontend sincroniza no boot/troca
- [x] 3.3 `notifications/messages.ts` com `locale` (5 mensagens × 3 idiomas, datas por locale) e uso do locale do tenant em `notification.service.ts`
- [x] 3.4 `channel/no-credit.handler.ts` no locale do tenant; revisar `human-handoff.ts` e `reply-publisher.ts` por outros textos fixos
- [x] 3.5 Testes unitários e de integração (isolamento por tenant no endpoint, locale na notificação e no aviso do canal) (feito: unitários de mensagens e integração do endpoint de locale; aviso do canal por idioma sem teste dedicado)

## 4. Verificação

- [x] 4.1 Varredura por acentos/palavras pt-BR restantes em `frontend/src/app/app`, `components/` e `lib/`
- [x] 4.2 CI local: build contracts, `format:check`, `lint`, `typecheck`, `depcruise`, `npm test`, `test:integration`, `npm run build`
- [x] 4.3 Revisão com `revisor-frontend`, `auditor-multitenant` e `revisor-codigo` (sem bloqueantes; sincronização do idioma do tenant corrigida)
- [x] 4.4 Conferir manualmente no Bitrix com portal em pt-BR, en e es
