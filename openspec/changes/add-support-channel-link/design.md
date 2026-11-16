## Context

O app `/app` roda em iframe dentro do portal Bitrix24 do cliente. A CRMThink já mantém um canal aberto no Bitrix24.Network; o link `https://www.bitrix24.net/oauth/select/?preset=im&IM_DIALOG=networkLines<código>` leva o cliente a escolher o portal e adicionar a conversa. Motivação em `proposal.md`.

Já existem os mecanismos que esta change reaproveita:
- `app/layout.tsx` lê variáveis `PUBLIC_*` em tempo de execução e monta `config`, entregue pelo `SessionProvider` (tipo em `lib/platform-session.ts`).
- `app-shell.tsx` monta o aside a partir do array `NAV`, com filtros por papel (`adminOnly`) e por recurso (`requiresCrm`).
- `plans-section.tsx` já abre uma URL externa com `window.open(url, '_blank', 'noopener')`.
- As variáveis `PUBLIC_*` chegam ao container do frontend por `infra/docker-compose.prod.yml` e `infra/docker-compose.yml`.

## Goals / Non-Goals

**Goals:**
- Item Suporte no aside, para todos os papéis, abrindo o link em nova aba.
- URL configurável por ambiente; sem URL, sem item.

**Non-Goals:**
- Conectar o canal por REST (`imopenlines.network.join`) ou enviar mensagem de boas-vindas.
- Card na home e links de suporte nos alertas de erro.
- Qualquer mudança de backend, banco ou `@gptmaker/contracts`.

## Decisions

**D1. Link direto em nova aba (`<a target="_blank" rel="noopener noreferrer">`).**
O fluxo de OAuth do `bitrix24.net` precisa de janela de topo; dentro do iframe do Bitrix tende a ser bloqueado. Um `<a>` real, em vez de `window.open`, dá semântica de link, funciona com clique do meio e não depende de handler. Alternativa descartada: `imopenlines.network.join` via REST, que exige o escopo `imopenlines` e o código do conector e foi deixada para uma evolução.

**D2. Configuração por `PUBLIC_SUPPORT_URL`, lida em `layout.tsx`.**
Mesmo padrão de `PUBLIC_PLATFORM_URL`: lida em tempo de execução (mesma imagem em staging e produção) e repassada como `config.supportUrl: string | null` (`|| null` trata vazio). Sem valor padrão no código: o link fica só nos arquivos de ambiente, e dev local sem a variável não mostra o item.

**D3. Item no `NAV` com `href` externo, sem filtro de papel.**
`NavItem` ganha um campo para link externo (ex.: `external?: boolean`) e a renderização usa `<a>` quando for o caso, em vez do `Link` do Next. O item entra num grupo próprio no fim do `NAV`, com o título "Suporte", fora de "Configurações" (que é só admin). A visibilidade depende somente de `config.supportUrl`. O ícone vem de `components/icons.tsx` (adicionar um ícone de ajuda/chat se não houver). O item nunca fica "ativo" (`aria-current`), pois não é uma rota do app.

**D4. Textos em `shell.json`** (`support` para o rótulo e título do grupo), nos três idiomas, mantendo a paridade de chaves já testada por `i18n.test.tsx`.

## Risks / Trade-offs

- **[Passo extra de seleção de portal]** O cliente cai na tela de seleção do Bitrix24.Network, mesmo já estando logado. → Aceito na v1; a conexão por REST resolveria e fica como evolução.
- **[Link depende de um canal ativo e de um código estável]** Se o canal for recriado, o código muda. → Por ser env, a correção é só trocar a variável e reiniciar, sem deploy de código.
- **[Variável esquecida num ambiente]** O item some em silêncio. → Intencional (D2); documentar a variável nos `.env*.example` e conferir no staging.

## Migration Plan

1. Merge em `develop`: staging recebe o deploy automático; definir `PUBLIC_SUPPORT_URL` no ambiente de staging.
2. Validar no portal de teste que o item aparece e abre o canal.
3. No release para `master`, definir a variável em produção. Rollback: remover a variável (o item some) ou o workflow `Deploy` com a tag anterior.

## Open Questions

- O canal de staging deve ser o mesmo de produção ou haverá um canal de testes separado? Não bloqueia: a variável permite os dois.
