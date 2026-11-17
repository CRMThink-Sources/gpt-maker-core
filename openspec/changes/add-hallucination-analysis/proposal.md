# Proposal

## Why

Quando o agente inventa uma resposta (preço, prazo, política que não existe na base), o cliente só percebe lendo a conversa e não sabe se o erro vem de uma lacuna na base de conhecimento, de uma contradição entre itens ou do comportamento do agente. Hoje a revisão por IA olha só o formulário da função; ela não parte de uma conversa real em que o agente errou. Pedir à IA que analise essa conversa fecha o ciclo: do erro observado à correção aplicável na base.

## What Changes

- Na tela da função (onde já está o "Revisar com IA"), novo botão **Analisar alucinação**: o cliente escolhe uma conversa do agente, opcionalmente aponta a resposta que errou e descreve o que estava errado, e a IA devolve o diagnóstico.
- **Origem das conversas**: (a) chat de teste do agente, já guardado localmente; (b) conversas reais, lidas da API do GPTMaker (`GET /v2/workspace/{workspaceId}/chats` filtrado por `agentId`, e `GET /v2/chat/{chatId}/messages`), filtradas pelo tenant. O texto das conversas reais **não é gravado** aqui.
- **Diagnóstico por IA** (Vibecode): para cada resposta do agente analisada, diz se está sustentada pela base, sem base ou contradiz a base, cita o trecho, explica o motivo e a causa provável (falta na base, itens em conflito, comportamento permissivo, extrapolação do modelo).
- **Sugestão aplicável** com botão **Aplicar** no formulário, sem salvar nem publicar: item novo para um campo de base ou troca do texto de um item existente, sem inventar dado do negócio (marcador `[preencher: …]`), como na revisão e na análise de cobertura atuais.
- Mesma chave e mesma cobrança da revisão: chave Vibecode do cliente (sem custo) ou da CRMThink (créditos por análise, idempotente, sem débito em falha), com os mesmos limites por cliente e global.
- Para reaproveitar sem duplicar, o núcleo de IA da revisão (escolha de chave, chamada ao Vibecode com validação de saída, limites, saldo e débito) é extraído de `FunctionReviewService` para um componente compartilhado, sem mudar o comportamento da revisão.
- Novos métodos e schemas zod no `GptMakerClient` para listar chats e ler mensagens (hoje não existem).
- **Fora do escopo**: corrigir o comportamento do agente automaticamente, aplicar a sugestão sem o cliente ver, gravar conversas reais localmente, análise em lote de várias conversas, e sugestões para o texto de comportamento (o diagnóstico pode citá-lo, mas o **Aplicar** só atua em itens de base).

## Capabilities

### New Capabilities

- `agent-hallucination-analysis`: escolher uma conversa (teste ou real) de um agente, diagnosticar por IA as respostas sem base na função e na base de conhecimento, e sugerir correção aplicável no formulário, com chave, créditos, limites e isolamento por tenant.

### Modified Capabilities

<!-- Nenhuma: a revisão por IA e a análise de cobertura mantêm seus requisitos; a nova capability reutiliza a mesma chave e as mesmas regras de cobrança. -->

## Impact

- Backend: `backend/src/modules/gptmaker/` (`listChats`, `listChatMessages` e schemas), `backend/src/modules/function-review/` (extração do núcleo de IA; novo serviço e controller da análise; prompt e schema de saída), `backend/src/modules/agent-test/` (leitura das conversas de teste pelo mesmo contrato), config (`HALLUCINATION_CREDITS_PER_ANALYSIS`).
- Contratos: `packages/contracts` (conversa listada, mensagem, pedido de análise, resultado, sugestão).
- Frontend: tela da função (botão, modal de escolha da conversa, resultado e Aplicar), `lib/` e i18n pt-BR/en/es.
- Créditos: novo tipo de débito no razão (`refType` próprio, aparece no extrato como "Análise de alucinação"). Sem migration de schema prevista.
- Privacidade: o texto da conversa de cliente final vai ao Vibecode; a tela avisa antes de enviar.
