# Como o Nekt desenha ferramentas para agentes

O MCP do Nekt é um bom estudo de caso de *como expor um produto para um agente de IA* sem que ele se perca, faça besteira ou vaze segredo. Abaixo, os padrões que se repetem.

## Índice
1. Fluxo guiado com ordem explícita
2. Confirmação em duas fases (prévia → `confirm=True`)
3. Rascunho → link de configuração → validar → publicar
4. Lista curta + dispatcher para o resto
5. Descobrir em tempo de execução, nunca fixar nomes
6. Ferramentas genéricas com argumento `kind`
7. Erros que explicam
8. Decisões irreversíveis tratadas como tal
9. Uma ferramenta para "perguntar sobre o produto"
10. Resumo dos padrões

---

## 1. Fluxo guiado com ordem explícita

**Fato (docs):** a documentação descreve o caminho de consulta como uma sequência: ler o contexto de negócio → encontrar as tabelas certas → gerar SQL → executar (`get_semantic_context` → `get_relevant_tables_ddl` → `generate_sql` → `execute_sql`). O `get_semantic_context` é chamado explicitamente de "primeiro passo".

Para dados ao vivo, a ordem documentada é: `get_semantic_context` (warehouse ou ao vivo? qual conexão?) → `discover_live_tools` (nome exato e esquema) → `run_live_tool`.

**Leitura de design:** a ordem fica *na descrição das ferramentas*, não em instrução do usuário. O agente aprende o fluxo lendo as próprias ferramentas.

## 2. Confirmação em duas fases

**Fato (docs):** várias ferramentas de escrita são "two-phase": a primeira chamada devolve uma **prévia** do que seria criado ou alterado e não grava nada; só uma segunda chamada com `confirm=True` aplica. Exemplos: `create_query`, `create_notebook`, `create_layer`, `create_context_document`, `update_context_document`, `delete_context_document`, `grant_permission`, `revoke_permission`, `create_mcp_token`, `rotate_mcp_token`, `update_resource_description`.

**Fato (docs):** no `update_context_document`, a prévia mostra o conteúdo atual versus o novo. No `delete_context_document`, a prévia mostra o documento que será removido, e a documentação avisa que não há desfazer.

**Fato (docs):** ferramentas que consomem créditos (como `run_pipeline`) são confirmadas pelo assistente antes de rodar, e ferramentas ao vivo que escrevem exigem confirmação a cada chamada.

**Leitura de design:** a confirmação não depende do modelo "lembrar" de perguntar. Ela está **no contrato da ferramenta**. Sem `confirm=True`, fisicamente nada acontece. Isso é muito mais robusto do que escrever no prompt "sempre confirme antes de alterar".

## 3. Rascunho → link de configuração → validar → publicar

**Fato (docs):** novas fontes e destinos seguem um fluxo:

1. `list_connectors` / `get_connector` — descobre o conector e o esquema de configuração, incluindo **quais campos são segredos**.
2. `create_draft` — cria um rascunho (sem tabelas, sem pipeline).
3. `get_setup_link` — gera um link de 24 horas para a pessoa fazer OAuth ou digitar segredos **no navegador**. Segredos nunca passam pelo chat.
4. `validate_source_connector_config` + `check_connector_validation` — testa a conexão real e devolve o que está disponível.
5. `complete_pipeline` — finaliza: escolhe o que sincronizar, onde gravar e o gatilho.

Conectores sem campos secretos pulam o passo 3.

**Fato (docs):** o **setup link** também existe na interface, para casos em que a credencial pertence a outra pessoa (um cliente, um parceiro, o time de TI). Características:

- o destinatário **não precisa ter conta** no Nekt;
- vê só o formulário daquele conector, identificando quem pediu a conexão;
- não acessa nada do workspace;
- pode preencher só parte dos campos — o resto é completado depois ou por outra pessoa com outro link;
- o link expira em 24h e deixa de valer quando o recurso sai de rascunho.

**Fato (docs):** na Platform API existe o mesmo fluxo com **webhook de callback** avisando quando o terceiro terminou — pensado explicitamente para quem atende vários clientes, cada um com sua credencial.

**Leitura de design:** separar *quem configura* de *quem tem a credencial* é o que permite o modelo de agência/parceiro. Para um white label que atende clientes finais de parceiros Bitrix24, esse padrão é diretamente reaproveitável.

## 4. Lista curta + dispatcher para o resto

**Fato (docs):** o Nekt afirma que uma lista longa de ferramentas **piora de forma mensurável** a precisão com que o agente escolhe a ferramenta certa. Por isso nove ferramentas pouco usadas ficam fora da lista principal e são acessadas por dois dispatchers: `get_tool_details` (catálogo e esquema, incluindo se a ferramenta escreve ou é destrutiva) e `run_tool` (executa pelo nome).

