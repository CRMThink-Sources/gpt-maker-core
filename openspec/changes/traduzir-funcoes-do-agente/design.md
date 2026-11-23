# Design

## Context

O formulário da função é o `FunctionTemplateContent` (`packages/contracts/src/agent-functions.ts`): `fields` (com `label`, `help`, `placeholder`, `options[].label`, `subfields[].label`, `values[]` de SPA e `assist.questions`), mais `behavior`, `intentions` e `transfers`, que vão para o GPTMaker. O rascunho (`draft`) e a versão publicada (`content`) são `jsonb`; blocos compartilhados são expandidos para dentro da versão (`expandBlocks`/`collapseBlocks`). `name` e `description` ficam em colunas do template. O app lê tudo por `GET /app/agent-functions`, `GET /app/agent-functions/:code` e `GET /app/agents/:id/function` (campo `form`). O idioma da interface vive só no navegador (spec `app-i18n`), e a API não recebe idioma hoje.

## Goals / Non-Goals

**Goals:**
- Formulário das funções inteiro em `pt-BR`/`en`/`es` na criação e na edição do agente.
- Traduções editáveis no backoffice, versionadas com a publicação, sem migration.
- Funções novas criadas depois já nascem traduzíveis.

**Non-Goals:**
- Traduzir `behavior`, `snippet`, `format`, intenções, transferências e treinamentos (texto do agente).
- Traduzir `review.rubric`/`examples` e `assist.instructions`: só a IA lê.
- Tradução automática por IA dentro do backoffice.
- Idioma de fala do agente por tenant.

## Decisions

1. **Camada de tradução em `content.translations`**, não campos `label_en` espalhados. Estrutura, por idioma, chaveada por **id** (não por posição, para sobreviver a reordenação):
   ```
   translations?: { en?: TemplateTranslation; es?: TemplateTranslation }
   TemplateTranslation = {
     name?, description?,
     fields?: Record<fieldId, {
       label?, help?, placeholder?,
       options?: Record<optionValue, string>,        // rótulo da opção
       subfields?: Record<subfieldId, string>,       // rótulo
       spaValues?: Record<valueId, { label?, help? }>,
       assistQuestions?: string[]
     }>
   }
   ```
   Opções dependentes (`dependents`) são campos com id próprio, então entram no mesmo mapa `fields`. Alternativa descartada: duplicar cada string em um objeto `{ 'pt-BR', en, es }`, que muda o formato de todo campo e quebra os templates e testes existentes.
2. **`name` e `description` dentro de `translations`** (versionados), e a lista de funções do app lê a última versão publicada. A coluna continua sendo o texto em português.
3. **Resolução no backend, numa função pura em `packages/contracts`** (`localizeTemplateContent(content, locale)`), aplicada nos três endpoints do app antes de responder. O frontend recebe o `form` já no idioma e o JSON enviado não carrega `translations`. Alternativa descartada: mandar tudo e resolver no navegador, que vaza texto de outros idiomas e duplica a lógica no admin e no app.
4. **Compilação e publicação continuam lendo o texto-base.** O compilador, a revisão e a sandbox usam o conteúdo sem localizar, então o que vai ao GPTMaker não depende do idioma e as respostas são idênticas entre idiomas.
5. **Idioma pela requisição:** o cliente de API do `/app` envia `Accept-Language` com o idioma ativo; o backend normaliza com `isLocale` (qualquer outro valor cai em `pt-BR`). Não usa o `locale` do tenant, que é o idioma das notificações e pode diferir do idioma da tela. O app recarrega as funções ao trocar de idioma e preserva as respostas locais, que são por id.
6. **Blocos:** `functionBlockContentSchema` ganha `translations` com o mesmo formato; `expandBlocks` mescla as traduções do bloco nas do template (ids de campo são únicos no template expandido) e `collapseBlocks` faz o caminho inverso.
7. **Validação** (`templateIssues`): erro (`templateIssues`) para id de campo/opção/subcampo/valor de SPA inexistente nas traduções. O estouro do limite do original (`label` 120, `help` 300, `placeholder` 200) é recusado pelo próprio schema zod estrito das traduções, com o mesmo efeito (rascunho não salva nem publica). Falta de tradução é só **aviso** de completude (por idioma), nunca erro.
8. **Backoffice:** aba "Traduções" no editor com seletor `en`/`es`, uma linha por texto traduzível mostrando o português como referência, contador de pendências por idioma e filtro "só o que falta".
9. **Seed:** as traduções das quatro funções e dos blocos ficam em arquivos do seed (`seed/translations/`), mescladas ao rascunho e à versão. Para templates já publicados no banco e editados no backoffice, o seed **não** sobrescreve o conteúdo: preenche `translations` só quando o template (ou bloco) não tem nenhuma. Na função, só o rascunho muda e um operador publica a nova versão; no bloco, rascunho **e** conteúdo publicado recebem as traduções, porque é o conteúdo do bloco que entra nas próximas versões das funções (as versões já publicadas guardam o bloco expandido e não mudam).

10. **Skills e validador acompanham o contrato.** O `validar.mjs` é uma cópia independente da checagem do backoffice (sem dependências), então precisa reproduzir as regras novas de `translations` (id inexistente e limites = erro; falta de tradução = aviso). A referência e os exemplos continuam sendo gerados do seed (`gerar-referencia.ts`), que já passa a incluir as traduções; os exemplos escritos à mão ganham `translations` manualmente. A cópia da skill nas skills pessoais fica fora do repositório e é atualizada à mão.

## Risks / Trade-offs

- **Validador e contrato podem divergir:** como o `validar.mjs` duplica as regras, a tarefa 6.6 valida os exemplos contra ele, e o backoffice continua tendo a palavra final.

- **Template já editado em produção diverge do seed:** as traduções do seed são por id; se o operador renomeou ou removeu campos, parte delas não casa. Mitigado pelo aviso de id inexistente e pela aba de pendências; revisar em staging antes de publicar.
- **Qualidade da tradução:** en/es escritos por nós, sem revisão nativa. Para o marketplace basta estar traduzido; vale revisar o espanhol com alguém do time.
- **Versão só de traduções:** publicar apenas traduções sobe `latestVersion` e aciona o aviso "atualização disponível" nos agentes existentes; republicar não muda o que vai ao GPTMaker (a compilação lê o texto-base). Aceito.
- **Funções já publicadas ficam em português até republicar:** o seed só preenche o rascunho de função existente (e o conteúdo do bloco); um operador precisa publicar a nova versão das 4 funções em staging e produção.
- **Mais manutenção por função nova:** cada campo novo pede três textos. O contador de pendências no backoffice reduz o esquecimento, e o fallback para português evita tela quebrada.
- **Texto do agente segue em português:** quem testar o agente em inglês verá respostas guiadas por instruções em português. Aceito nesta change e registrado como decisão de produto à parte.
- **Cabeçalho novo em todas as chamadas:** inofensivo, mas precisa constar no CORS do ambiente, se a lista de cabeçalhos permitidos for fechada.
