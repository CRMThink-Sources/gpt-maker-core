# Proposal

## Why

Hoje o agente só **lê** o CRM (spec `agent-crm-tools`) e a função de Agendamento do GPTThink se limita a enviar o link de uma agenda externa e orientar a remarcação. Quem usa o Bitrix24 já mantém a agenda da equipe no **Calendário** do portal, mas o agente não enxerga os horários livres nem marca o compromisso: o atendimento termina com "a equipe entra em contato", e alguém precisa agendar à mão. Deixar o agente consultar a disponibilidade e criar o evento no Calendário do Bitrix24 fecha o ciclo dentro da própria conversa.

## What Changes

- Novas ferramentas do servidor MCP do agente, sobre o Calendário do Bitrix24:
  - `horarios_livres`: devolve horários disponíveis num período, a partir da agenda configurada.
  - `agendar_compromisso`: cria o evento no Calendário, vinculado ao cliente da conversa no CRM.
  - `agendamentos_do_cliente`: lista os compromissos já marcados com o cliente da conversa.
- Nova configuração por agente, na tela do agente, de **de quem é a agenda**, com três modos:
  - **usuário fixo**: um usuário do portal escolhido pelo administrador;
  - **responsável do cliente no CRM**: a agenda de quem é responsável pelo contato, lead, empresa ou negócio da conversa;
  - **lista de usuários**: o agente escolhe, entre os usuários marcados, quem está livre no horário.
  Também define a duração padrão do compromisso, a antecedência mínima e a janela máxima de busca.
- **BREAKING (operacional)**: o app passa a exigir o escopo `calendar` do Bitrix24. É preciso incluí-lo no cadastro do app e **reinstalar/reautorizar nos tenants existentes**; sem o escopo, as ferramentas de agenda respondem que o calendário não está liberado.
- **Exceção à regra "somente leitura"** das ferramentas do CRM: `agendar_compromisso` passa a **criar** dados no Bitrix24. A criação é restrita a eventos de calendário, exige o cliente identificado na conversa e confirmação explícita do cliente antes de gravar.
- Fora desta versão: remarcar e cancelar compromissos, reservar salas/recursos, sincronização com calendários externos (Google, Outlook) e lembretes ativos enviados pelo agente.

## Capabilities

### New Capabilities

- `agent-calendar-scheduling`: configuração da agenda por agente (usuário fixo, responsável no CRM ou lista de usuários), ferramentas MCP de horários livres, agendamento e consulta de agendamentos do cliente, regras de disponibilidade, duplicidade e confirmação, e comportamento quando o escopo `calendar` ou a agenda não estão disponíveis.

### Modified Capabilities

- `agent-crm-tools`: o requisito "Somente leitura e respostas semânticas" ganha a exceção do agendamento (única escrita permitida, só evento de calendário), e a ativação do CRM do agente passa a ser pré-requisito das ferramentas de agenda, que reutilizam a mesma credencial, o mesmo isolamento por tenant, o limite de chamadas e o registro de uso sem dados pessoais.

## Impact

- **Backend**: `backend/src/modules/crm-tools/` (novas ferramentas no `mcp.controller.ts`, serviço de agenda, `TOOLS_VERSION` incrementada para o GPTMaker reler as ferramentas), `backend/src/modules/bitrix/` (chamadas `calendar.*`, tratamento de `insufficient_scope`), nova tabela de configuração da agenda por agente (migration Drizzle, com `tenant_id`), reaproveitamento do horário de funcionamento do agente (`agent-business-hours`) e do fuso.
- **Contracts**: `@gptmaker/contracts` com o schema da configuração de agenda e os tipos de resposta.
- **Frontend**: seção de agenda na tela do agente em `/app` (modo, usuários, duração, antecedência), com teste de comportamento.
- **Integrações e operação**: escopo `calendar` no cadastro do app e na plataforma (`crmthink-platform`), reinstalação nos tenants existentes, atualização de `docs/bitrix-observado.md` e do runbook, e verificação no portal de teste dos formatos de data, fuso e do campo de vínculo com o CRM (`crm_fields`).
- **Segurança e custo**: escrita no Bitrix24 pela primeira vez nas ferramentas do agente (exige idempotência contra duplo agendamento e filtro por `tenantId` herdado da credencial); o uso das ferramentas conta no mesmo limite de 60 chamadas por minuto por agente.
