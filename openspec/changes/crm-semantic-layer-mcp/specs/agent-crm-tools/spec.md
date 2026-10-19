## Purpose

Dá ao agente do GPTMaker ferramentas somente leitura sobre o CRM do cliente, construídas sobre a camada semântica: uma intenção de sistema que identifica o cliente da conversa e um servidor MCP com consultas complementares, com autenticação por agente e isolamento por tenant.

## ADDED Requirements

### Requirement: Ativação do CRM por agente
O administrador MUST poder ativar e desativar o acesso ao CRM de cada agente no painel. Ao ativar, o sistema MUST gerar uma credencial exclusiva do agente (guardada cifrada e como hash, nunca exibida) e criar no agente do GPTMaker, pela API, a intenção de sistema "Consultar cliente no CRM" e a conexão MCP do app, ambas autenticadas com essa credencial, deixando as ferramentas MCP ativas. Falha no GPTMaker MUST deixar o acesso no estado de erro, com opção de tentar de novo, sem acesso parcial ativo. Ao desativar, a credencial MUST ser invalidada imediatamente e a intenção e a conexão MUST ser removidas do GPTMaker.

#### Scenario: Ativação bem-sucedida
- **WHEN** o administrador ativa o CRM de um agente e o GPTMaker aceita a intenção e a conexão MCP
- **THEN** o agente passa a ter a intenção "Consultar cliente no CRM" e as ferramentas MCP ativas, e o painel mostra o estado "conectado"

#### Scenario: Falha no GPTMaker
- **WHEN** o GPTMaker recusa ou não responde à criação da conexão MCP
- **THEN** o que já foi criado é desfeito, o painel mostra o estado "erro" com a opção "tentar de novo" e chamadas com a credencial são recusadas

#### Scenario: Desativação
- **WHEN** o administrador desativa o CRM do agente
- **THEN** chamadas seguintes com a credencial anterior são recusadas como não autorizadas e a intenção e a conexão MCP deixam de existir no agente do GPTMaker

#### Scenario: Intenção de sistema fora da lista do cliente
- **WHEN** o administrador abre a lista de intenções do agente ou tenta criar uma intenção com o nome "Consultar cliente no CRM"
- **THEN** a intenção de sistema não aparece na lista e o nome é recusado como reservado

### Requirement: Autenticação e isolamento
Toda chamada à intenção de sistema ou ao servidor MCP MUST apresentar a credencial de um agente não removido, com CRM ativo, de tenant instalado. A credencial MUST determinar o tenant e o portal Bitrix24 consultados; nenhum dado da chamada pode apontar para outro tenant. Chamadas sem credencial válida MUST ser recusadas como não autorizadas, sem consultar o Bitrix24 e sem revelar se o agente existe.

#### Scenario: Credencial inválida
- **WHEN** chega uma chamada com credencial inexistente ou de agente removido
- **THEN** o sistema responde não autorizado e não consulta o Bitrix24

#### Scenario: Agente inativo
- **WHEN** chega uma chamada de um agente inativado ou de tenant desinstalado
- **THEN** o sistema recusa a chamada e não consulta o Bitrix24

#### Scenario: Conversa de outro tenant
- **WHEN** a intenção recebe um identificador de chat cujo tenant difere do tenant da credencial
- **THEN** o cliente é tratado como não identificado

### Requirement: Identificar o cliente da conversa
A intenção de sistema MUST localizar o cliente exclusivamente pelo vínculo da conversa da Linha Aberta com o CRM, a partir do identificador de chat preenchido pelo GPTMaker, preferindo contato, depois lead, depois empresa. MUST devolver nome, empresa, responsável, campos expostos traduzidos, até 10 negócios em andamento (do mais recente para o mais antigo, com título, funil, etapa, valor com moeda e campos expostos) e uma referência opaca do cliente para as demais ferramentas. O cliente MUST NOT ser localizado por telefone, e-mail ou nome informados na conversa.

#### Scenario: Conversa vinculada a um contato
- **WHEN** o agente usa a intenção numa conversa cujo diálogo está vinculado ao contato "Maria Souza" com 2 negócios em andamento
- **THEN** a intenção devolve os dados expostos de Maria Souza, os 2 negócios com funil e etapa pelo nome e a referência do cliente

