## Why

Hoje o agente atende às cegas: o `buildRequest` do canal (`backend/src/modules/channel/conversation.service.ts`) envia ao GPTMaker apenas `contextId`, `chatName`, o texto e o primeiro anexo — nenhum dado do CRM. O agente não sabe quem é o cliente, em que etapa está o negócio nem o que já foi comprado, e o valor percebido do produto fica limitado a "um chat que responde com base no treinamento". O GPTMaker permite conectar servidores MCP aos agentes; expor o CRM por esse canal, com uma camada semântica que traduz os campos técnicos do Bitrix (`UF_CRM_*`, `C3:PREPARATION`, ids de listas) para conceitos de negócio do próprio cliente, deixa o agente consultar o contexto sob demanda, sem inflar cada prompt.

## What Changes

- **Camada semântica do CRM no backend**: catálogo por tenant das entidades e campos que o agente pode ler (lead, negócio, contato, empresa), com rótulo amigável, descrição de significado escrita pelo cliente, tipo e valores aceitos (listas, booleanos, funis e etapas resolvidos por nome). A tradução hoje feita só no frontend (`frontend/src/lib/crm-fields.ts`) passa a existir no backend como fonte única.
- **Servidor MCP próprio** exposto pela API, autenticado por token por agente (mesmo modelo do `?t=` dos webhooks, só o hash no banco) e isolado por tenant/instalação Bitrix.
- **Ferramentas somente leitura** (MVP): `consultar_cliente`, `negocios_do_cliente` e `etapas_do_funil`. Toda saída usa rótulos e valores traduzidos; o agente nunca vê códigos técnicos e só recebe campos que o cliente expôs.
- **Tela no painel**: catálogo do tenant para escolher os campos expostos e descrever o significado de cada um, e chave por agente para ativar o acesso ao CRM.
- **Conexão do servidor MCP ao agente no GPTMaker**: automática se a API oferecer meio para isso; caso contrário, o painel mostra URL e credencial para cadastro manual.
- Fora do escopo: ferramentas de escrita no CRM (fase 2) e débito de créditos por chamada de ferramenta (avaliar depois sobre o ledger existente). Os gatilhos existentes não mudam.

## Capabilities

### New Capabilities
- `crm-semantic-layer`: catálogo por tenant de entidades e campos do CRM expostos ao agente, com rótulos, descrições de significado, tipos, valores aceitos, funis e etapas; tradução de código para conceito e de conceito para código; configuração pelo painel.
- `agent-mcp-server`: servidor MCP por agente (autenticação, isolamento por tenant, ferramentas de leitura do CRM sobre a camada semântica, limites e auditoria), e a conexão do servidor ao agente no GPTMaker.

### Modified Capabilities
<!-- Nenhuma: não há specs arquivadas em openspec/specs; as capabilities da v1 ainda estão na change bitrix-gptmaker-agents-platform e não têm requisitos alterados (gatilhos e canal seguem iguais). -->

## Impact

- **Backend**: novo módulo `semantic` (catálogo e tradução sobre `BitrixClient`) e novo módulo `mcp` (transporte MCP Streamable HTTP, ferramentas); novas tabelas para o catálogo de campos e para a credencial MCP do agente (migração Drizzle); reuso de `parseCrmBinding`/`primaryEntity` (`triggers/actions/crm-binding.ts`) e de `PlatformTokenProvider`.
- **Frontend**: nova seção "CRM para o agente" nas configurações do agente; `crm-fields.ts` passa a consumir o catálogo do backend em vez de montar a tradução sozinho (ou fica como está no editor de gatilhos, decisão no design).
- **Contratos**: schemas zod do catálogo em `packages/contracts/`.
- **Dependências**: SDK oficial `@modelcontextprotocol/sdk`.
- **Integrações**: chamadas extras ao Bitrix dos clientes (`crm.*.fields`, `crm.*.get/list`, `crm.status.list`, `crm.category.list`, `imopenlines.dialog.get`), sujeitas ao rate limit por portal; API do GPTMaker para conectar o MCP ao agente, se existir.
- **Segurança e privacidade**: o agente passa a ler dados pessoais do CRM; exposição somente por lista de campos permitidos (allowlist) por tenant, token por agente revogável, logs sem valores de campos.