**Fato (docs):** as ferramentas ao vivo (de MCPs externos anexados) **nunca** aparecem individualmente; ficam sempre atrás de `discover_live_tools` → `run_live_tool`. Se a organização não tem conexões ao vivo, até a orientação de roteamento some da lista.

**Leitura de design:** o número de ferramentas visíveis é tratado como recurso escasso. O que é frequente fica à mão; o que é raro ou variável fica atrás de um índice.

## 5. Descobrir em tempo de execução, nunca fixar nomes

**Fato (docs):** os nomes das ferramentas ao vivo são específicos de cada organização e podem mudar, então o agente deve resolvê-los em tempo de execução em vez de fixá-los numa skill ou automação. A descoberta também resolve ambiguidades — dois HubSpot conectados (Marketing e CS) aparecem como entradas separadas, e o agente pode perguntar qual usar.

**Fato (docs):** a descrição que o usuário dá a cada MCP anexado é lida pelo agente para escolher entre conexões do mesmo tipo (exemplo dado: "Slack para marketing" vs. "Slack para engenharia").

**Leitura de design:** a *descrição escrita pelo usuário* é contexto operacional. Campos de descrição não são enfeite; são instrução de roteamento.

## 6. Ferramentas genéricas com argumento `kind`

**Fato (docs):** várias ferramentas específicas foram fundidas em versões genéricas com argumento `kind` (por exemplo, `list_sources`, `list_destinations`, `list_queries` viraram `list_resources(kind=...)`). Os nomes antigos deixaram de existir, e a documentação traz uma tabela de migração.

**Leitura de design:** menos ferramentas, mais parâmetros. Reduz a lista (ver item 4) e padroniza o vocabulário. O custo é quebrar automações antigas — por isso a tabela de migração.

## 7. Erros que explicam

**Fato (docs):** quando uma consulta falha, o erro volta com uma explicação provável e não só o texto cru do motor. O exemplo dado: distinguir uma tabela que existe no catálogo mas ainda não foi materializada de um nome de tabela simplesmente errado — para o agente parar de "chutar" nomes que já estavam corretos.

**Fato (docs):** `get_pipeline_run_logs` devolve só as entradas de erro e, quando disponível, uma análise da falha feita por IA, com resumo, detalhes técnicos e sugestão de correção.

**Fato (docs):** quando não há camadas, `list_layers` diz isso explicitamente e aponta para `create_layer`, para o agente oferecer criar em vez de responder "nada encontrado".

**Leitura de design:** mensagem de erro é parte da interface do agente. Ela precisa dizer *o que fazer a seguir*.

## 8. Decisões irreversíveis tratadas como tal

**Fato (docs):** o nome de uma camada vira o nome físico do banco e é referenciado por consultas, fontes e documentos de contexto; **não pode ser renomeado**. Por isso a criação é em duas fases, a prévia mostra camadas existentes e colisões, e a documentação orienta o agente a sugerir nomes que "continuem certos daqui a um ano".

**Fato (docs):** `update_source_streams` é deliberadamente **não destrutivo**: adiciona ou edita, nunca remove streams nem apaga tabelas — isso fica para a interface web.

**Leitura de design:** o agente pode fazer muito, mas o que é irreversível ou destrutivo ou ganha atrito extra (prévia, aviso, nível de permissão maior) ou fica fora do alcance do agente.

## 9. Uma ferramenta para "perguntar sobre o produto"

**Fato (docs):** `ask_nekt` responde dúvidas sobre como a plataforma funciona a partir da documentação e devolve *playbooks* (casos de uso reais de clientes). Cada playbook é comparado com as fontes que o workspace já conectou: "pronto", "falta uma fonte" ou "ainda não". Para construir um playbook, o agente cria item por item e pede confirmação a cada um. A ferramenta **não** consulta os dados do cliente.

**Leitura de design:** o próprio produto ensina o agente a usá-lo e sugere o que construir com base no que o cliente já tem. É onboarding conduzido por agente.

## 10. Resumo dos padrões

| Padrão | Problema que resolve |
|---|---|
| Ordem explícita nas descrições | Agente pulando etapas (ex.: gerar sem ler contexto) |
| Duas fases com `confirm` | Escrita acidental; confirmação que depende do modelo lembrar |
| Rascunho + setup link | Segredo no chat; credencial que pertence a terceiros |
| Lista curta + dispatcher | Queda de precisão com muitas ferramentas |
| Descoberta em tempo de execução | Nomes que mudam; múltiplas conexões do mesmo tipo |
| `kind` genérico | Explosão de ferramentas parecidas |
| Erros explicativos | Agente em loop de tentativa e erro |
| Atrito no irreversível | Dano permanente feito por agente |
| `ask_nekt` + playbooks | Usuário que não sabe o que construir |

## Fontes

- https://docs.nekt.com/mcp-server/tools.md
- https://docs.nekt.com/sources/share-setup-link.md
- https://docs.nekt.com/mcps/overview.md
