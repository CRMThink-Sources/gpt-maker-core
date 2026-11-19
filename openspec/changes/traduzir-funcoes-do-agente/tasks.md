# Tasks

## 1. Contratos

- [x] 1.1 Definir `functionTranslationsSchema` (`en`/`es` → `TemplateTranslation`) e adicionar `translations` opcional a `functionTemplateContentSchema` e `functionBlockContentSchema`
- [x] 1.2 Criar `localizeTemplateContent(content, locale)` e `localizeFunctionText(name, description, translations, locale)` (puras, com volta ao português por texto) e testes: idioma completo, parcial, ausente, não suportado, opções dependentes, subcampos, SPA e perguntas do assistente
- [x] 1.3 Atualizar `expandBlocks`/`collapseBlocks` para mesclar e separar as traduções dos blocos, com testes de ida e volta
- [x] 1.4 Estender `templateIssues` com erro para id inexistente e estouro de limite, e expor a completude por idioma (textos traduzíveis × traduzidos) como aviso, com testes
- [x] 1.5 Rodar `npm run build -w @gptmaker/contracts`

## 2. Backend

- [x] 2.1 Ler o idioma de `Accept-Language` (normalizado com `isLocale`, padrão `pt-BR`) num decorator/helper do `/app`
- [x] 2.2 Aplicar a localização em `GET /app/agent-functions`, `GET /app/agent-functions/:code` e no `form` de `GET /app/agents/:id/function`, sem localizar o que alimenta a compilação, a revisão e a publicação
- [x] 2.3 Garantir que `translations` não altera o hash/diff de comportamento nem o orçamento de 3000 caracteres, e que salvar/publicar no backoffice persiste e valida as traduções
- [x] 2.4 Verificar a lista de cabeçalhos permitidos no CORS do ambiente para `Accept-Language`
- [x] 2.5 Testes: unitários do helper (`Accept-Language` em `pt-BR`, `en`, `es`, variantes e inválidos) e do CORS; integração da localização no serviço (lista, `form` e configuração do agente existente) com idioma, fallback e tradução inválida recusada

## 3. Seed

- [x] 3.1 Traduzir para `en` e `es` as funções SDR, Suporte, Agendamento e Pós-venda e os blocos compartilhados (`seed/translations/`)
- [x] 3.2 Fazer o seed preencher `translations` só em template sem nenhuma, sem tocar no conteúdo editado; teste do seed e do `seed.test.ts` existente
- [x] 3.3 Teste de completude: nenhuma função do seed fica com texto sem tradução em `en` ou `es`

## 4. Frontend do app

- [x] 4.1 Enviar `Accept-Language` com o idioma ativo no cliente de API do `/app`
- [x] 4.2 Recarregar a lista e o formulário das funções ao trocar de idioma, preservando as respostas locais (por id)
- [x] 4.3 Testes: cabeçalho `Accept-Language` no cliente de API e recarga do assistente de criação ao trocar de idioma sem perder o que foi digitado

## 5. Backoffice

- [x] 5.1 Criar a aba Traduções no editor de função e de bloco (seletor `en`/`es`, português como referência, contador de pendências, filtro "só o que falta")
- [x] 5.2 Mostrar os avisos de completude na publicação sem bloquear
- [x] 5.3 Testes de componente da aba: editar, contar pendências e salvar

## 6. Skills e agente de autoria de funções

- [x] 6.1 Atualizar `.claude/skills/gptthink-function-templates/SKILL.md` com o modelo de `translations` (formato por id, o que traduz e o que não traduz, fallback para português, limites, aviso de completude) e a regra de que o texto do agente (`behavior`, `snippet`, `format`, intenções) segue em português
- [x] 6.2 Atualizar `.claude/skills/gptthink-criar-funcao/SKILL.md` e `referencia/formato.md`: todo JSON novo sai com `translations` em `en` e `es`, com um passo de conferência de completude antes de entregar
- [x] 6.3 Estender `scripts/validar.mjs` para validar `translations` como o backoffice: id de campo/opção/subcampo/valor de SPA inexistente e limites de tamanho viram erro, e texto sem tradução em `en`/`es` vira aviso com a contagem por idioma
- [x] 6.4 Rodar `gerar-referencia.ts` para regenerar `referencia/blocos.json` e os exemplos `suporte.json` e `sdr.json` já com traduções, e acrescentar `translations` à mão em `cobranca.json`, `recepcao.json`, `agendamento-calendario.json` e `suporte-spa.json`
- [x] 6.5 Atualizar `.claude/agents/autor-funcao-agente.md` (passo de entregar o JSON com traduções e o aviso do validador no relatório final)
- [x] 6.6 Validar os exemplos e uma função nova de teste com `validar.mjs` (OK e aviso de falta de tradução funcionando)
- [ ] 6.7 Registrar no PR que existe cópia da skill fora do repositório (`gptthink-criar-funcao-2`, nas skills pessoais) que precisa ser atualizada à mão

## 7. Verificação e publicação

- [x] 7.1 Rodar `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run depcruise`, `npm test` e `npm run test:integration -w backend` (feito nos arquivos tocados: prettier/eslint limpos, typecheck e depcruise ok, 351 testes de contratos, 995 do backend, 426 do frontend e 897 de integração passando, `npm run build` ok; o `format:check`/`lint` globais seguem com o ruído conhecido do CLAUDE.md)
- [ ] 7.2 Conferir no navegador a criação e a edição de agente em `pt-BR`, `en` e `es`, e a aba do backoffice
- [x] 7.3 Rodar `revisor-codigo`, `revisor-frontend` e `especialista-openspec` e tratar os achados
- [ ] 7.4 Revisar o texto das traduções en/es com o time (principalmente o espanhol)
- [ ] 7.5 Depois do merge, publicar a nova versão das 4 funções no backoffice do staging e da produção (o seed só preenche o rascunho de função já publicada) e conferir o formulário em `en` e `es`
