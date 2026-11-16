# LP pública do GPTThink — desenho

Data: 2026-11-16 · Status: aguardando aprovação

## Intenção e porquê

Criar a landing page pública do GPTThink, no mesmo padrão da `https://hubthink.crmthink.com.br/lp/thinkzap`, para que as LPs dos apps da CRMThink tenham a mesma estrutura.

Quem chega: (1) quem acabou de instalar o app e precisa saber o que fazer agora; (2) quem quer conhecer o aplicativo. Por isso os "Primeiros passos" têm mais peso aqui do que na ThinkZap.

## Objetivos

- Rota pública `/lp/gptthink` (pt-BR) e `/lp/gptthink/en`, `/lp/gptthink/es`, dentro do frontend deste repositório.
- Mesma estrutura da ThinkZap: cabeçalho com âncoras e seletor de idioma, hero com mockup de conversa, grade de benefícios, Primeiros passos (tutorial simulado em abas, como os tutoriais da ThinkZap), FAQ, CTA final, rodapé.
- Páginas estáticas, no idioma certo desde o primeiro byte, com metadados (título, descrição, `hreflang`).
- Textos nos três idiomas, no mesmo sistema de mensagens que o app já usa.

## Não objetivos

- Sem preços, depoimentos, formulário ou captura de leads (a ThinkZap também não tem).
- Sem capturas de tela reais do produto: os mockups são desenhados em JSX/Tailwind.
- Sem alterar o `/app`, o `/admin`, o `I18nProvider` ou o redirecionamento de `/`.
- Sem tema escuro.

## Anti-objetivos (seria falha mesmo funcionando)

- A LP depender de `BX24`, sessão do Bitrix ou qualquer chamada ao backend.
- Texto prometendo funcionalidade que o produto não tem.
- Mostrar planos, preços ou créditos específicos (o plano só existe com `plan_entitlement` cadastrado no backoffice).

## Restrições

- Next.js 16: conferido em `node_modules/next/dist/docs/` (segmentos dinâmicos, `params` assíncrono, `generateStaticParams`).
- `/app` usa `I18nProvider` com `BX24`; a LP não pode usá-lo. Ela usa `landingT(locale)` (`createTranslator` sobre `MESSAGES`, sem `'use client'`) em componentes de servidor; o `createT` de `@/i18n` não serve porque aquele módulo é `'use client'`.
- Testes de frontend obrigatórios para comportamento novo; textos em pt-BR como fonte, com o teste de paridade garantindo `en` e `es`.
- Comentários e commits em português. Branch nova a partir de `develop` (ver "Entrega").

## Abordagens consideradas

- **A. Idioma na URL (escolhida pelo usuário):** `/lp/gptthink`, `/lp/gptthink/en`, `/lp/gptthink/es`. Estática, sem piscar, boa para buscadores e links compartilhados. Mais rotas para manter.
- **B. Uma URL com seletor no cliente:** mais simples, mas carrega em pt-BR e troca depois, e buscadores só veem pt-BR. Descartada.

## Desenho

**Rotas**

- `frontend/src/app/lp/gptthink/page.tsx` → renderiza a LP em `pt-BR`.
- `frontend/src/app/lp/gptthink/[locale]/page.tsx` → `generateStaticParams` devolve `en` e `es`; `dynamicParams = false`, então qualquer outro valor (inclusive `pt-BR`) responde 404. Meu critério: `pt-BR` só vive na URL sem sufixo, para não haver duas URLs do mesmo conteúdo.
- Ambas usam o mesmo componente `GptthinkLanding({ locale })` e `generateMetadata` próprio (título, descrição, `alternates.languages` com as três URLs).
- Layout raiz fixa `lang="pt-BR"`; a LP envolve o conteúdo em `<div lang={locale}>` (meu critério, para não mexer no layout raiz).

**Componentes** (`frontend/src/components/landing/`)

- Servidor: cabeçalho, hero (com mockup de conversa), grade de funcionalidades, FAQ (`<details>` nativo), CTA final, rodapé.
- Cliente (únicos): abas de "Primeiros passos" (aba ativa + Voltar/Próximo, "Passo X de N") e menu do seletor de idioma (links `<a>` para as três URLs, aba ativa marcada com `aria-current`). Recebem os textos por props.

**Textos**

- Namespace novo `landing` em `frontend/src/i18n/messages/{pt-BR,en,es}/landing.json`, registrado em `config.ts`.
- Rascunho escrito por mim a partir do código e da skill do GPTMaker Conector; o usuário revisa.

**Conteúdo**

1. Cabeçalho: Funcionalidades · Primeiros passos · Dúvidas · seletor · "Instalar".
2. Hero: "Agentes de IA dentro do Bitrix24"; CTA "Instalar no Bitrix24" e "Ver primeiros passos".
3. Funcionalidades (cards): agentes, treinamento, intenções, funções prontas (SDR, Suporte, Agendamento…), ações no CRM, transferência para humano, fora do horário, chat de teste, créditos por uso.
4. Primeiros passos (tutorial simulado: janela do navegador com a tela do Bitrix24/app e destaque laranja clicável): Instalação · Criar o agente · Treinar · Intenções e funções · Canal aberto · Créditos e plano.
5. Dúvidas frequentes (cerca de 6).
6. CTA final e rodapé "GPTThink · © 2026".

**Visual:** tema claro, cor `brand` (violeta) já definida em `globals.css`, tipografia do sistema, mobile primeiro, sem imagens externas.

**Link de instalação:** constante `GPTTHINK_MARKET_URL` em `frontend/src/lib/` com marcador. O link real do Market do Bitrix24 ainda não foi informado.

## Testes

- Abas: trocar de aba, Voltar/Próximo, limites do primeiro e último passo.
- Seletor de idioma: três links corretos e idioma atual marcado.
- Página: cada idioma renderiza o hero e o `lang` correto; `en`/`es` existem e valor inválido dá 404.
- Paridade de chaves `landing` entre idiomas (já coberta pelo teste de i18n existente).

## Entrega

- Branch nova `feat/lp-gptthink` a partir de `develop` atualizada (a branch atual `feat/canal-suporte-link` tem arquivos do OpenSpec pendentes e não deve receber isso).
- Fluxo OpenSpec do projeto: este documento alimenta o `/opsx:propose`.
- Verificação final: `npm run build -w @gptmaker/contracts`, `format:check`, `lint`, `typecheck`, `depcruise`, `npm test`, `npm run build` (rota nova do Next).

## Deixado para quem constrói

- Estrutura exata das abas e dos textos dos passos.
- Escolha dos ícones dos cards (SVG inline simples).
- Redação final do FAQ.
- Confirmar que a infra (Caddy) já encaminha `/lp/*` ao frontend; se houver regra por prefixo, ajustar.
