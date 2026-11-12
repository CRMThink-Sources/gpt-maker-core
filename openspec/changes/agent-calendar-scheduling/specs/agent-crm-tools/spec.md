# Spec Delta

## MODIFIED Requirements

### Requirement: Somente leitura e respostas semânticas
As ferramentas MUST NOT criar, alterar ou remover dados no Bitrix24, com uma única exceção: a ferramenta `agendar_compromisso` (spec `agent-calendar-scheduling`) MAY criar eventos no Calendário do Bitrix24, e somente isso. Nenhuma ferramenta MUST alterar ou remover dados existentes, e nenhuma MUST criar registros do CRM (contatos, leads, empresas, negócios ou atividades) por conta própria. Toda resposta MUST seguir a camada semântica: só campos expostos, valores traduzidos, descrição de significado junto de cada campo quando existir, e nenhum código técnico.

#### Scenario: Descrição acompanha o campo
- **WHEN** um campo exposto tem descrição de significado
- **THEN** a resposta da ferramenta traz o rótulo, o valor e a descrição desse campo

#### Scenario: Única escrita permitida
- **WHEN** o agente usa `agendar_compromisso` com um horário livre
- **THEN** o sistema cria somente o evento de calendário vinculado ao cliente e nenhum outro dado do Bitrix24 é criado, alterado ou removido

#### Scenario: Ferramenta de consulta não escreve
- **WHEN** o agente usa `negocios_do_cliente`, `etapas_do_funil`, `horarios_livres`, `agendamentos_do_cliente` ou a intenção "Consultar cliente no CRM"
- **THEN** nenhuma chamada de escrita é feita ao Bitrix24
