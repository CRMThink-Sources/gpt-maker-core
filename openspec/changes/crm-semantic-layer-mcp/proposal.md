## Why

Hoje o agente atende às cegas: o `buildRequest` do canal (`backend/src/modules/channel/conversation.service.ts`) envia ao GPTMaker apenas `contextId`, `chatName`, o texto e o primeiro anexo — nenhum dado do CRM. O agente não sabe quem é o cliente, em que etapa está o negócio nem o que já foi comprado, e o valor percebido do produto fica limitado a "um chat que responde com base no treinamento". O GPTMaker permite dar ferramentas ao agente (intenções e servidores MCP); expor o CRM por elas, com uma camada semântica que traduz os campos técnicos do Bitrix (`UF_CRM_*`, `C3:PREPARATION`, ids de listas) para conceitos de negócio do próprio cliente, deixa o agente consultar o contexto sob demanda, sem inflar cada prompt.

## What Changes

- **Camada semântica do CRM no backend**: catálogo por tenant das entidades e campos que o agente pode ler (lead, negócio, contato, empresa), com rótulo amigável, descrição de significado escrita pelo cliente, tipo e valores aceitos (listas, booleanos, funis e etapas resolvidos por nome). A tradução hoje feita só no frontend (`frontend/src/lib/crm-fields.ts`) passa a existir no backend.
- **Ferramentas do agente sobre o CRM, somente leitura, em modelo híbrido** (o spike mostrou que a chamada MCP do GPTMaker não identifica a conversa; ver `docs/gptmaker-mcp.md`):
  - **Intenção de sistema "Consultar cliente no CRM"**: o GPTMaker preenche `{{chat_id}}`, então o app identifica com segurança o cliente vinculado à conversa da Linha Aberta e devolve seus dados e negócios em andamento, com uma referência assinada.
  - **Servidor MCP próprio** com `negocios_do_cliente` (a partir da referência) e `etapas_do_funil`.
  - Toda saída usa rótulos e valores traduzidos; o agente nunca vê códigos técnicos e só recebe campos que o cliente expôs.
- **Ativação por agente**: o app cria no GPTMaker, pela API, a conexão MCP e a intenção de sistema, com uma credencial exclusiva do agente; desativar remove as duas e invalida a credencial.
- **Tela no painel**: catálogo do tenant para escolher os campos expostos e descrever o significado de cada um, e chave por agente para ativar o acesso ao CRM.
- Fora do escopo: ferramentas de escrita no CRM (fase 2), localizar cliente por telefone ou e-mail informado na conversa (permitiria consultar dados de terceiros), e débito de créditos por chamada de ferramenta. Os gatilhos e as intenções do cliente não mudam.

## Capabilities

### New Capabilities
- `crm-semantic-layer`: catálogo por tenant de entidades e campos do CRM expostos ao agente, com rótulos, descrições de significado, tipos, valores aceitos, funis e etapas; tradução de código para conceito; configuração pelo painel.
- `agent-crm-tools`: ativação do CRM por agente (credencial, intenção de sistema e conexão MCP no GPTMaker), identificação do cliente pela conversa, ferramentas de leitura sobre a camada semântica, isolamento por tenant, limites e registro de uso.

### Modified Capabilities
<!-- Nenhuma: não há specs arquivadas em openspec/specs. A intenção de sistema não aparece na lista de intenções do cliente e seu nome fica reservado, sem alterar os requisitos das intenções existentes. -->

## Impact

- **Backend**: novo módulo `semantic` (catálogo e tradução sobre `BitrixClient`) e novo módulo `crm-tools` (credencial, intenção de sistema, transporte MCP Streamable HTTP, ferramentas); novas tabelas para as escolhas de campos e para o acesso ao CRM do agente (migração Drizzle); reuso de `parseCrmBinding`/`primaryEntity` (`triggers/actions/crm-binding.ts`), `dialogFromChat` (`intentions/intention-runner.ts`) e do cliente de intenções do GPTMaker; cliente GPTMaker ganha as rotas de MCP.
- **Frontend**: nova página "CRM para o agente" e bloco "Acesso ao CRM" na configuração do agente; o editor de gatilhos segue com `crm-fields.ts`.
- **Contratos**: schemas zod em `packages/contracts/`.
- **Dependências**: SDK oficial `@modelcontextprotocol/sdk`.
- **Integrações**: chamadas extras ao Bitrix dos clientes (`crm.*.fields`, `crm.*.get/list`, `crm.status.list`, `crm.category.list`, `user.get`, `imopenlines.dialog.get`); API do GPTMaker (`/v2/agent/{id}/mcp/add`, `/v2/mcp/{id}/tools`, `/v2/mcp/{id}`, intenções).
- **Segurança e privacidade**: o agente passa a ler dados pessoais do CRM; exposição somente por lista de campos permitidos por tenant, cliente identificado só pelo vínculo da conversa, credencial por agente revogável, logs sem valores de campos.
