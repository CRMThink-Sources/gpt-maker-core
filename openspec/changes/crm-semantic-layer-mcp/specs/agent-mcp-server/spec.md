## Purpose

Expõe ao agente do GPTMaker, via protocolo MCP, ferramentas somente leitura sobre o CRM do cliente, construídas sobre a camada semântica, com autenticação por agente e isolamento por tenant.

## ADDED Requirements

### Requirement: Ativação do CRM por agente
O administrador MUST poder ativar e desativar o acesso ao CRM de cada agente no painel. Ao ativar, o sistema MUST gerar uma credencial MCP exclusiva do agente (guardada apenas como hash) e conectar o servidor MCP ao agente no GPTMaker; quando a conexão automática não estiver disponível, o painel MUST exibir uma única vez a URL do servidor e a credencial, com instruções para o cadastro manual. Ao desativar, a credencial MUST ser invalidada imediatamente.

#### Scenario: Ativação com conexão automática
- **WHEN** o administrador ativa o CRM de um agente e o GPTMaker aceita a configuração do servidor MCP pela API
- **THEN** a credencial é gerada, o servidor fica conectado ao agente e o painel mostra o estado "conectado"

#### Scenario: Ativação com cadastro manual
- **WHEN** o administrador ativa o CRM e a conexão automática não está disponível
- **THEN** o painel exibe URL e credencial uma única vez, e o estado fica "aguardando primeira chamada" até o servidor receber uma chamada válida desse agente

#### Scenario: Desativação
- **WHEN** o administrador desativa o CRM do agente
- **THEN** chamadas seguintes com a credencial anterior são recusadas como não autorizadas

#### Scenario: Gerar nova credencial
- **WHEN** o administrador pede uma nova credencial
- **THEN** a anterior deixa de valer imediatamente e a nova é exibida uma única vez

### Requirement: Autenticação e isolamento
Toda chamada ao servidor MCP MUST apresentar uma credencial válida de agente não removido, com CRM ativo, de tenant instalado. A credencial MUST determinar o tenant e o portal Bitrix24 consultados; nenhum parâmetro da chamada pode apontar para outro tenant. Chamadas sem credencial válida MUST ser recusadas como não autorizadas, sem revelar se o agente existe.

#### Scenario: Credencial inválida
- **WHEN** chega uma chamada com credencial inexistente ou de agente removido
- **THEN** o servidor responde não autorizado e não consulta o Bitrix24

#### Scenario: Agente inativo
- **WHEN** chega uma chamada de um agente inativado ou de tenant desinstalado
- **THEN** o servidor recusa a chamada e não consulta o Bitrix24

#### Scenario: Referência de outro tenant
- **WHEN** a ferramenta recebe a referência de um registro que não pertence ao portal do tenant da credencial
- **THEN** a ferramenta responde que o registro não foi encontrado

### Requirement: Ferramenta consultar_cliente
O servidor MUST oferecer a ferramenta `consultar_cliente`, que localiza o cliente da conversa e devolve seus dados expostos: nome, empresa, responsável, campos expostos traduzidos e o número de negócios em andamento. A localização MUST usar, nesta ordem: o vínculo da conversa da Linha Aberta com o CRM, quando a chamada identificar a conversa; e o telefone ou e-mail informado como argumento. A resposta MUST incluir uma referência opaca do cliente para uso nas demais ferramentas.

#### Scenario: Cliente pela conversa
- **WHEN** a chamada identifica a conversa e o diálogo da Linha Aberta está vinculado a um contato
- **THEN** a ferramenta devolve os dados expostos desse contato sem precisar de argumentos

#### Scenario: Cliente pelo telefone
- **WHEN** a ferramenta recebe um telefone que corresponde a um contato do portal
- **THEN** a ferramenta devolve os dados expostos desse contato

#### Scenario: Mais de um cliente
- **WHEN** o telefone informado corresponde a mais de um contato ou lead
- **THEN** a ferramenta devolve no máximo 5 candidatos com nome e referência, sem campos adicionais, e indica que há ambiguidade

#### Scenario: Cliente não encontrado
- **WHEN** nenhum registro corresponde aos dados informados
- **THEN** a ferramenta responde que o cliente não foi encontrado, sem erro de protocolo

### Requirement: Ferramenta negocios_do_cliente
O servidor MUST oferecer a ferramenta `negocios_do_cliente`, que recebe a referência do cliente e um filtro de situação (em andamento, ganhos, perdidos ou todos; padrão em andamento) e devolve no máximo 10 negócios, do mais recente para o mais antigo, com título, funil, etapa, situação, valor com moeda, datas e campos expostos traduzidos.

#### Scenario: Negócios em andamento
- **WHEN** o agente pede os negócios em andamento de um contato com 3 negócios abertos e 2 ganhos
- **THEN** a ferramenta devolve os 3 negócios abertos com funil e etapa pelo nome

#### Scenario: Limite de resultados
- **WHEN** o cliente tem 25 negócios que atendem ao filtro
- **THEN** a ferramenta devolve os 10 mais recentes e informa que existem mais

### Requirement: Ferramenta etapas_do_funil
O servidor MUST oferecer a ferramenta `etapas_do_funil`, que devolve os funis de negócio do portal e, para o funil pedido (ou para todos, se nenhum for informado), as etapas na ordem configurada, com nome e situação (em andamento, ganha, perdida).

#### Scenario: Etapas de um funil
- **WHEN** o agente pede as etapas do funil "Vendas B2B"
- **THEN** a ferramenta devolve as etapas desse funil na ordem do Bitrix24, cada uma com nome e situação

### Requirement: Somente leitura e respostas semânticas
As ferramentas MUST NOT criar, alterar ou remover dados no Bitrix24. Toda resposta MUST seguir a camada semântica: só campos expostos, valores traduzidos, descrição de significado junto de cada campo quando existir, e nenhum código técnico.

#### Scenario: Descrição acompanha o campo
- **WHEN** um campo exposto tem descrição de significado
- **THEN** a resposta da ferramenta traz o rótulo, o valor e a descrição desse campo

### Requirement: Limites e falhas
O servidor MUST limitar a taxa de chamadas por agente (padrão 60 por minuto) e responder em até 10 segundos. Falha ou lentidão do Bitrix24 MUST resultar numa resposta de ferramenta indicando indisponibilidade temporária, sem expor detalhes internos. Excesso de taxa MUST ser respondido como limite atingido.

#### Scenario: Bitrix24 indisponível
- **WHEN** o Bitrix24 do cliente não responde dentro do tempo limite
- **THEN** a ferramenta responde que os dados do CRM estão temporariamente indisponíveis

#### Scenario: Excesso de chamadas
- **WHEN** um agente faz mais de 60 chamadas em um minuto
- **THEN** as chamadas excedentes recebem resposta de limite atingido até a janela liberar

### Requirement: Registro de uso sem dados pessoais
Cada chamada de ferramenta MUST ser registrada com tenant, agente, ferramenta, duração, quantidade de registros devolvidos e resultado (sucesso, não encontrado, erro), e MUST NOT registrar valores de campos, telefones ou e-mails.

#### Scenario: Chamada registrada
- **WHEN** o agente chama `consultar_cliente` com um telefone
- **THEN** o registro contém a ferramenta, o resultado e a duração, mas não o telefone nem os dados devolvidos
