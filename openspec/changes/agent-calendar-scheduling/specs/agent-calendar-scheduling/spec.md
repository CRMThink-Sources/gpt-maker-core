# Spec Delta

## Purpose

Permite que o agente do GPTMaker consulte os horários livres, marque compromissos e liste os agendamentos de um cliente no Calendário do Bitrix24 do portal, a partir da agenda escolhida por agente na tela do app, com o mesmo isolamento por tenant e a mesma credencial das ferramentas do CRM.

## ADDED Requirements

### Requirement: Configurar a agenda do agente
O sistema MUST permitir que quem gerencia agentes defina, por agente com acesso ao CRM ativo, a configuração de agenda: o **modo** (`usuário fixo`, `responsável do cliente no CRM` ou `lista de usuários`), os usuários do portal quando o modo exigir (exatamente 1 em `usuário fixo`, de 1 a 10 em `lista de usuários`, nenhum em `responsável do cliente no CRM`), a **duração do compromisso** (de 15 a 240 minutos, em múltiplos de 5, padrão 30), a **antecedência mínima** (de 0 a 1440 minutos, padrão 60) e a **janela de busca** (de 1 a 30 dias à frente, padrão 7). A configuração MUST ser opcional e removível, MUST valer na chamada seguinte e MUST NOT existir para agente sem acesso ao CRM ativo. Os usuários MUST ser usuários ativos do portal do tenant do agente.

#### Scenario: Configurar usuário fixo
- **WHEN** o administrador escolhe o modo "usuário fixo", seleciona "Ana Lima", mantém os padrões e salva
- **THEN** o agente passa a ter a agenda de Ana Lima, com compromissos de 30 minutos, antecedência de 60 minutos e busca de até 7 dias

#### Scenario: Valores fora dos limites
- **WHEN** o administrador informa duração de 10 minutos, ou 11 usuários na lista, ou o modo "usuário fixo" com 2 usuários
- **THEN** o sistema recusa o salvamento, indica o campo com problema e não altera a configuração salva

#### Scenario: Usuário de outro portal ou inativo
- **WHEN** a configuração contém um usuário que não existe no portal do tenant ou está inativo
- **THEN** o sistema recusa o salvamento e informa qual usuário não pôde ser usado

#### Scenario: Agente sem acesso ao CRM
- **WHEN** o administrador tenta configurar a agenda de um agente com o acesso ao CRM desativado
- **THEN** o sistema recusa e informa que o acesso ao CRM precisa estar ativo

#### Scenario: Remover a configuração
- **WHEN** o administrador remove a configuração de agenda do agente
- **THEN** as ferramentas de agenda passam a responder que a agenda não está configurada e nenhum dado do Bitrix24 é consultado

#### Scenario: Desativar o CRM do agente
- **WHEN** o administrador desativa o acesso ao CRM de um agente que tem agenda configurada
- **THEN** as ferramentas de agenda deixam de aceitar chamadas desse agente junto com as demais, e a configuração de agenda é mantida para quando o CRM for reativado

### Requirement: Escopo do calendário no Bitrix24
O sistema MUST usar o Calendário do Bitrix24 somente quando o app instalado tiver o escopo `calendar`. Sem o escopo, as ferramentas de agenda MUST responder que o calendário não está liberado para o app, sem criar nem consultar nada, e a tela da agenda MUST informar que é preciso reautorizar o app no portal.

#### Scenario: App sem o escopo
- **WHEN** o agente chama uma ferramenta de agenda e o Bitrix24 responde `insufficient_scope`
- **THEN** a ferramenta responde que o calendário não está liberado, orienta o agente a avisar o cliente que a equipe retornará, e o painel passa a indicar "reautorizar o app"

#### Scenario: App com o escopo
- **WHEN** o tenant reinstala o app com o escopo `calendar` e o agente chama uma ferramenta de agenda
- **THEN** a ferramenta consulta o Calendário normalmente

### Requirement: De quem é a agenda
A agenda usada em cada chamada MUST ser determinada pelo modo configurado. No modo `usuário fixo`, é a do usuário escolhido. No modo `responsável do cliente no CRM`, é a do responsável pelo contato, lead ou empresa identificado na conversa; se o cliente não tiver responsável, ou o responsável estiver inativo, a ferramenta MUST responder que não há agenda para esse cliente, sem escolher outra. No modo `lista de usuários`, são as agendas de todos os usuários da lista, e o compromisso MUST ser atribuído ao primeiro usuário da lista que estiver livre no horário pedido. O agente MUST NOT poder escolher a agenda, nem informar ou alterar identificadores de usuários.

#### Scenario: Responsável do cliente
- **WHEN** o modo é "responsável do cliente no CRM" e o contato da conversa tem como responsável "Bruno Reis"
- **THEN** os horários livres e o agendamento usam a agenda de Bruno Reis

#### Scenario: Cliente sem responsável
- **WHEN** o modo é "responsável do cliente no CRM" e o contato da conversa não tem responsável
- **THEN** a ferramenta responde que não há agenda para esse cliente e nada é criado

