# Spec Delta

## MODIFIED Requirements

### Requirement: Configuração pelo painel
O sistema MUST permitir ao administrador do tenant, no painel do app, listar os campos do catálogo por entidade (contato, negócio, lead e empresa), marcar ou desmarcar a exposição e escrever ou editar a descrição de significado de cada campo (até 300 caracteres). As alterações MUST valer para as próximas consultas do agente sem reinstalação nem reconfiguração no GPTMaker.

A tela MUST explicar o próprio propósito em dois passos: escolher os campos que o agente pode ler e descrever o que cada um significa. Cada entidade MUST trazer uma frase dizendo quando o agente usa aqueles campos. Cada campo MUST ser apresentado pelo nome e pelo tipo em linguagem do usuário; o código técnico do campo MUST NOT aparecer no texto da linha e fica disponível apenas como dica. Campo personalizado exposto sem descrição MUST exibir um aviso pedindo a explicação, porque o nome sozinho raramente diz ao agente o que ele significa. Campo padrão exposto sem descrição MUST NOT exibir o aviso e mostra apenas o acesso discreto para descrever, para quem pode alterar.

Cada entidade MUST exibir uma prévia do que o agente recebe, montada só com os campos expostos daquela entidade: nome do campo, um valor de exemplo coerente com o campo (um dos valores aceitos, quando for lista; um valor típico, quando for um campo padrão conhecido como nome ou cargo; senão, um valor coerente com o tipo) e a descrição, quando houver. A prévia MUST NOT ler dados reais de clientes do portal e MUST se atualizar assim que um campo é adicionado, removido ou tem a descrição alterada.

Os funis e etapas MUST NOT ter seção própria no painel, porque não têm configuração própria: o que o agente recebe de funil e etapa é decidido pela exposição dos campos Funil e Etapa do negócio.

#### Scenario: Descrever um campo
- **WHEN** o administrador escreve "Canal pelo qual o cliente chegou; Indicação tem prioridade no atendimento" no campo "Origem do lead"
- **THEN** a descrição é salva e passa a acompanhar o campo nas próximas respostas ao agente

#### Scenario: Isolamento entre tenants
- **WHEN** um administrador tenta ler ou alterar o catálogo usando o identificador de um campo de outro tenant
- **THEN** o sistema responde como recurso inexistente e nada é alterado

#### Scenario: Propósito da tela
- **WHEN** o administrador abre a tela "CRM para o agente"
- **THEN** vê os dois passos (escolher campos e descrever o significado) e, na entidade aberta, a frase dizendo quando o agente usa aqueles campos

#### Scenario: Código técnico só como dica
- **WHEN** o campo `UF_CRM_1712345678` "Origem do lead" está exposto
- **THEN** a linha mostra "Origem do lead" e o tipo "Lista", e o código `UF_CRM_1712345678` aparece apenas ao passar o mouse

#### Scenario: Campo personalizado exposto sem descrição
- **WHEN** um campo personalizado exposto não tem descrição
- **THEN** a linha mostra um aviso pedindo para explicar o campo, com acesso direto à edição da descrição para quem pode alterar

#### Scenario: Campo padrão exposto sem descrição
- **WHEN** o campo padrão "Sobrenome" está exposto sem descrição
- **THEN** a linha não mostra o aviso e oferece só o link discreto para adicionar descrição a quem pode alterar

#### Scenario: Prévia do que o agente recebe
- **WHEN** os campos expostos de contato são "Origem do lead" (lista Instagram, Indicação, Site; descrição "Canal pelo qual o cliente chegou") e "Plano" (sem descrição)
- **THEN** a prévia da aba Contato mostra "Origem do lead" com um dos valores aceitos e a descrição, e "Plano" com um valor de exemplo e sem descrição

#### Scenario: Prévia acompanha a configuração
- **WHEN** o administrador remove um campo ou salva uma nova descrição
- **THEN** a prévia da entidade passa a refletir a mudança sem recarregar a tela

#### Scenario: Entidade sem campos expostos
- **WHEN** nenhum campo de empresa está exposto
- **THEN** a prévia da aba Empresa informa que o agente não recebe dados de empresa

#### Scenario: Funis fora do painel
- **WHEN** o administrador abre a tela "CRM para o agente"
- **THEN** não há aba nem seção de funis, e os campos Funil e Etapa podem ser adicionados ou removidos na aba Negócio como os demais campos
