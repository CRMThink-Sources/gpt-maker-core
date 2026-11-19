# Design

## Context

O menu do `/app` é a constante `NAV` em `frontend/src/app/app/app-shell.tsx`: grupos com `titleKey` e itens com `href`, `match`, `adminOnly`, `requiresCrm` e `external`. O filtro de visibilidade e a remoção de grupos vazios já existem. Textos vêm de `shell.json` (`useT('shell')`) e cada página tem seu dicionário (`aiKey.json`, `notifications.json`...) em `pt-BR`, `en` e `es`, com paridade de chaves exigida pela spec `app-i18n`. A URL de suporte vem de `config.supportUrl` (spec `support-channel`). Este Next.js tem breaking changes (`frontend/AGENTS.md`): conferir `node_modules/next/dist/docs/` antes de criar a rota.

## Goals / Non-Goals

**Goals:**
- Reorganizar o menu em principal / Configurações / Avançado / Suporte sem mudar rotas nem permissões.
- Página `/app/help` estática, em três idiomas, com guia, FAQ e atalho de suporte.

**Non-Goals:**
- Backend, contratos, banco, busca no conteúdo da ajuda, CMS ou conteúdo editável pelo backoffice.
- Mover ou renomear as rotas `/app/crm` e `/app/ai-key` (links existentes em `hallucination-modal.tsx` e `review-ui.tsx` continuam válidos).
- Ajuda para o `/admin`.

## Decisions

1. **Só editar `NAV`.** Criar o grupo `advanced` (`titleKey: 'advanced'`) com `crm` e `aiKey`; remover esses itens dos grupos antigos. O filtro atual já cobre `adminOnly`/`requiresCrm` e grupo vazio, então não há lógica nova. Alternativa descartada: submenu recolhível, que pede estado e acessibilidade extras sem necessidade para 2 itens.
2. **Ajuda no grupo Suporte, antes do link externo.** Item interno (`href: '/app/help'`, `match` por prefixo), sem `adminOnly`. Mantém junto o que é "preciso de ajuda" e o link externo continua independente da página (o item Ajuda sempre aparece; o link só com `supportUrl`).
3. **Conteúdo no dicionário `help.json`**, não em JSX. Estrutura: `title`, `intro`, `steps[]` (primeiros passos) e `topics[]` com `faq[]` (`q`/`a`). A página itera sobre esses arrays via `useT('help')` com `t.raw`, para que adicionar pergunta seja só editar os três JSONs. Teste de paridade de chaves já existente em `i18n.test.tsx` cobre os novos arquivos; conferir que ele varre `help.json` automaticamente, senão registrar o namespace em `config.ts`.
4. **FAQ com `<details>/<summary>` nativos:** acessível por padrão, recolhido ao abrir, sem estado em React.
5. **Botão de suporte na página** reutiliza o mesmo padrão do menu (`<a target="_blank" rel="noopener noreferrer">`, `config.supportUrl`), via `buttonClass` de `components/ui`.
6. **Ícone:** adicionar `HelpIcon` (círculo com interrogação) em `components/icons.tsx`, no padrão dos demais.
7. **Conteúdo inicial** escrito a partir do skill/guia do GPTMaker Conector e das specs vivas (treinamento, créditos, canal aberto, transferência); revisar com o time antes do release.

## Risks / Trade-offs

- **Conteúdo desatualizado:** FAQ estática envelhece com o produto → mitigado por viver só em JSON de i18n (edição barata); pode virar item de checklist de release.
- **Descoberta do CRM/Vibecode:** quem estava acostumado a achar os itens nos lugares antigos precisa reaprender → aceito; títulos e rotas permanecem.
- **Tradução:** três idiomas dobram o custo de revisão do texto → manter respostas curtas.
