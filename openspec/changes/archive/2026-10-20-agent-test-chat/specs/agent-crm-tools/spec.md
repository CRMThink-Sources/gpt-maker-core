## MODIFIED Requirements

### Requirement: Identificar o cliente da conversa
A intenção de sistema MUST localizar o cliente exclusivamente pelo vínculo da conversa com o CRM, a partir do identificador de chat preenchido pelo GPTMaker, preferindo contato, depois lead, depois empresa. Numa conversa da Linha Aberta, o vínculo é o do diálogo no Bitrix24. Numa conversa de teste do app, o vínculo é o cliente simulado escolhido pelo testador, buscado só entre as conversas de teste do tenant da credencial. MUST devolver nome, empresa, responsável, campos expostos traduzidos, até 10 negócios em andamento (do mais recente para o mais antigo, com título, funil, etapa, valor com moeda e campos expostos) e uma referência opaca do cliente para as demais ferramentas. O cliente MUST NOT ser localizado por telefone, e-mail ou nome informados na conversa.

#### Scenario: Conversa vinculada a um contato
- **WHEN** o agente usa a intenção numa conversa cujo diálogo está vinculado ao contato "Maria Souza" com 2 negócios em andamento
- **THEN** a intenção devolve os dados expostos de Maria Souza, os 2 negócios com funil e etapa pelo nome e a referência do cliente

#### Scenario: Conversa sem vínculo
- **WHEN** a conversa não tem contato, lead nem empresa vinculados no CRM, ou o identificador de chat não veio preenchido
- **THEN** a intenção responde que o cliente não foi identificado no CRM, sem dados pessoais e sem erro

#### Scenario: Cliente informa outro telefone
- **WHEN** o cliente da conversa digita o telefone de outra pessoa e pede os dados dela
- **THEN** a intenção continua devolvendo apenas o cliente vinculado à conversa

#### Scenario: Conversa de teste com cliente simulado
- **WHEN** o agente usa a intenção numa conversa de teste em que o testador escolheu o contato "Maria Souza"
- **THEN** a intenção devolve os dados de Maria Souza como numa conversa vinculada a ela

#### Scenario: Conversa de teste sem cliente ou de outro tenant
- **WHEN** a conversa de teste não tem cliente simulado, foi excluída ou pertence a outro tenant
- **THEN** a intenção responde que o cliente não foi identificado no CRM