#### Scenario: Conversa sem vínculo
- **WHEN** a conversa não tem contato, lead nem empresa vinculados no CRM, ou o identificador de chat não veio preenchido
- **THEN** a intenção responde que o cliente não foi identificado no CRM, sem dados pessoais e sem erro

#### Scenario: Cliente informa outro telefone
- **WHEN** o cliente da conversa digita o telefone de outra pessoa e pede os dados dela
- **THEN** a intenção continua devolvendo apenas o cliente vinculado à conversa

### Requirement: Ferramenta negocios_do_cliente
O servidor MCP MUST oferecer a ferramenta `negocios_do_cliente`, que recebe a referência devolvida pela identificação do cliente e um filtro de situação (em andamento, ganhos, perdidos ou todos; padrão todos) e devolve no máximo 10 negócios, do mais recente para o mais antigo, com título, funil, etapa, situação, valor com moeda, datas e campos expostos traduzidos. Referência inválida, adulterada ou de outro tenant MUST ser tratada como cliente não encontrado.

#### Scenario: Negócios ganhos
- **WHEN** o agente pede os negócios ganhos de um cliente com 3 negócios abertos e 2 ganhos
- **THEN** a ferramenta devolve os 2 negócios ganhos com funil e etapa pelo nome

#### Scenario: Limite de resultados
- **WHEN** o cliente tem 25 negócios que atendem ao filtro
- **THEN** a ferramenta devolve os 10 mais recentes e informa que existem mais

#### Scenario: Referência adulterada
- **WHEN** a ferramenta recebe uma referência que não foi emitida para o tenant da credencial
- **THEN** a ferramenta responde que o cliente não foi encontrado e não consulta o Bitrix24

### Requirement: Ferramenta etapas_do_funil
O servidor MCP MUST oferecer a ferramenta `etapas_do_funil`, que devolve os funis de negócio do portal e, para o funil pedido (ou para todos, se nenhum for informado), as etapas na ordem configurada, com nome e situação (em andamento, ganha, perdida).

#### Scenario: Etapas de um funil
- **WHEN** o agente pede as etapas do funil "Vendas B2B"
- **THEN** a ferramenta devolve as etapas desse funil na ordem do Bitrix24, cada uma com nome e situação

#### Scenario: Funil inexistente
- **WHEN** o agente pede um funil que não existe no portal
- **THEN** a ferramenta responde que o funil não foi encontrado e lista os nomes dos funis existentes

### Requirement: Somente leitura e respostas semânticas
As ferramentas MUST NOT criar, alterar ou remover dados no Bitrix24. Toda resposta MUST seguir a camada semântica: só campos expostos, valores traduzidos, descrição de significado junto de cada campo quando existir, e nenhum código técnico.

#### Scenario: Descrição acompanha o campo
- **WHEN** um campo exposto tem descrição de significado
- **THEN** a resposta da ferramenta traz o rótulo, o valor e a descrição desse campo

### Requirement: Limites e falhas
O sistema MUST limitar a taxa de chamadas por agente (padrão 60 por minuto, somando intenção e MCP) e responder em até 10 segundos. Falha ou lentidão do Bitrix24 MUST resultar numa resposta indicando indisponibilidade temporária, sem expor detalhes internos. Excesso de taxa MUST ser respondido como limite atingido.

#### Scenario: Bitrix24 indisponível
- **WHEN** o Bitrix24 do cliente não responde dentro do tempo limite
- **THEN** a ferramenta responde que os dados do CRM estão temporariamente indisponíveis

#### Scenario: Excesso de chamadas
- **WHEN** um agente faz mais de 60 chamadas em um minuto
- **THEN** as chamadas excedentes recebem resposta de limite atingido até a janela liberar

### Requirement: Registro de uso sem dados pessoais
Cada chamada de ferramenta MUST ser registrada com tenant, agente, ferramenta, duração, quantidade de registros devolvidos e resultado (sucesso, não identificado, erro), e MUST NOT registrar valores de campos, telefones, e-mails ou nomes.

#### Scenario: Chamada registrada
- **WHEN** o agente usa a intenção de identificação do cliente
- **THEN** o registro contém a ferramenta, o resultado e a duração, mas não os dados devolvidos
