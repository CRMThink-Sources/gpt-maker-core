# Design

## Context

- Frontend Next.js 16.3.6, sem lib de i18n; `<html lang="pt-BR">` fixo em `frontend/src/app/layout.tsx`; ~113 arquivos com texto pt-BR; ~30 formatações `'pt-BR'` fixas (`Intl`/`toLocale*`); fuso `America/Sao_Paulo` fixo em `credits-sections.tsx` e `notifications/messages.ts`.
- `/app` roda em iframe do Bitrix; sessão via `BX24.getAuth()` → plataforma. `Bx24Auth` não traz locale, mas o SDK do Bitrix tem `BX24.getLang()` (não tipado em `lib/bx24.ts`).
- Quase todas as páginas de `/app` são client components.
- `DomainError` tem `code` estável (~164 usos, 47 arquivos), mas o frontend exibe `error.message` (pt-BR).
- Não há coluna de idioma no schema. Notificações (`notifications/messages.ts`, 5 mensagens, via `im.notify.system.add`) e `channel/no-credit.handler.ts` têm texto pt-BR fixo.
- `frontend/AGENTS.md`: conferir `node_modules/next/dist/docs/01-app/02-guides/internationalization.md` (o `middleware` virou `proxy.ts`).

## Goals / Non-Goals

**Goals:**
- `/app` completo em pt-BR, en e es, com idioma automático pelo portal e troca manual.
- Mensagens geradas pelo backend para o tenant no idioma dele.
- Paridade de chaves garantida por teste.

**Non-Goals:**
- Backoffice `/admin` (interno, permanece pt-BR).
- Tradução de templates de função, `crm-guidance`, treinamentos e comportamento do agente (conteúdo do GPTMaker).
- Traduzir `DomainError.message`, logs ou aviso de fora do horário (texto escrito pelo tenant).
- Outros idiomas, moedas ou fusos por tenant.

## Decisions

1. **Sem prefixo de URL (`/[lang]`).** O app vive em iframe com URL fixa registrada no Bitrix e sessão por `BX24`; prefixar rotas quebraria links e não traz SEO. O idioma fica em estado de cliente. Alternativa descartada: `proxy.ts` + `app/[lang]/` da doc do Next.
2. **`next-intl` em modo "sem roteamento", com provider de cliente.** Fornece mensagens ICU (plural/variáveis), `useTranslations` e formatadores (`useFormatter`) para tudo que hoje usa `toLocale*`. Alternativa: dicionários próprios com `getDictionary` da doc do Next, mais enxuta, mas sem plural/formatação. **Primeira tarefa é validar a compatibilidade com Next 16.3.6/React 19.2**; se falhar, cai para a alternativa.
3. **Origem do idioma:** `localStorage` (preferência) → `BX24.getLang()` mapeado (`br`→pt-BR, `la`→es, `en`→en, resto→en) → `en`. Resolvido no `session-provider` ao subir a sessão; enquanto não resolve, renderiza-se em `pt-BR`. O provider atualiza `document.documentElement.lang`.
4. **Dicionários** em `frontend/src/i18n/messages/{pt-BR,en,es}.json`, namespaces por área (`agents`, `plan`, `aiKey`, `permissions`, `errors`, `common`...). `pt-BR` é a fonte; teste Vitest compara o conjunto de chaves dos três.
5. **Erros por código:** namespace `errors` indexado por `error.code`; helper em `lib/` resolve `t(code)` com fallback para `error.message`. Rótulos em `lib/*.ts` (`triggers`, `crm-fields`, `calendar` etc.) viram funções/chaves que recebem `t`, sem import de React.
6. **Formatação:** helper único em `lib/format.ts` recebendo o locale; moeda sempre BRL; `'en-CA'` usado para gerar data ISO e o fuso `America/Sao_Paulo` dos ciclos de crédito permanecem (dado de negócio, não de idioma).
7. **Locale do tenant no backend:** coluna `locale` (text, `pt-BR` default, check nos 3 valores) em `tenants` via migration nova; `locale` entra na view do tenant/sessão em `@gptmaker/contracts` (`Locale` com zod). Frontend envia o locale após o primeiro boot/troca (`PUT` na rota do tenant atual, `@AppAuth()`, filtrado por `tenantId`). Um idioma por tenant (não por usuário), pois notificações e aviso do canal são por tenant.
8. **Mensagens do backend:** `notifications/messages.ts` e `no-credit.handler.ts` passam a receber `locale` e usam tabelas locais simples (`Record<Locale, ...>`); sem lib no backend. Datas via `Intl.DateTimeFormat(locale, { timeZone: 'America/Sao_Paulo' })`.
9. **Migração incremental:** extrair por área (shell/comum → agents → plan/ai-key/permissions/crm/notifications), atualizando os testes existentes para renderizar com provider em `pt-BR` (helper de teste), de modo que o texto esperado não mude.

## Risks / Trade-offs

- Volume: ~110 arquivos tocados → risco de strings esquecidas. Mitigação: teste de paridade e grep de acentos em `app/app` na verificação final.
- Flash de idioma errado antes da sessão resolver. Aceito; mitigado lendo `localStorage` cedo.
- `BX24.getLang()` pode não devolver os códigos esperados em todos os portais; o fallback `en` cobre, e o seletor manual corrige.
- Tradução en/es de qualidade: gerada por IA, precisa de revisão humana antes de publicar no marketplace.
- Locale por tenant (não por usuário): usuários do mesmo portal com idiomas diferentes veem a UI no próprio idioma, mas notificações saem no idioma do tenant.
