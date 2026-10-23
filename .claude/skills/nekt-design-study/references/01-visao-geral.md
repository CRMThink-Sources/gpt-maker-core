# Nekt — visão geral

## O que é

**Fato (docs):** o Nekt se apresenta como uma "plataforma de contexto para a era dos agentes". Ele conecta fontes de dados, organiza camadas de dados e deixa tudo acessível tanto para pessoas quanto para agentes de IA num único ambiente. Roda na nuvem do cliente (AWS ou GCP) ou no ambiente hospedado deles, o Nekt Express.

**Fato (imprensa):** startup brasileira, fundada em 2024 por ex-alunos de Engenharia de Controle e Automação da UFSC (Florianópolis). Captou R$ 5 milhões numa primeira rodada liderada pela Alexia Ventures e, meses depois, mais R$ 1,3 milhão da Norte Ventures. É descrita na imprensa como uma espécie de "Databricks para pequenas e médias empresas".

## O problema que ataca

Segundo a própria documentação, quando os dados se espalham por SaaS, planilhas, BIs, bancos internos e agentes, as empresas ficam com:

- KPIs inconsistentes entre ferramentas e times;
- nenhum histórico de como os dados mudaram;
- consolidação manual sem trilha de auditoria;
- acesso sem governança;
- silos que travam colaboração e adoção de IA.

**Leitura de design:** a tese central é que *agente sem contexto governado chuta*. Em vez de cada agente fazer centenas de chamadas de API parciais em sistemas diferentes, ele consulta uma única fonte de verdade, já com as definições da empresa. Por isso o produto evoluiu de "plataforma de dados" para "plataforma de contexto".

## Módulos (do dado à ativação)

| Módulo | Papel |
|---|---|
| Sources | Conectores para centenas de sistemas (inclui Bitrix24) |
| Catalog | Tabelas, esquemas e camadas num lakehouse |
| Explorer | Consulta em SQL ou em linguagem natural (assistente de SQL) |
| Queries | Transformações SQL que geram novas tabelas |
| Notebooks | Python/PySpark agendado |
| Histories | Histórico de mudanças (SCD tipo 2) sem código |
| Destinations | Envio dos dados para outros sistemas |
| Integrations | BI, APIs e agentes (Claude, ChatGPT, Copilot, Cursor, Codex…) |
| **Context Layer** | Biblioteca de definições de negócio lida pelos agentes |
| **MCP Gateway / MCPs** | Um único endpoint MCP que expõe as ferramentas do Nekt e de MCPs externos anexados |

As duas últimas linhas são as que interessam ao GPTThink.

## Para quem

**Fato (docs):** times de dados, de receita e operações, times de produto construindo fluxos com IA, e empresas que querem dados estruturados sem muito esforço de engenharia. A documentação insiste que o produto foi feito para usuários técnicos **e não técnicos** trabalharem com autonomia.

**Leitura de design:** esse público duplo explica várias escolhas — um único conceito de contexto em prosa (não técnico), com anotações ligando a recursos reais (técnico); e um agente que faz o trabalho pesado de estruturar, com o humano revisando.

## Como o Nekt se expõe para agentes

- **MCP Server / Gateway:** OAuth 2.1 para apps de desktop e bearer token para CLIs e automações.
- **Docs para agentes:** toda página da documentação tem versão `.md` (é só acrescentar `.md` à URL), um índice em `llms.txt` e a documentação inteira em `llms-full.txt`. Cada conector tem um "skills file" em markdown para uso em contexto de agentes.
- **Platform API:** tudo que se faz na interface pode ser automatizado via REST.
- **Data API:** SQL por HTTP, resultado em Parquet ou CSV.

**Leitura de design:** o Nekt trata o agente como um *usuário de primeira classe*, não como integração secundária. A documentação foi escrita para ser lida por modelos, e a interface e a API têm paridade.

## Fontes

- https://docs.nekt.com/what-is-nekt.md
- https://docs.nekt.com/build-with-ai.md
- https://docs.nekt.com/llms.txt
- Matérias sobre as rodadas: startups.com.br, startupi.com.br, itforum.com.br
