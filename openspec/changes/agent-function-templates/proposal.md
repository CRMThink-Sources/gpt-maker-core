# Proposal

## Why

O cliente configura o agente numa folha em branco: escreve o comportamento (prompt de até 3000 caracteres) e os treinamentos sem saber engenharia de prompt. Na prática mistura regra com conhecimento, escreve instruções contraditórias ou cria agentes que fazem tudo, e o agente passa a se comportar de forma desagradável. Os agentes atuais são de teste, então dá para trocar o modelo de configuração agora, sem migração.

## What Changes

- O agente passa a ter uma **função** (SDR/Qualificação, Suporte, Agendamento, Pós-venda). O cliente escolhe a função e responde a um **formulário** sobre o negócio; ele não escreve mais instruções.
- **Templates de função no backoffice**: cada função é um template com o texto do comportamento (escrito pela CRMThink) e a definição do formulário. Templates têm rascunho, versões publicadas imutáveis, teste em agente de sandbox, validação de orçamento (pior caso ≤ 3000 caracteres) e rollback.
- **Compilação**: o sistema monta comportamento, treinamentos de texto, intenções e settings a partir do template + respostas, mostra o diff e só então grava no GPT Maker. Cada agente fixa a versão do template; uma versão nova só entra quando o cliente republica.
- **Escolha carrega o texto**: opções do formulário trazem o trecho que vai para o comportamento; sem lógica condicional no texto. Campos dependentes aparecem só quando a opção é escolhida.
- **Blocos compartilhados** entre funções: bloco comum do formulário, "onde registrar", "abrir chamado / registrar dúvida" e "transferir para atendente".
- **"Não sei" como ação explícita**: a intenção "Registrar dúvida" substitui a dependência do evento `onLackKnowLedge`, que não dispara na prática.
- **Modos**: simples (padrão), avançado (ligado pelo cliente com aviso: instruções adicionais de até 400 caracteres + treinamento por site e vídeo) e assumir controle (só tenants parceiros: edição livre do comportamento compilado, com volta ao formulário perdendo as edições).
- **BREAKING**: o campo livre de comportamento sai da criação e da edição do agente no modo simples; `type` passa a ser derivado da função.
- **BREAKING**: treinamento por documento (`DOCUMENT`) é removido; site e vídeo ficam restritos ao modo avançado; no modo simples a base de conhecimento é feita só por itens estruturados do formulário.
- Agentes existentes (de teste) são descartados.

## Capabilities

### New Capabilities
- `agent-function-templates`: templates de função mantidos no backoffice — definição do formulário (tipos de campo, opções com trecho, campos dependentes, itens da base), texto do comportamento com marcadores, blocos compartilhados, rascunho e versões imutáveis, validação de orçamento, sandbox e rollback.
- `agent-function-configuration`: configuração do agente pela função — escolha da função, formulário, compilação, prévia com diff, publicação no GPT Maker, versão fixada e aviso de versão nova, itens da base como treinamentos, intenções e settings gerenciados, modos simples/avançado/assumir controle.

### Modified Capabilities
- `agent-management`: criação e edição passam pela função e pelo formulário; comportamento e `type` deixam de ser informados pelo cliente no modo simples.
- `agent-training`: remove `DOCUMENT`; `WEBSITE` e `VIDEO` só no modo avançado; treinamentos gerados pela função não são editados pela tela de treinamentos.
- `agent-intentions`: intenções geradas pela função são gerenciadas pelo sistema e somente leitura para o cliente.
- `admin-backoffice`: área de templates de função e marcação de tenant como parceiro.

> As capacidades modificadas ainda vivem no change `bitrix-gptmaker-agents-platform`, que não foi arquivado. Este change deve ser arquivado depois dele.

## Impact

- **Backend**: novo módulo de templates de função (backoffice) e de compilação/publicação; `agents`, `training` e `intentions` passam a aceitar recursos gerenciados; novas tabelas (template, versão, configuração do agente, mapa item ↔ treinamento/intenção); migração Drizzle; flag de parceiro no tenant.
- **Frontend**: assistente de criação por função, formulário dinâmico com contador de caracteres, tela de prévia/diff, aviso de versão nova, modos avançado e assumir controle; nova área de templates no `/admin`.
- **Contratos** (`packages/contracts`): schemas zod da definição de template, das respostas do formulário e da prévia; `createAgentSchema`/`updateAgentSchema` mudam.
- **GPT Maker**: mesmos endpoints (agente, settings, treinamentos `TEXT`, intenções); mais escritas por publicação.
- **Dados**: agentes e treinamentos de teste atuais são descartados.
