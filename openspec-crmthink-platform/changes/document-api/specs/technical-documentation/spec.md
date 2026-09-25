## ADDED Requirements

### Requirement: Documentação técnica no repositório
O repositório MUST conter em `docs/technical/` a documentação técnica interna da plataforma, em pt-br, com um índice (`README.md`) que descreve o público (quem mantém e opera a plataforma), a ordem de leitura e o link para a referência da API. Cada documento MUST citar os arquivos-fonte que descreve (`src/...`) para que o leitor encontre o código.

#### Scenario: Onboarding de desenvolvedor
- **WHEN** um desenvolvedor novo abre `docs/technical/README.md`
- **THEN** encontra a lista de documentos com uma linha de resumo cada e a ordem recomendada de leitura

### Requirement: Arquitetura e ciclo da requisição
A documentação técnica MUST descrever: os processos `api` e `worker` e o que cada um executa; os módulos (`installations`, `billing`, `registry`, `events`, `shared`) e suas fronteiras por portas; `bootstrap` e `container`; e o ciclo de uma requisição HTTP (request id, contexto de log, ordem de montagem das rotas, parsers por rota e por que não há parser global, autenticação, `asyncHandler`, middleware de erro e fallback 404), com diagrama.

#### Scenario: Por que não há express.json global
- **WHEN** um revisor pergunta por que `src/app.ts` não registra parser global
- **THEN** o documento de ciclo da requisição explica a necessidade do corpo cru do Stripe e do form-urlencoded do Bitrix

### Requirement: Fluxos principais documentados
A documentação técnica MUST descrever com diagramas de sequência os fluxos: instalação no Bitrix24 (página, `POST /v1/install`, instalador do app, retry, eventos de instalação/remoção); cofre de tokens (cifragem, renovação agendada e sob demanda, erro de autenticação); sessão do iframe (verificação de auth do Bitrix, JWT, JWKS e rotação de chave); cobrança (checkout, webhooks Stripe, espelhamento nos SPAs, eventos dos SPAs, varreduras de reconciliação, trial, reembolsos e disputas); e entrega de eventos aos apps (outbox, assinatura HMAC, retries, dead-letter, reenvio).

#### Scenario: Investigar evento não entregue
- **WHEN** um operador precisa entender por que um app não recebeu `subscription.renewed`
- **THEN** o documento de processamento assíncrono mostra os estados do outbox, a política de retry, onde ver tentativas (`GET /admin/events`) e como reenviar

### Requirement: Segurança e dados
A documentação técnica MUST descrever os mecanismos de segurança (hash da chave de API, tokens de operador, cifragem AES-256-GCM e formato `v1:`, HMAC dos webhooks e janela de 5 minutos, rotação com carência, assinatura e verificação do JWT, verificação do Stripe, CORS da sessão, o que nunca é logado) e o modelo de dados (cada modelo Prisma, propósito, relações e dados sensíveis cifrados), com diagrama entidade-relacionamento.

#### Scenario: Auditoria de segredos
- **WHEN** um auditor pergunta onde e como `client_secret` e tokens do Bitrix são guardados
- **THEN** o documento de segurança indica os campos cifrados, o algoritmo, a origem da chave (`TOKEN_ENCRYPTION_KEY`) e o comportamento sem chave

### Requirement: Operação, configuração e erros
A documentação técnica MUST descrever: as filas e agendamentos do worker (nome, frequência, idempotência, concorrência); observabilidade (formato e campos de log, métricas Prometheus expostas, `/health` vs `/health/ready`); todas as variáveis de ambiente de `src/config/env.ts` (obrigatoriedade, padrão, efeito); e o catálogo de códigos de erro (código, status, origem, significado, ação). O catálogo MUST ser o mesmo usado pelo contrato OpenAPI, sem cópia manual divergente.

#### Scenario: Variável nova sem documentação
- **WHEN** um desenvolvedor adiciona uma variável ao schema de `src/config/env.ts` sem documentá-la em `docs/technical/configuration.md`
- **THEN** a suíte de testes falha apontando a variável ausente

#### Scenario: Consultar agendamento
- **WHEN** alguém quer saber de quanto em quanto tempo os tokens são renovados
- **THEN** o documento de processamento assíncrono informa o agendamento `refresh-tokens` (60 s) e o critério de renovação

### Requirement: Documentos existentes interligados
`README.md` e `docs/apps-integration.md` MUST apontar para a referência da API e para a documentação técnica, e as tabelas de rotas e códigos de erro de `docs/apps-integration.md` MUST remeter à referência como fonte oficial dos campos.

#### Scenario: Time de app lê o guia
- **WHEN** um desenvolvedor do app lê a seção de cobrança de `docs/apps-integration.md`
- **THEN** encontra link para as operações correspondentes em `/docs` e em `docs/api/openapi.json`
