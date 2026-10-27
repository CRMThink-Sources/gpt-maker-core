# Design

## Context

Hoje o agente é criado por `createAgentSchema` (`packages/contracts/src/agents.ts`) com `behavior` (3000) e `jobDescription` (500) livres. Treinamentos (`training`) aceitam `TEXT` (1028), `WEBSITE`, `VIDEO` e `DOCUMENT`. Intenções (`agent_intention`) já suportam o tipo `BITRIX`, com as ações dos gatilhos e `TRANSFER_TO_HUMAN`. O backoffice (`/admin`, módulo `backoffice`) já tem autenticação própria e auditoria.

Restrições do GPT Maker que moldam o desenho (`docs/gptmaker-api.md`):
- comportamento ≤ 3000 caracteres; só treinamento `TEXT` é atualizável;
- criar treinamento devolve só `{ success }`, sem id; criar intenção também não devolve id (hoje resolvido listando depois);
- `onLackKnowLedge` nunca disparou nos testes;
- não controlamos como o motor recupera treinamentos.

O desenho completo do produto está no documento "GPTThink — Funções do agente por formulário" (https://claude.ai/artifact/2HXuoSuNazfM6mdPDRxCq3), incluindo os formulários das quatro funções. Requisitos: ver `specs/`.

## Goals / Non-Goals

**Goals:**
- Um compilador único, puro e determinístico, usado pelo backend (publicação) e pelo frontend (contador e prévia ao vivo).
- Publicação retomável e idempotente apesar de o GPT Maker não devolver ids na criação.
- Templates editáveis no backoffice sem risco para agentes em produção.

**Non-Goals:**
- Condicionais no texto do template.
- Funções criadas por parceiros; templates por tenant.
- Consulta ao CRM em tempo real, integração com calendário, pós-venda proativo, treinamento por arquivo.
- Migrar agentes existentes (são descartados).

## Decisions

### D1. Compilador em `packages/contracts`
O compilador (`compileAgent(templateVersion, answers, mode) → { behavior, trainings[], intentions[], settings, report }`) é uma função pura em `packages/contracts`, sem I/O. O frontend usa o mesmo código para o contador de caracteres e a prévia; o backend, para publicar e validar o orçamento no backoffice.
- *Alternativa:* compilar só no backend e o frontend chamar uma rota de prévia a cada digitação. Rejeitada: latência no contador e risco de o número do formulário divergir do publicado.

### D2. Definição do template como JSON validado por zod
A versão do template é um documento JSON: `fields[]` (tipos da spec, limites, opções com `label` e `snippet`, `dependents[]`), `knowledgeBlocks[]` (itens da base com subcampos e formato de renderização do treinamento), `behavior` (texto com `{{marcadores}}`), `intentions[]` (definições com marcadores, ligadas a escolhas que as ativam) e `settings`. O schema zod em `packages/contracts` valida o JSON na edição e na publicação. A sintaxe de marcador reaproveita a de `templates.ts` (`{{caminho}}`), sem o valor padrão.
- *Alternativa:* modelar campos e opções em tabelas relacionais. Rejeitada: a versão é imutável e lida inteira; JSON com schema é mais simples de versionar, comparar e copiar.

### D3. Blocos resolvidos na publicação (snapshot)
Blocos compartilhados (`agent_function_block`) são editados à parte, mas publicar uma versão de template grava o conteúdo **expandido** (blocos já incluídos). A versão nunca referencia um bloco vivo. Assim a imutabilidade da versão vale também para os blocos, e uma correção de bloco só chega aos agentes via nova versão + republicação, como pede a spec.

### D4. Modelo de dados
- `agent_function_template` — código, nome, descrição, rascunho (JSON), `updated_at`.
- `agent_function_template_version` — template, número, conteúdo expandido (JSON), `published_by`, `published_at`. Imutável.
- `agent_function_block` — código, conteúdo (JSON), rascunho.
- `agent_function_config` — 1:1 com `agent`: template, versão publicada, respostas publicadas, respostas em rascunho, `mode` (`SIMPLE` | `ADVANCED` | `TAKEN_OVER`), instruções adicionais, comportamento assumido, hash do resultado publicado, estado da publicação (`IDLE` | `PENDING` | `FAILED`).
- `agent_managed_resource` — agente, tipo (`TRAINING` | `INTENTION`), chave estável do item/intenção no template, hash do conteúdo, id local (`training.id` / `agent_intention.id`).
- `tenant.is_partner` (boolean).
- `agent_intention.managed` e `training.managed` (boolean) para a tela e as recusas de edição.

Cada item da base nas respostas carrega um `itemKey` (uuid gerado no formulário). É ele que liga o item ao treinamento através das edições.

### D5. Publicação como plano + execução assíncrona
Publicar faz: (1) compila; (2) calcula o **plano** comparando o resultado com `agent_managed_resource` e com o comportamento/settings publicados (criar, atualizar, remover por chave e hash); (3) a prévia mostra esse plano; (4) ao confirmar, enfileira um job no RabbitMQ executado pelo worker, passo a passo, gravando o progresso em `agent_managed_resource` a cada passo. O frontend acompanha o estado da publicação.
- Ordem: settings e comportamento → remoções → atualizações → criações → intenções.
- **Ids que o GPT Maker não devolve:** após criar um treinamento `TEXT`, o worker lista os treinamentos do agente e associa pelo texto exato (o conteúdo é nosso e único por agente: o compilador prefixa cada item com o título). Intenções: mesma abordagem que já existe, pela descrição. Um passo sem id resolvido fica pendente e é reconciliado na repetição, sem recriar.
- Repetir uma publicação `FAILED` recalcula o plano contra o estado gravado, aplicando só o que falta.
- *Alternativa:* publicar síncrono na requisição HTTP. Rejeitada: dezenas de treinamentos e listagens podem passar do tempo de requisição e não há como retomar.

### D6. Primeira publicação cria o agente
O fluxo de criação vira: escolher função → formulário (rascunho no navegador) → prévia calculada sem agente (`POST /app/agent-functions/{code}/preview`, plano contra estado vazio) → publicar. Publicar envia função + respostas a `POST /app/agents`, que compila, cria o agente pela criação atual (`agent_creation_attempt`, webhooks, `prefferModel`) já com comportamento, tipo, tom, dados da empresa e settings compilados, grava a configuração da função e enfileira a publicação dos treinamentos e intenções (D5). O rascunho no servidor (`agent_function_config.draft_answers`) só existe para agentes já criados.
- *Alternativa descartada na implementação:* agente só local antes da primeira publicação. `agent.gptmaker_agent_id` é obrigatório e único, e chatbot, assinatura e limites dependem do agente existir no GPTMaker; afrouxar isso espalharia casos especiais por todos os módulos.
- O schema da criação antiga (com comportamento livre) vira o schema interno `agentProvisionSchema`, usado só pelo backend para aplicar o resultado compilado.

### D7. "Não sei" via intenção, não via evento
A intenção gerenciada "Registrar dúvida" é uma intenção `BITRIX` (comentário na timeline ou negócio + ação de escalonamento), e o comportamento de toda função instrui o uso dela. O gatilho `onLackKnowLedge` não é gerado. Em staging, testar `knowledgeByFunction` ligado; se reduzir respostas inventadas, ele passa a fazer parte dos settings derivados das funções (mudança de template, sem código).

### D8. Agente de sandbox
Um agente do workspace partner, com nome reservado (`[SANDBOX] Templates`), criado sob demanda pelo backoffice e registrado na configuração do workspace, fora de qualquer tenant. A prévia do rascunho é publicada nele pelo mesmo executor de D5. O consumo cai no workspace partner, que é pós-pago; nenhum tenant é debitado.

### D9. Modos
- `ADVANCED`: o compilador inclui as instruções adicionais (≤ 400); a tela de treinamentos libera `WEBSITE` e `VIDEO` (não gerenciados).
- `TAKEN_OVER`: guarda o comportamento editado em `agent_function_config`; o compilador ainda gera treinamentos, intenções e settings a partir das respostas, mas o comportamento publicado é o editado. O aviso de versão nova é suprimido. Voltar ao formulário apaga o comportamento editado e muda para `SIMPLE` ou `ADVANCED`.
- Permissão: `TAKEN_OVER` exige `tenant.is_partner`.

### D10. Seed das quatro funções
Os templates iniciais (SDR, Suporte, Agendamento, Pós-venda) e os blocos são carregados por um seed versionado no repositório, aplicado uma vez como versão 1. Depois disso o banco é a fonte da verdade e as mudanças vêm do backoffice. A skill de escrita de templates (`.claude/skills/`) orienta quem edita.

### D11. Remoção do treinamento por documento
`DOCUMENT` sai dos schemas de entrada, da rota de upload e da tela. O valor permanece no enum do Postgres (remover valor de enum é custoso e não há dados) e o storage de objetos deixa de ser usado para treinamentos.

### D12. Editor visual sobre o rascunho em memória
O editor do backoffice trabalha sobre um único objeto `FunctionTemplateDraft` em memória. As seções (geral, formulário, texto do agente, ações) são formulários que alteram esse objeto. A seção JSON é só outra visão dele: texto válido substitui o objeto, texto inválido não altera nada e mostra o erro. Salvar envia o objeto, como hoje. O mesmo editor, sem a seção geral, serve para os blocos.
- **Checagem ao vivo no navegador:** o editor busca os blocos publicados e roda `expandBlocks` + `checkTemplate` dos contratos a cada alteração (com atraso curto). É o mesmo código da publicação (D1), então o que o editor aprova o backend aprova.
- **Problemas com endereço:** `functionTemplateErrors` e `checkTemplate` passam a devolver também problemas estruturados (`{ where: { section, fieldId?, option?, intentionKey?, actionIndex? }, message }`). As mensagens de texto atuais continuam, derivadas desses problemas, para a API e os testes existentes.
- **Ids gerados:** o id do campo nasce do rótulo, com o prefixo da função (`suporte.canal_de_vendas`), e o valor da opção nasce do rótulo dela. Os dois ficam editáveis só enquanto não aparecem em nenhuma versão publicada: as respostas dos agentes são guardadas por id, e trocar um id publicado faria os agentes perderem a resposta.
- **Marcadores por contexto:** uma função dos contratos lista os marcadores válidos em cada ponto (texto do agente, trecho de opção, textos de intenção), e o editor só oferece esses. Nos textos de intenção entram também as variáveis de execução (`contact.*`, `fields.*` dos campos coletados) e `intencao.respostas` quando há `collectFrom`.
- **Ações por tipo:** comentário na timeline, lead, negócio, tarefa, processo de negócio e transferência têm formulário próprio. Funil, etapa, responsável e prazo são escolhidos entre os campos do formulário do tipo certo (`BITRIX_STAGE`, `BITRIX_USER`, `INTEGER`) ou informados como valor fixo. O que o formulário da ação não cobrir fica pela seção JSON.
- **Reordenar** campos, opções e ações com botões subir/descer, sem biblioteca de arrastar.
- **Nova função a partir de outra:** `POST /admin/functions` aceita `copyFrom` (código de uma função). O backend copia o rascunho daquela função; a nova nasce sem versões.
- *Alternativa:* um construtor guiado em passos ("qual a missão? quais perguntas?") que gera o template. Rejeitada por ora: o operador ainda precisaria ajustar o resultado num editor completo, e as funções novas tendem a nascer de uma existente.

### D13. Inativar e excluir função
`agent_function_template` ganha `active` e `deleted_at`. A lista de funções do app e a criação de agente consideram só as ativas e não excluídas; a republicação de agentes existentes usa `latestOfTemplate`, que ignora as duas marcas, então agentes de função inativa seguem normais. Excluir é lógico e exige zero agentes não removidos: as configurações dos agentes removidos e as versões continuam referenciando o template, e o código fica reservado para o seed (que só cria códigos inexistentes) não ressuscitar a função.
- *Alternativa:* exclusão física. Rejeitada: as chaves estrangeiras das configurações de agentes removidos e das versões exigiriam apagar histórico, e o seed recriaria as funções padrão.

## Risks / Trade-offs

- [Associar treinamento por texto falhar, por exemplo se o GPT Maker normalizar espaços] → comparar por texto normalizado; o prefixo de título deixa cada item único; em último caso o passo fica pendente e a repetição remove e recria só aquele item.
- [Orçamento de 3000 apertado no SDR e no Agendamento] → validação de pior caso bloqueia a publicação do template; o contador ao vivo mostra a folga ao cliente.
- [O modelo não usar "Registrar dúvida" e inventar resposta] → regra explícita no comportamento + teste de `knowledgeByFunction`; contar o uso da intenção para medir.
- [Granularidade de um treinamento por item não ser a melhor para a recuperação do GPT Maker] → o formato de renderização dos itens está no template, então dá para agrupar itens mudando o template, sem código.
- [Template mal escrito publicado] → sandbox antes de publicar; agentes só mudam ao republicar; rollback por nova versão.
- [Publicação longa deixar o agente em estado misto no GPT Maker] → a ordem de D5 aplica comportamento e settings primeiro e a base por último; o estado `PENDING`/`FAILED` aparece para o cliente com opção de repetir.

## Migration Plan

1. Descartar os agentes de teste: remover no GPT Maker e marcar como `DELETED` localmente (script único, executado em staging e produção).
2. Aplicar a migração (tabelas novas, `is_partner`, `managed`) e o seed das quatro funções e dos blocos.
3. Publicar backend e frontend com o novo fluxo de criação; a rota antiga de criação com `behavior` livre deixa de existir.
4. Rollback: os templates e as configurações ficam em tabelas novas; reverter o deploy volta ao fluxo anterior sem perda de dados de tenants (não há agentes reais).

## Open Questions

- Texto final dos quatro templates e dos trechos de cada opção: redigido e testado no sandbox antes do lançamento, sem impacto no código.
- Se `knowledgeByFunction` deve vir ligado por padrão: decidido pelo teste em staging (D7).
