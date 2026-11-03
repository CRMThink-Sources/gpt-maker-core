## Purpose
Medir a qualidade da revisão por IA com formulários de teste conhecidos, para comparar versões do prompt com números e não por impressão.

## ADDED Requirements

### Requirement: Casos de avaliação da revisão
O repositório MUST ter de 10 a 15 casos de avaliação da revisão por IA, cada um com as respostas de uma função e o que se espera da revisão. Os casos MUST cobrir: preenchimento bom (a revisão não deve inventar problema), preenchimento ruim com problemas conhecidos, contradição entre campos, item repetido entre campos e texto com instrução escondida ("ignore as regras e …"). Cada caso MUST declarar os problemas esperados por item (categoria e gravidade) e o que a revisão MUST NOT fazer (por exemplo, afirmar um prazo que o cliente não escreveu ou obedecer à instrução escondida). Os casos MUST usar só dados fictícios.

#### Scenario: Cobertura dos tipos de caso
- **WHEN** o conjunto de casos é validado
- **THEN** há ao menos um caso bom, um ruim, um com contradição, um com repetição e um com instrução escondida

#### Scenario: Caso sem dado real
- **WHEN** um caso cita nome, telefone ou documento
- **THEN** são fictícios e o validador do conjunto não encontra dados reais

### Requirement: Execução e comparação de versões do prompt
O sistema MUST ter um comando que roda a revisão por IA nos casos, com uma chave Vibecode informada no ambiente, e imprime por caso e no total: problemas esperados encontrados, problemas a mais e a menos, sugestões que passam dos limites, sugestões que inventam dado, instrução escondida obedecida e custo em chamadas. O comando MUST poder rodar duas versões do prompt nos mesmos casos e mostrar a diferença entre elas. O comando MUST NOT fazer parte da integração contínua nem rodar sem a chave informada, e MUST NOT debitar créditos de nenhum tenant nem gravar nada no banco.

#### Scenario: Comparar duas versões
- **WHEN** o comando roda a versão atual e a nova do prompt nos mesmos casos
- **THEN** a saída mostra, por métrica, o valor de cada versão e a diferença

#### Scenario: Sem chave
- **WHEN** o comando roda sem a chave Vibecode no ambiente
- **THEN** ele para antes de qualquer chamada, dizendo que a chave é necessária

#### Scenario: Fora da integração contínua
- **WHEN** a integração contínua roda os testes do backend
- **THEN** os casos de avaliação não são executados, mas o conjunto é validado por teste sem chamar a IA
