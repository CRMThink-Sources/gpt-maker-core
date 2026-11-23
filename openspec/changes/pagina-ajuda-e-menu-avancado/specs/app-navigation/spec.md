## Purpose

Organização do menu lateral do portal do cliente (`/app`) em grupos e as regras de visibilidade de cada item, separando o uso diário dos recursos avançados.

## ADDED Requirements

### Requirement: Grupos do menu lateral
O menu lateral do `/app` SHALL organizar os itens, nesta ordem, nos grupos: principal (sem título: Agentes, Créditos e plano), **Configurações** (Permissões, Avisos), **Avançado** (CRM para o agente, Chave Vibecode) e **Suporte** (Ajuda e o link externo de suporte). O mesmo menu SHALL valer no desktop e na gaveta do celular.

#### Scenario: Administrador com CRM ligado
- **WHEN** um administrador abre o app com as ferramentas do CRM habilitadas
- **THEN** o grupo Avançado lista CRM para o agente e Chave Vibecode, e esses itens não aparecem no grupo principal nem em Configurações

#### Scenario: Ordem dos grupos
- **WHEN** o menu é exibido com todos os itens visíveis
- **THEN** os grupos aparecem na ordem principal, Configurações, Avançado, Suporte

### Requirement: Visibilidade dos itens preservada
Mover um item de grupo SHALL NOT alterar sua rota nem quem pode vê-lo: CRM para o agente SHALL aparecer só com as ferramentas do CRM habilitadas no ambiente; Chave Vibecode, Permissões e Avisos SHALL aparecer só para administradores do portal. O item continua marcado como atual nas mesmas rotas de antes.

#### Scenario: Gerente sem permissão de administrador
- **WHEN** um usuário que não é administrador abre o app com o CRM habilitado
- **THEN** o grupo Avançado mostra apenas CRM para o agente

#### Scenario: Item ativo
- **WHEN** o usuário está em `/app/ai-key`
- **THEN** o item Chave Vibecode, dentro do grupo Avançado, aparece como a página atual

### Requirement: Grupo vazio não é exibido
Um grupo cujos itens estejam todos ocultos para o usuário SHALL NOT ser exibido, nem seu título.

#### Scenario: Sem CRM e sem permissão de administrador
- **WHEN** um usuário não administrador abre o app com as ferramentas do CRM desligadas
- **THEN** o título Avançado não aparece no menu
