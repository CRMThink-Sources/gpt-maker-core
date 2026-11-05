# Context Layer — o coração do modelo do Nekt

## Índice
1. O que é
2. Anatomia de um documento de contexto
3. Sintaxe das anotações
4. Como o agente usa o contexto
5. Organização: pastas e permissões
6. Como o usuário cria contexto (templates e "deixe um agente montar")
7. Boas práticas oficiais
8. Contexto também decide para onde ir (roteamento)
9. Por que funciona (leitura de design)

---

## 1. O que é

**Fato (docs):** a Context Layer (chamada também de Semantic Layer na API) é uma biblioteca de conhecimento de negócio que ancora a IA do Nekt nas definições da organização. Os documentos explicam o que as métricas significam, quais registros contam como cliente pagante, como as etapas do funil são definidas. **Todo agente que consulta os dados lê esses documentos antes de gerar SQL.**

Sem essa camada, o agente adivinha a partir de nomes de tabela e coluna. Com ela, responde do jeito que a empresa responderia.

**Fato (docs):** como a camada fica centralizada ao lado dos dados, qualquer agente que acessa o Nekt (Claude, Codex, Copilot…) trabalha com as mesmas definições. A mesma pergunta ("qual foi a receita do mês passado?") gera SQL diferente em empresas diferentes, porque cada uma tem sua própria definição de receita.

## 2. Anatomia de um documento de contexto

**Fato (docs):** cada documento combina duas coisas:

- **Prosa:** descreve uma métrica, segmento, regra ou definição em linguagem simples.
- **Anotações:** ligam a prosa a recursos específicos do workspace, para a IA saber exatamente a que tabelas, campos e pipelines a definição se refere.

Tipos de recurso que podem ser anotados: tabela, campo, camada (layer), Query, Notebook, Source, Destination, medida e **outro documento de contexto** (referência cruzada).

**Fato (docs):** quando o agente recupera um documento, as anotações já vêm resolvidas — nomes, camadas e descrições dos recursos — então o modelo recebe a definição de negócio e o esquema técnico no mesmo pacote.

**Fato (API):** o documento é uma nota em markdown. Campos relevantes do objeto:

| Campo | Descrição |
|---|---|
| `name` | Nome do documento |
| `content` | Corpo em markdown, onde ficam as menções |
| `mentions` | Somente leitura: as menções que o servidor extraiu do `content` |
| `folder` | Pasta na árvore; `null` = raiz |

Você envia só `content`; o servidor faz o parse das menções.

## 3. Sintaxe das anotações

**Fato (API/MCP):** as menções são escritas no próprio texto no formato `@tipo::identificador`, por exemplo `@table::silver.orders`. Os tipos citados nas ferramentas MCP incluem `@table`, `@field`, `@layer`, `@measure`, `@transformation`, `@source`, `@destination` e `@context`.

Exemplo ilustrativo (montado por nós, não tirado da documentação):

```markdown
# Cliente ativo

Consideramos cliente ativo quem tem assinatura com status "active" ou "past_due"
há menos de 30 dias. Contas internas de teste nunca contam.

- Fonte: @table::silver.subscriptions
- Status: @field::silver.subscriptions.status
- Contas de teste são definidas em @context::contas-internas

Exemplo que conta: assinatura "past_due" há 12 dias.
Exemplo que não conta: assinatura "active" da conta "crmthink-teste".
```

**Leitura de design:** a menção resolve dois problemas de uma vez — o modelo sabe *a que* o texto se refere, e o sistema sabe *quais documentos dependem de qual recurso* (dá para avisar quando um campo some, por exemplo). Existe inclusive uma ferramenta (`resolve_references`) para seguir as anotações e puxar contexto relacionado que não veio na primeira busca — a camada vira um grafo, não uma pilha de textos.

## 4. Como o agente usa o contexto

**Fato (docs):** quando alguém faz uma pergunta pelo MCP ou por outra integração de IA, o Nekt roda uma **busca semântica** sobre os documentos de contexto e injeta os mais relevantes no passo de geração de SQL. O agente lê as regras de negócio primeiro e depois escreve a consulta.

No MCP isso é a ferramenta `get_semantic_context`, descrita como o **primeiro passo** do fluxo de consulta. O caminho completo é: ler o contexto → achar as tabelas → gerar SQL → executar.

**Fato (docs):** um documento salvo é indexado imediatamente; a próxima pergunta sobre aquele tema já o usa.

**Leitura de design:** o usuário nunca "monta o prompt". Ele mantém uma biblioteca; o sistema escolhe, a cada pergunta, o pedaço pequeno e relevante. Isso escala melhor que um prompt de sistema gigante e evita que conhecimento irrelevante polua a resposta.

