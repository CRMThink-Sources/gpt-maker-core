# Design

## Context

As funções e os formulários são editados no backoffice e mudam sem deploy (`FunctionCatalog`). O cliente não escreve prompt. A página `/app/help` já existe, e a LP e `public/training-images` já são públicas. Não há acesso externo do cliente à conta dele.

## Goals / Non-Goals

**Goals:** skill de dúvidas baixável; conteúdo atual por URL pública; cópia reserva; funções geradas do banco.

**Non-Goals:** executar ações ou ler dados do cliente; substituir a Ajuda ou a ajuda da IA; conteúdo em `en`/`es`.

## Decisions

**D1. Consulta online com cópia reserva no pacote.** Alternativas: arquivo fixo no repositório (não acompanha o backoffice); gerada só no download (envelhece sem o cliente saber); só online (inútil para quem não liberar o domínio).

**D2. Módulo `help-skill`** com controller `public/help-skill` (`GET content`, `GET download`) e `index.ts`. Importa o catálogo só pelo `index.ts` de `agent-functions`. A consulta das funções abertas a todos é um método novo do `FunctionCatalog`, porque o filtro atual (`availableTo`) exige um portal.

**D3. Lista de permitidos na montagem.** O Markdown é montado campo a campo a partir de `FunctionTemplateContent`; campo novo no schema fica de fora até ser incluído de propósito. Alternativa descartada: remover campos internos de uma cópia do template (vaza o que for criado depois). `placeholder` entra (o cliente lê); `format`, `snippet`, `effects`, `assist`, `review`, `behavior`, `intentions`, `transfers`, `settings` e `profile` não.

**D4. Guia e `SKILL.md` em Markdown no módulo**, copiados para `dist/` pelos `assets` do `nest-cli.json`. A URL do conteúdo vem de `API_PUBLIC_URL` e o suporte de `PUBLIC_SUPPORT_URL` (opcional na API).

**D5. Zip em memória**, com uma biblioteca pequena (ex.: `fflate`); o pacote tem dois arquivos de texto.

**D6. Cache curto** (`Cache-Control` público) nas duas rotas, para limitar o custo de rotas anônimas. O tempo fica a cargo da implementação.

**D7. Download por link** para `apiBaseUrl + /public/help-skill/download`, em nova aba, no padrão do botão de suporte.

## Risks / Trade-offs

- [O Claude do cliente pode não conseguir buscar o conteúdo, ou exigir liberação do domínio; não testado] → cópia reserva; testar numa conta real do claude.ai antes do lançamento. O resultado define o texto de liberação do acesso. Se a busca nunca funcionar, rever D1.
- [Perguntas dos formulários ficam públicas] → aceito pelo usuário; D3 limita o que sai.
- [Funções restritas ficam fora] → a skill não sabe quem pergunta; ela indica o suporte.
- [Nomes de perguntas saem em pt-BR para quem usa `en`/`es`] → aceito nesta versão.
- [Download bloqueado pelo iframe do Bitrix] → conferir no staging.
- [Guia envelhece quando o app muda] → fica no repositório; mudança de funcionalidade deve revisá-lo.

## Migration Plan

Sem migration. Merge em `develop` publica no staging; garantir `API_PUBLIC_URL` e `PUBLIC_SUPPORT_URL` no ambiente. Reversão: rollback da imagem. Skills já baixadas passam a usar a cópia.
