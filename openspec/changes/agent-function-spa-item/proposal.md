# Proposal

## Why

Um agente de Suporte faz o primeiro atendimento com a base de conhecimento e, quando não resolve, precisa abrir um item num **processo inteligente (SPA)** do Bitrix24 com campos preenchidos a partir da conversa: origem fixa (`CHAT`), prioridade (campo lista: `LOW`, `NORMAL`, `HIGH`, `URGENT`) definida pelo agente segundo critérios do cliente, problema relatado, chat de origem (`9498`), diálogo de origem (`chat9498`) e sessão da Linha Aberta. Hoje as funções só criam lead, negócio, tarefa, comentário e processo de negócio, e os códigos dos campos de SPA (`ufCrm5_...`) mudam de portal para portal, então um template não consegue apontar para eles.

## What Changes

- Nova ação **"Criar item de SPA"** (`CREATE_SPA_ITEM`) nas intenções "Ação no Bitrix24": cria o item com `crm.item.add` no SPA, funil e etapa escolhidos, com título e campos mapeados. Campo do tipo lista recebe o id do item da lista, traduzido pelo app a partir do valor (`HIGH`) ou do mapeamento feito pelo cliente.
- Novas variáveis da conversa nas ações: `{{dialog.chatId}}` (id do chat sem o prefixo, `9498`) e `{{dialog.sessionId}}` (sessão da Linha Aberta, lida do diálogo no Bitrix24). `{{dialog.id}}` continua sendo `chat9498`.
- Novo tipo de campo da função **`BITRIX_SPA`** ("Processo inteligente do Bitrix24"): o template declara os **valores** que a função vai gravar (ex.: Origem, Prioridade, Problema relatado, Chat de origem, Diálogo de origem, Sessão), cada um com rótulo e, quando for o caso, as opções permitidas (`LOW`…`URGENT`). No formulário, o cliente escolhe o SPA, o funil e a etapa e, para cada valor, o campo do SPA que o recebe; nos valores com opções e campo lista, liga cada opção a um item da lista.
- No template, a ação usa `"spa": "{{x.spa}}"` e `values` por id do valor; a compilação troca isso pelos códigos reais do portal do cliente (`entityTypeId`, `categoryId`, `stageId`, `fields`).
- Novas checagens de publicação do template e das respostas: todo valor declarado no campo `BITRIX_SPA` é usado na ação, a ação não usa valor inexistente, e valor obrigatório precisa de campo do SPA escolhido.
- Prioridade definida pelo agente: o padrão do template é um campo coletado da intenção com as opções e os critérios do cliente na descrição (campos do formulário "Quando é urgente", etc.). Nenhuma mudança de plataforma além de as descrições dos campos coletados já aceitarem marcadores.
- Transferir depois de criar o item continua sendo o passo `TRANSFER_TO_HUMAN` na mesma intenção (operador, usuário escolhido com rodízio ou canal aberto).
- Skill `gptthink-criar-funcao` e referência (`formato.md`, `validar.mjs`) atualizadas, com um exemplo de Suporte que abre item de SPA.

## Capabilities

### New Capabilities
<!-- nenhuma: tudo entra em capacidades existentes -->

### Modified Capabilities
- `agent-function-templates`: novo tipo de campo `BITRIX_SPA` com valores declarados e a ação "Criar item de SPA" no template, com as checagens de publicação.
- `agent-function-configuration`: o formulário do cliente escolhe SPA, funil, etapa e o campo de cada valor (com o mapeamento das opções de lista); a compilação gera a ação com os códigos do portal.
- `agent-intentions`: intenção "Ação no Bitrix24" ganha a ação "Criar item de SPA" e as variáveis `dialog.chatId` e `dialog.sessionId`.

> Essas capacidades ainda vivem nos changes `agent-function-templates` e `bitrix-gptmaker-agents-platform`, não arquivados. Este change entra como requisitos adicionados e deve ser arquivado depois deles.

## Impact

- **Contratos** (`packages/contracts`): `triggers.ts` (schema da ação para intenções), `templates.ts` (variáveis), `agent-functions.ts` (campo `BITRIX_SPA`, resposta, checagens), `agent-function-compiler.ts` (tradução `spa`/`values` → ação real) e `agent-function-answers.ts`.
- **Backend**: `TriggerActionExecutor` (novo caso com `crm.item.add` e tradução de listas via `crm.item.fields`), `intention-runner.ts` (sessão e chatId no contexto), leitura da sessão no `imopenlines.dialog.get`.
- **Frontend**: seletor de SPA, funil, etapa e campos no formulário da função (`bitrix-pickers.tsx`, `function-form.tsx`, via BX24: `crm.type.list`, `crm.category.list`, `crm.status.list`, `crm.item.fields`); editor do backoffice para o campo `BITRIX_SPA` e a nova ação.
- **Skill**: `.claude/skills/gptthink-criar-funcao/` (SKILL.md, `referencia/formato.md`, `scripts/validar.mjs`, novo exemplo).
- **Bitrix24**: escopo `crm` já concedido; nenhum escopo novo. Fora do escopo: a ação nos gatilhos (só intenções) e vincular o item ao contato/empresa do diálogo.
