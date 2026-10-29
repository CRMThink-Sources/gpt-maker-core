# Tasks

## 1. Apoio em `lib/crm.ts`

- [x] 1.1 Adicionar `CRM_ENTITY_USAGE` (frase de uso por entidade, conforme design §4) e verificar que `npm run typecheck` do frontend passa
- [x] 1.2 Adicionar `buildAgentPreview(fields)` com valores de exemplo por tipo (design §2) e cobrir em `frontend/src/lib/crm.test.ts`: lista usa o primeiro valor aceito, booleano usa "Sim", tipo desconhecido usa "…", só campos expostos entram e a descrição vazia é omitida; verificar com `npm test -w frontend`

## 2. Tela "CRM para o agente"

- [x] 2.1 Remover a aba Funis (`PipelinesTab`, `'pipelines'` em `Tab`, `STAGE_TONES`, imports órfãos) e trocar a mensagem de sucesso para "Campos atualizados do Bitrix24."; verificar que lint e typecheck passam sem imports não usados
- [x] 2.2 Adicionar o bloco "Como funciona" com os dois passos, abaixo do cabeçalho; verificar visualmente no app do portal de desenvolvimento
- [x] 2.3 Mostrar a frase de `CRM_ENTITY_USAGE` no topo de cada aba de entidade; verificar nas quatro abas
- [x] 2.4 Em `FieldSummary`, tirar o código da linha e colocá-lo como `title` do nome; verificar que o modal de adicionar ainda encontra o campo buscando pelo código
- [ ] 2.5 Trocar o link "+ Adicionar descrição" pelo aviso de descrição faltando (com botão para quem pode alterar, só texto para quem consulta); verificar nos dois perfis
- [ ] 2.6 Adicionar o card "O que o agente recebe" abaixo da lista, usando `buildAgentPreview`, com o estado vazio "O agente não recebe dados de {entidade}"; verificar que ele muda na hora ao remover um campo e ao salvar uma descrição

## 3. Ajustes depois da conferência no portal

- [x] 3.1 Mostrar o aviso de descrição faltando só em campos personalizados; nos padrão, o link discreto; verificar no portal que "Sobrenome" não tem aviso e um campo `UF_*` sem descrição tem
- [x] 3.2 Valores de exemplo por código para campos padrão conhecidos em `buildAgentPreview`, com teste em `crm.test.ts` (padrão conhecido usa o valor próprio, personalizado de texto continua "Exemplo"); verificar com `npm test -w frontend`

## 4. Verificação integrada

- [x] 4.1 Abrir a tela no portal de desenvolvimento (crmthinkers.bitrix24.com.br, app 692), percorrer os cenários do delta de `crm-semantic-layer` e conferir que não há aba Funis e que Funil e Etapa continuam na aba Negócio
- [x] 4.2 Rodar `openspec validate crm-painel-intuitivo --strict` e verificar que passa
