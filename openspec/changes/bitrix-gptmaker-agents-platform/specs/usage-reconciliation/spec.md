## ADDED Requirements

### Requirement: Coleta diária de consumo real
O sistema MUST coletar diariamente, para cada agente, o consumo real de créditos no GPTMaker via `GET /agents/{id}/credits-spent` (filtrado por ano, mês e dia), armazenando créditos por agente, dia e modelo.

#### Scenario: Coleta do dia anterior
- **WHEN** o job de reconciliação executa após a virada do dia
- **THEN** o sistema grava o consumo real do dia anterior por agente e modelo

#### Scenario: Falha na coleta
- **WHEN** a API do GPTMaker falha para um agente
- **THEN** o sistema retenta aquele agente e registra pendência, sem bloquear a coleta dos demais

### Requirement: Ajuste do ledger pelo consumo real
O sistema MUST comparar, por agente e dia, os débitos lançados com o consumo real (1 crédito GPTMaker = 1 crédito do cliente) e lançar `ADJUSTMENT` da diferença quando ela exceder a tolerância configurada.

#### Scenario: Consumo real maior que o debitado
- **WHEN** o consumo real de um agente em um dia é maior que a soma dos débitos daquele dia além da tolerância
- **THEN** o sistema lança `ADJUSTMENT` negativo no ledger do tenant com a diferença, referenciando o dia e o agente

#### Scenario: Consumo real menor que o debitado
- **WHEN** o consumo real é menor que os débitos além da tolerância
- **THEN** o sistema lança `ADJUSTMENT` positivo devolvendo a diferença

#### Scenario: Reconciliação reexecutada
- **WHEN** a reconciliação de um mesmo agente e dia é executada novamente
- **THEN** apenas a diferença ainda não ajustada é lançada, sem duplicar ajustes

### Requirement: Sugestão de ajuste do custo por modelo
O sistema MUST calcular, por modelo, a média real de créditos por resposta no período (consumo real ÷ respostas entregues) e exibi-la no backoffice ao lado do custo cadastrado no catálogo.

#### Scenario: Custo cadastrado defasado
- **WHEN** a média real de um modelo difere do custo cadastrado além da tolerância por 7 dias seguidos
- **THEN** o backoffice destaca o modelo com a média real sugerida

### Requirement: Relatório de consumo do partner
O sistema MUST gerar relatório por período com créditos consumidos no GPTMaker (custo do partner) versus créditos debitados dos clientes e receita das assinaturas, por tenant e por agente, e alertar quando o total consumido no workspace divergir da soma por agente.

#### Scenario: Fechamento de período
- **WHEN** o operador solicita o relatório de um mês
- **THEN** o sistema apresenta total consumido no GPTMaker, total debitado dos clientes, receita de assinaturas e pacotes, margem e detalhamento por tenant e agente

#### Scenario: Consumo sem agente mapeado
- **WHEN** existe consumo no GPTMaker para agente sem vínculo com tenant
- **THEN** o relatório destaca o consumo como órfão para investigação