#### Scenario: Lista de usuários, um ocupado
- **WHEN** o modo é "lista de usuários" com Ana e Bruno nessa ordem e Ana está ocupada às 14:00
- **THEN** o horário de 14:00 aparece como livre (por causa de Bruno) e o agendamento de 14:00 é atribuído a Bruno

### Requirement: Ferramenta horarios_livres
O servidor MCP MUST oferecer a ferramenta `horarios_livres`, que recebe uma data inicial opcional (padrão hoje, no fuso da agenda) e a referência do cliente devolvida por "Consultar cliente no CRM" (obrigatória no modo `responsável do cliente no CRM`, em que define de quem é a agenda, e ignorada nos demais modos), e devolve até 10 horários livres, em ordem cronológica, dentro da janela de busca configurada. Um horário MUST ser considerado livre quando: está dentro do horário de funcionamento do agente (ou, sem horário configurado, de segunda a sexta das 09:00 às 18:00 no fuso `America/Sao_Paulo`); respeita a antecedência mínima; cabe inteiro nos limites do expediente; e não se sobrepõe a nenhum evento do calendário marcado como ocupado ou ausente. Eventos marcados como livres ou provisórios MUST NOT bloquear o horário. Cada horário MUST ser devolvido com a data e a hora de início **por extenso, prontas para o agente dizer ao cliente** (por exemplo, "quinta-feira, 12 de novembro, às 9h30"), a hora de término, o nome de quem atende e um valor interno de início no formato `AAAA-MM-DD HH:mm` para ser passado de volta a `agendar_compromisso`; a resposta MUST informar a duração do compromisso e o fuso, e a orientação ao agente MUST mandar dizer os horários ao cliente por extenso e nunca mostrar o valor interno nem datas no formato `AAAA-MM-DD`.

#### Scenario: Dia com compromisso
- **WHEN** a agenda tem um evento ocupado das 10:00 às 11:00 e o expediente é das 09:00 às 12:00, com compromissos de 30 minutos
- **THEN** os horários livres do dia são 09:00, 09:30 e 11:00, 11:30

#### Scenario: Antecedência mínima
- **WHEN** são 13:20, a antecedência mínima é de 60 minutos e há horários livres às 13:30 e às 14:30
- **THEN** o horário de 13:30 não é oferecido e o de 14:30 sim

#### Scenario: Sem horários na janela
- **WHEN** não há nenhum horário livre dentro da janela de busca
- **THEN** a ferramenta responde que não há horários disponíveis no período, sem erro, e orienta o agente a avisar o cliente que a equipe retornará

#### Scenario: Evento marcado como livre
- **WHEN** existe um evento das 14:00 às 15:00 marcado como "livre"
- **THEN** os horários desse intervalo continuam sendo oferecidos

#### Scenario: Data fora da janela
- **WHEN** o agente pede horários de uma data posterior à janela de busca ou anterior a hoje
- **THEN** a ferramenta responde qual é o período permitido e não consulta o Bitrix24

### Requirement: Ferramenta agendar_compromisso
O servidor MCP MUST oferecer a ferramenta `agendar_compromisso`, que recebe a referência do cliente devolvida por "Consultar cliente no CRM", o início do compromisso e um assunto curto opcional, e cria no Calendário do Bitrix24 um evento na agenda determinada pelo modo, com a duração configurada, vinculado ao cliente no CRM e com a descrição indicando que foi marcado pelo agente. A ferramenta MUST recusar referência inválida ou de outro tenant como cliente não encontrado, MUST recusar início que não esteja entre os horários livres naquele momento (reconsultando o Bitrix24 imediatamente antes de criar) e MUST criar o evento no máximo uma vez para o mesmo cliente, agenda e início, devolvendo o evento já criado em repetições da mesma chamada. A descrição da ferramenta MUST orientar o agente a só usá-la depois que o cliente confirmar data e hora. A ferramenta MUST funcionar em duas etapas: a primeira chamada para um cliente e um horário MUST NOT criar o evento e MUST devolver, por extenso, a data, a hora e o nome de quem atende, avisando que nada foi marcado e que o agente deve confirmar com o cliente; só uma segunda chamada com os mesmos dados, em até 10 minutos, MUST criar o evento. A resposta de agendamento MUST trazer a data e a hora por extenso (como em `horarios_livres`), a hora de término, a duração, o fuso e o nome de quem atende, e MUST NOT trazer identificadores internos do Bitrix24.

#### Scenario: Agendamento bem-sucedido
- **WHEN** o agente chama a ferramenta com a referência de "Maria Souza" e o início 2026-11-20 14:00, horário livre na agenda de Ana Lima
- **THEN** o Bitrix24 recebe um evento de 30 minutos na agenda de Ana Lima, vinculado ao contato Maria Souza, e a resposta confirma data, hora, duração e "com Ana Lima"

