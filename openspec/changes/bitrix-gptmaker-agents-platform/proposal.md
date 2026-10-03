## Why

Temos uma conta PARTNER no GPTMaker com criação de agentes e créditos ilimitados, pagos por consumo ao fim de cada período. Hoje não existe um produto que permita a clientes Bitrix24 criarem e operarem agentes de IA próprios sobre essa conta, nem um mecanismo para revender esse consumo em planos pré-pagos com controle de saldo. Esta change cria essa aplicação do zero, transformando o custo variável do GPTMaker em receita recorrente com margem controlada.

## What Changes

- Nova aplicação Bitrix24 (instalável como app local, preparada para marketplace), multi-tenant por portal (`member_id`). Instalação, tokens OAuth, sessão do iframe e desinstalação ficam no módulo `installations` do **`crmthink-platform`**; o app implementa apenas o instalador (handlers e chatbots) e consome tokens e sessões da plataforma.
- Frontend NextJS carregado dentro do Bitrix (iframe) para o cliente criar, configurar, treinar, inativar e reativar agentes.
- Backend TypeScript (NestJS) que espelha cada agente no GPTMaker (API `https://api.gptmaker.ai/v2`) em **um único workspace partner compartilhado por todos os clientes**, gerenciado pela plataforma (registro, nomenclatura, detecção de divergências e órfãos, monitoramento de status/créditos do workspace).
- Catálogo de modelos de IA: tabela gerenciada no backoffice para cadastrar/remover modelos (código `prefferModel` do GPTMaker) com o custo em créditos por resposta.
- Gestão de treinamentos (TEXT, WEBSITE, VIDEO, DOCUMENT) refletida no agente GPTMaker.
- Canal de atendimento via chatbot Bitrix (`imbot.v2`) conectado às Linhas Abertas: mensagens do cliente final são repassadas à API de conversa do GPTMaker e as respostas voltam ao chat do Bitrix. Transferência para operador humano.
- Configuração de gatilhos: eventos de webhook do GPTMaker mapeados para ações no Bitrix (lead, negócio, comentário na timeline, etc.).
- Billing por créditos: planos com cota de créditos, saldo por tenant, ledger imutável, débito por resposta com base nos créditos reais gastos (1 crédito do cliente = 1 crédito GPTMaker; margem embutida no preço do plano), bloqueio ao zerar saldo e reconciliação diária com `credits-spent`.
- Pagamentos e assinaturas delegados ao módulo `billing` do **`crmthink-platform`** compartilhado entre as aplicações CRMThink (change própria, repositório próprio): Stripe (Checkout embutido, renovação, pacotes, portal, estornos) e SPAs do portal CRMThink (Instalações, Assinaturas, Itens de assinatura, Planos) ficam no serviço. Este app consome eventos assinados do serviço e aplica a política do GPTMaker: trial de 14 dias com 500 créditos, créditos por ciclo, carência de 1 dia (fim de semana empurra para segunda), inativação de agentes e avisos. Cada agente é espelhado como item de assinatura não cobrável.
- Backoffice interno para gerenciar planos, tenants, concessão de créditos, catálogo de modelos, workspace e relatório de consumo do partner.
- Infraestrutura: RabbitMQ (filas e DLQ), Redis (cache, locks, idempotência, rate limit), PostgreSQL, Docker Compose em Droplet DigitalOcean, DigitalOcean Spaces para arquivos e CI/CD com GitHub Actions.

## Capabilities

### New Capabilities
- `bitrix-app-installation`: instalador do app chamado pela plataforma, tokens e `application_token` obtidos da plataforma, desinstalação por evento, sessão do iframe emitida pela plataforma (JWT validado por JWKS) e permissões do app.
- `gptmaker-workspace`: gestão do workspace partner único compartilhado (configuração, convenção de nomes, sincronização e detecção de órfãos/divergências, monitoramento de status e créditos do workspace, isolamento de recursos globais).
- `ai-model-catalog`: cadastro, edição de custo, desativação e remoção de modelos de IA disponíveis para os agentes, com histórico de custos.
- `agent-management`: criação, edição de configurações (incluindo modelo), inativação, reativação e remoção de agentes, sincronizados com o GPTMaker, com limite de 5 agentes por tenant.
- `agent-training`: cadastro, edição, listagem e remoção de treinamentos do agente, refletidos no GPTMaker.
- `bitrix-chatbot-channel`: registro do chatbot no Bitrix, roteamento de mensagens Linhas Abertas ↔ GPTMaker, transferência para humano e tratamento de saldo insuficiente.
- `agent-triggers`: configuração de gatilhos que ligam eventos de webhook do GPTMaker a ações no Bitrix24.
- `credit-billing`: planos, saldo, ledger, débito por resposta, alertas de consumo e bloqueio por saldo.
- `payments-integration`: consumo do módulo `billing` do `crmthink-platform` (trial liberado por formulário de cadastro, checkout embutido, troca de plano, portal, eventos de assinatura/compra/estorno, carência, itens de assinatura por agente, projeção local da assinatura).
- `usage-reconciliation`: reconciliação diária do consumo estimado com o consumo real do GPTMaker e relatório de consumo do partner por período.
- `admin-backoffice`: painel interno para operação (planos, tenants, créditos, modelos, workspace, relatórios, auditoria).

### Modified Capabilities
<!-- Nenhuma: projeto novo, sem specs existentes. -->

## Impact

- **Código novo**: monorepo com `backend/` (NestJS, TypeScript, Node 24 LTS), `frontend/` (NextJS), `packages/contracts/` (tipos e schemas compartilhados), `infra/` (Docker Compose, Caddy, configs), workflows GitHub Actions.
- **Integrações externas**: API REST GPTMaker v2 (token do partner), API REST Bitrix24 dos clientes (OAuth, `imbot.v2.*`, `imopenlines.*`, `crm.*`), API do `crmthink-platform` (REST + eventos HTTP assinados), Stripe.js no frontend apenas para montar o Checkout embutido.
- **Dependências de infra**: PostgreSQL, RabbitMQ, Redis, DigitalOcean Droplet + Spaces, GitHub Container Registry; `crmthink-platform` disponível (dependência de rollout).
- **Financeiro**: saldo dos clientes é dado crítico (ledger auditável); custo do partner no GPTMaker conciliado com débitos; assinaturas com fonte da verdade no SPA, mantidas pelo `crmthink-platform`; o app guarda só uma projeção local.
- **Segurança**: tokens OAuth do Bitrix ficam só na plataforma; segredos do app (GPTMaker, chave de API e segredo HMAC do `crmthink-platform`) fora do código; validação de assinatura dos eventos do serviço e de origem dos webhooks; isolamento entre tenants no workspace compartilhado.
