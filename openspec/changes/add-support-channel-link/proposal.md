# Proposal

## Why

Hoje o cliente do portal (`/app`) não tem nenhum caminho dentro do app para pedir suporte ou tirar dúvidas com a CRMThink. A CRMThink já mantém um canal aberto no Bitrix24.Network, e o Bitrix oferece um link que, ao ser aberto, adiciona ao portal do cliente uma conversa direta com esse canal. Falta só expor esse link no app.

## What Changes

- Novo item **Suporte** no aside do `/app`, visível a todos os usuários (admin, gerente e somente leitura), que abre o link do canal em **nova aba**.
- A URL do canal vem de configuração de ambiente (`PUBLIC_SUPPORT_URL`), lida em tempo de execução no layout do `/app` e repassada na `config` da sessão, como já é feito com `PUBLIC_PLATFORM_URL`. Sem a variável, o item não aparece.
- Textos do item (rótulo e dica) em `pt-BR`, `en` e `es`.
- Sem backend, sem migration, sem alteração de contrato.
- Fora do escopo desta versão: conectar o canal por REST (`imopenlines.network.join`), card de ajuda na home e link de suporte nos alertas de erro.

## Capabilities

### New Capabilities
- `support-channel`: acesso do cliente ao canal de suporte da CRMThink a partir do app (visibilidade, abertura em nova aba, configuração por ambiente).

### Modified Capabilities
<!-- Nenhuma: os textos novos seguem os requisitos já existentes de `app-i18n`. -->

## Impact

- `frontend/src/app/app/layout.tsx` (nova chave `supportUrl` em `config`), `session-provider.tsx` (tipo da `config`), `app-shell.tsx` (item no aside).
- `frontend/src/i18n/messages/{pt-BR,en,es}/shell.json`.
- `infra/.env.prod.example`, `infra/.env.staging*` e `infra/.env.production` (variável `PUBLIC_SUPPORT_URL`); verificar também o compose/workflow que repassa as `PUBLIC_*` ao container do frontend.
- Teste de componente do aside (item aparece/some, nova aba, todos os papéis).
- Sem breaking change.
