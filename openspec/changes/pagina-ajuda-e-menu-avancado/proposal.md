# Proposal

## Why

O cliente não tem, dentro do app, um lugar para tirar dúvidas básicas (primeiros passos, créditos, treinamento, transferência para humano); hoje só existe o link de Suporte. Além disso, o menu mistura itens de uso diário com itens técnicos: "CRM para o agente" e "Chave Vibecode" são recursos avançados que poluem o grupo principal e o de Configurações.

## What Changes

- Nova página **Ajuda** em `/app/help`, visível a todos os papéis: guia de primeiros passos, perguntas frequentes agrupadas por tema e botão para o canal de suporte (reaproveita `config.supportUrl`; sem URL, o botão não aparece).
- Novo item **Ajuda** no menu lateral, no grupo de Suporte, acima do link externo "Falar com o suporte".
- Nova seção **Avançado** no menu, contendo **CRM para o agente** (sai do grupo principal) e **Chave Vibecode** (sai de Configurações). Rotas e permissões não mudam: `/app/crm` segue condicionado a `features.crmTools` e `/app/ai-key` segue só para administradores. A seção some quando nenhum de seus itens é visível ao usuário.
- Textos novos em `pt-BR`, `en` e `es`.

## Capabilities

### New Capabilities
- `app-help`: página Ajuda do portal do cliente (conteúdo, acesso e idiomas).
- `app-navigation`: organização do menu lateral do `/app` em grupos (principal, Configurações, Avançado, Suporte) e regras de visibilidade dos itens.

### Modified Capabilities
<!-- Nenhum: os requisitos de `support-channel` (visibilidade, nova aba, configuração por ambiente, idiomas) não mudam; o item Suporte só ganha a companhia do item Ajuda no mesmo grupo. -->

## Impact

- Frontend apenas: `frontend/src/app/app/app-shell.tsx` (+ teste), nova rota `frontend/src/app/app/help/`, dicionários `shell.json` e novo `help.json` nos três idiomas (`frontend/src/i18n`), ícone em `components/icons.tsx` se necessário.
- Sem mudança de backend, contratos, banco ou migrations.