#### Scenario: Primeira chamada não marca
- **WHEN** o agente chama `agendar_compromisso` pela primeira vez para o cliente e o horário, mesmo que o cliente ainda não tenha escolhido
- **THEN** nenhum evento é criado, a resposta diz que nada foi marcado e traz a data, a hora e "com quem" por extenso para o agente confirmar com o cliente

#### Scenario: Confirmação de outro horário ou de outro cliente
- **WHEN** a segunda chamada traz outro horário ou outro cliente
- **THEN** ela é tratada como uma primeira chamada: nada é marcado e a confirmação é pedida de novo

#### Scenario: Horário tomado entre a consulta e a confirmação
- **WHEN** o horário oferecido foi ocupado por outro evento antes de o cliente confirmar
- **THEN** a ferramenta não cria o evento, responde que o horário não está mais disponível e devolve até 3 alternativas próximas

#### Scenario: Chamada repetida
- **WHEN** a mesma chamada (mesmo cliente, agenda e início) chega duas vezes, por reenvio do GPTMaker ou por insistência do agente
- **THEN** apenas um evento existe no Bitrix24 e a segunda resposta confirma o agendamento já feito

#### Scenario: Início fora das regras
- **WHEN** o início está fora do expediente, antes da antecedência mínima, depois da janela de busca ou não alinhado à grade de horários
- **THEN** a ferramenta não cria o evento e responde por que o horário não pode ser usado

#### Scenario: Referência de outro tenant
- **WHEN** a ferramenta recebe uma referência de cliente que não foi emitida para o tenant da credencial
- **THEN** responde que o cliente não foi encontrado e não consulta nem altera o Bitrix24

#### Scenario: Falha do Bitrix24 ao criar
- **WHEN** o Bitrix24 recusa ou não responde à criação do evento
- **THEN** a ferramenta responde que não foi possível agendar agora, nenhum evento fica registrado como criado pelo sistema, e o agente é orientado a avisar o cliente que a equipe retornará

### Requirement: Ferramenta agendamentos_do_cliente
O servidor MCP MUST oferecer a ferramenta `agendamentos_do_cliente`, que recebe a referência do cliente e devolve até 10 compromissos futuros do cliente (do mais próximo para o mais distante), vinculados ao cliente no CRM e cujo responsável é um usuário das agendas que o agente usa, com a data e a hora de início por extenso, a hora de término, a duração, o fuso e o nome de quem atende. A ferramenta MUST considerar somente a janela de 60 dias à frente e MUST NOT devolver título, descrição nem participantes do compromisso, de modo que um compromisso privado revele apenas que existe um horário ocupado com aquele cliente.

#### Scenario: Cliente com agendamentos
- **WHEN** o cliente tem dois compromissos futuros vinculados na agenda de Ana Lima
- **THEN** a ferramenta devolve os dois, do mais próximo para o mais distante, com data, hora e "com Ana Lima"

#### Scenario: Cliente sem agendamentos
- **WHEN** não há compromisso futuro vinculado ao cliente nas agendas do agente
- **THEN** a ferramenta responde que não há agendamentos futuros, sem erro

#### Scenario: Compromisso em agenda fora da configuração
- **WHEN** o cliente tem um compromisso numa agenda de usuário que não é usada pelo agente
- **THEN** esse compromisso não é devolvido

#### Scenario: Título e descrição não são devolvidos
- **WHEN** um compromisso vinculado ao cliente tem título e descrição preenchidos, inclusive quando está marcado como privado
- **THEN** a ferramenta devolve só data, hora, duração, fuso e quem atende, sem título nem descrição

#### Scenario: Compromisso alterado ou apagado
- **WHEN** um compromisso do cliente foi remarcado ou apagado no Calendário do Bitrix24 depois de criado
- **THEN** a ferramenta devolve o horário atual ou deixa de devolvê-lo

### Requirement: Isolamento, limites e registro das ferramentas de agenda
As ferramentas de agenda MUST seguir a autenticação, o isolamento por tenant, o limite de chamadas por agente (compartilhado com as demais ferramentas do CRM), o tempo máximo de resposta de 10 segundos e as respostas de indisponibilidade definidos em `agent-crm-tools`. Cada chamada MUST ser registrada com tenant, agente, ferramenta, duração, quantidade de registros e resultado, e MUST NOT registrar nomes, telefones, e-mails, títulos ou descrições de eventos, nem horários dos compromissos.

#### Scenario: Excesso de chamadas
- **WHEN** um agente soma mais de 60 chamadas por minuto entre as ferramentas de agenda e as demais do CRM
- **THEN** as excedentes recebem resposta de limite atingido

#### Scenario: Bitrix24 lento
- **WHEN** o Bitrix24 não responde à consulta de disponibilidade em 10 segundos
- **THEN** a ferramenta responde que a agenda está temporariamente indisponível e nenhum evento é criado

#### Scenario: Registro sem dados pessoais
- **WHEN** o agente agenda um compromisso
- **THEN** o registro da chamada contém ferramenta, resultado e duração, mas não o nome do cliente, o título nem o horário do evento
