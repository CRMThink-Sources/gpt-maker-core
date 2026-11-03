# Proposal

> **Depende de `agent-knowledge-review` e `agent-knowledge-gaps`**, cujo frontend já está
> implementado: esta mudança só reorganiza como o cliente **aplica** o resultado que elas produzem.
> Não muda backend, contratos nem cobrança.

## Why

A revisão por IA devolve muito: sugestões de texto por item, lacunas com itens novos e contradições.
Hoje tudo isso fica espalhado pelo formulário e pelo painel. Com 10 campos revisados e 6 lacunas, o
cliente rola a tela caçando onde há "Aplicar" ou "Adicionar", não vê o que mudou e não tem como
completar os `[preencher: …]` sem sair do resultado. Foi o teste real no Suporte com SPA que mostrou
isso: o conteúdo é bom, o caminho até ele é que cansa. Um fluxo guiado, um item por vez, transforma
"ler o relatório" em "decidir sim ou não" e aumenta quanto do resultado a pessoa de fato aproveita.

## What Changes

- **Assistente em modal** que abre quando a revisão termina e pode ser reaberto pelo botão
  "Aplicar sugestões (N)". Percorre uma fila, um item por vez, em três blocos:
  1. sugestões de texto dos campos (problema e texto sugerido);
  2. lacunas da base, cada uma com um item novo;
  3. contradições, como passo informativo que leva ao campo.
- **Cada passo** mostra o caminho (campo › item), o problema, **ANTES e SUGERIDO lado a lado** com
  as diferenças destacadas por palavra, e as ações **Aplicar**, **Editar** (ajusta o texto antes de
  aplicar, com contador e limite), **Pular** e **Voltar**.
- **Lacunas com marcador**: cada `[preencher: …]` do rascunho vira um campo nomeado para o cliente
  completar. O item entra no formulário já preenchido; adicionar com marcador pendente continua
  possível, com aviso de que a publicação será recusada.
- **Andamento e fechamento**: progresso "4 de 17", atalhos de teclado (Enter aplica, seta para a
  direita pula, Esc fecha), e um **resumo final** com o que foi aplicado, pulado e adicionado, os
  marcadores ainda pendentes e o link para cada campo.
- **Acessível e responsivo**: foco preso no modal, anúncio do passo para leitor de tela e layout
  em coluna no celular.
- O resultado inline no formulário continua existindo; o assistente é uma segunda porta, não uma
  substituição.

Fora desta mudança: backend, contratos, cobrança, novo tipo de sugestão, persistir o resultado ou o
progresso do assistente, e desfazer depois de fechar (o rascunho do formulário já cobre, pois nada é
publicado até o cliente publicar).

## Capabilities

### New Capabilities
- `agent-review-wizard`: fluxo guiado para aplicar o resultado da revisão por IA, item a item, com
  edição, preenchimento de marcadores, atalhos, acessibilidade e resumo.

### Modified Capabilities
<!-- Nenhuma em openspec/specs: as capabilities de revisão ainda estão em mudanças ativas. -->

## Impact

- **Frontend**: componente novo do assistente e a fila de passos em `frontend/src/app/app/agents`,
  usando o `Modal` existente; ligação em `[id]/function/page.tsx`; ajustes pequenos no painel de
  revisão (botão de abrir). Reaproveita `canApply`, `canAddGap`, `withSuggestion`, `withGapItem` e
  o estado do `useFunctionReview` (`applied`, `gapAdded`).
- **Backend, contratos, banco, cobrança**: nenhum.