## 5. Organização: pastas e permissões

**Fato (docs):** a camada de contexto é organizada em **pastas, cada uma com suas próprias regras de acesso** (aplicadas nos planos Growth e Custom). Consequências que a documentação destaca:

- Onde o documento é arquivado é uma decisão real: um documento na pasta errada fica invisível para quem precisava dele.
- Criar documento sem pasta joga na raiz, onde a maioria dos usuários não pode escrever. Por isso o agente lista primeiro as pastas em que o usuário pode escrever.
- Ler exige acesso à pasta; editar exige Editor; **apagar exige Manager**, um nível acima.

## 6. Como o usuário cria contexto

**Fato (docs):** dois caminhos na interface.

**a) Começar de um template ou do zero.** Templates oferecidos:

- Receita e MRR
- Definição de cliente ativo
- Definição das etapas do funil de vendas (MQL, SAL, SQL…)
- Uso do produto e créditos
- Regras transversais (exclusões, soft delete, moedas)
- **"Não sabe por onde começar?"** — o agente explora o workspace e propõe o que documentar primeiro.

Depois: escrever a definição em prosa ("explique como explicaria a um analista novo", focando em intenção — o que conta, o que não conta e por quê), adicionar anotações e salvar.

**b) Deixar um agente montar a biblioteca.**

1. Juntar o que a empresa já tem escrito (definições, docs de onboarding, wiki, planilhas de regras).
2. Entregar os arquivos numa conversa com um agente conectado ao MCP do Nekt.
3. Pedir que ele estruture como documentos de contexto, já com anotações apontando para tabelas e campos que existem.
4. **Revisar antes de salvar** — "você continua sendo dono das definições".

A documentação ainda recomenda usar o tempo antes da conexão para **curar**: decidir o que vale documentar e descartar o resto.

## 7. Boas práticas oficiais (parafraseadas)

- **Prosa + anotações em vez de SQL cru.** Descreva o que a métrica *significa*, não como calcular. Esquemas mudam; definições não.
- **Suba só o que importa.** Contexto útil é o menor conjunto de informação de alto sinal. A documentação desorganizada que confunde um analista novo também confunde o agente — filtre antes, não depois.
- **Inclua exemplos.** Um registro que conta, um que não conta, um cálculo resolvido. Exemplo concreto resolve ambiguidade mais rápido que mais texto.
- **Um conceito por documento.** Fica mais fácil recuperar com precisão.
- **Referencie em vez de repetir.** Se "cliente ativo" já está definido, aponte para aquele documento.
- **Atualize quando a regra mudar.** Uma definição desatualizada é pior que nenhuma: o agente vai segui-la com confiança.

## 8. Contexto também decide para onde ir (roteamento)

**Fato (docs):** além dos dados no warehouse, o Nekt permite anexar MCPs externos (HubSpot, Slack, Stripe, bancos…) — os chamados *Live Data*. O `get_semantic_context` é o que decide se uma pergunta deve ser respondida pelo warehouse ou por uma conexão ao vivo, e qual conexão.

**Fato (docs):** depois que o agente roteia uma pergunta para uma ferramenta ao vivo, ele normalmente oferece **salvar um documento de contexto registrando esse roteamento**, para que a próxima pergunta parecida vá direto ao lugar certo. Ou seja: o próprio uso alimenta a camada de contexto.

**Leitura de design:** contexto não é só "o que é verdade"; é também "onde procurar". Isso é muito próximo do problema do GPTThink: o agente precisa saber quando responder pela base de conhecimento e quando consultar o CRM ao vivo.

## 9. Por que funciona (leitura de design)

1. **Um único conceito para o usuário.** Não há "comportamento" vs. "treinamento" vs. "instrução". Há documentos sobre o negócio.
2. **Granularidade certa.** Um conceito por documento permite recuperação precisa e manutenção barata.
3. **Ancoragem.** Anotações transformam texto solto em mapa do negócio ligado a recursos reais.
4. **Recuperação just-in-time.** O sistema escolhe o contexto por pergunta; ninguém mantém um prompt monolítico.
5. **Curadoria assistida.** O agente faz o trabalho chato (estruturar, anotar); o humano revisa e decide.
6. **Ciclo de aprendizado.** Decisões tomadas no uso (roteamentos) viram documentos.

## Fontes

- https://docs.nekt.com/semantic-layer/overview.md
- https://docs.nekt.com/platform-api/semantic-layer/document.md
- https://docs.nekt.com/mcp-server/tools.md (seções "Querying data", "Adding context", "Live Data")
- https://docs.nekt.com/mcps/overview.md
