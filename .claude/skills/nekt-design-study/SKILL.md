---
name: nekt-design-study
description: Estudo de arquitetura e design de produto do Nekt (plataforma de dados e contexto para agentes de IA) — Context Layer, MCP Gateway, padrões de ferramentas para agentes, permissões e governança — e como traduzir essas decisões para o GPTThink (white label do GPTMaker Conector da CRMThink). Use esta skill sempre que alguém perguntar como o Nekt foi pensado, como funciona a camada de contexto / context documents / semantic layer do Nekt, por que o Nekt usa confirmação em duas fases, setup link, dispatcher de ferramentas ou tokens escopados, ou quando o time do GPTThink quiser se inspirar no Nekt para desenhar contexto, treinamento, comportamento, ações ou permissões dos agentes — mesmo que a pessoa não diga "Nekt" explicitamente mas fale em "modelo de contexto", "simplificar treinamento" ou "o jeito do Nekt".
---

# Como o Nekt foi pensado — estudo para o GPTThink

Esta skill existe para um desenvolvedor da CRMThink entender **as decisões de design** do Nekt e reaproveitar o que faz sentido no **GPTThink**, o white label do GPTMaker Conector (agentes de IA do GPT Maker atendendo nos Canais Abertos do Bitrix24).

Ela não é um manual de uso do Nekt. O foco é o *porquê* de cada decisão e o *como* adaptar.

Responda no idioma em que a pessoa escrever.

## A tese do Nekt em uma frase

Agente de IA bom não depende de mais instrução — depende de **contexto curado, ligado aos recursos reais, entregue no momento certo e com permissão**. O Nekt se posiciona como "plataforma de contexto para a era dos agentes": ele junta os dados da empresa num lugar governado e coloca, ao lado dos dados, uma biblioteca de definições de negócio que todo agente lê antes de agir.

## O problema que o GPTThink tem e o Nekt já resolveu

No GPT Maker o cliente precisa decidir sozinho o que é **comportamento** (prompt de sistema, campo de 3000 caracteres) e o que é **treinamento** (base de conhecimento). Na prática ele mistura os dois, coloca instrução no treinamento e conhecimento demais no agente errado (o caso do SDR da CRMThink que "sabia tudo do Bitrix24" e parou de qualificar).

O Nekt evita essa classe de erro com três decisões:

1. **Um conceito só para o usuário:** o *documento de contexto*. A pessoa escreve o que é verdade sobre o negócio, em prosa, um conceito por documento. Ela nunca escreve prompt.
2. **Contexto ancorado em recursos reais:** cada documento tem *anotações* que apontam para tabelas, campos, pipelines e outros documentos. O texto não fica solto.
3. **O sistema decide o que entra no prompt, na hora:** busca semântica escolhe os documentos relevantes para cada pergunta e injeta antes do passo que gera a resposta. O usuário não monta o contexto à mão.

## Os 8 padrões de design que valem estudar

| # | Padrão no Nekt | Ideia central | Onde ler |
|---|---|---|---|
| 1 | Context Layer | Prosa + anotações, um conceito por documento, recuperado por busca semântica antes de agir | `references/02-context-layer.md` |
| 2 | Templates de partida | O usuário começa de um modelo (receita, funil, clientes ativos) ou pede para o agente propor o que documentar | `references/02-context-layer.md` |
| 3 | "Deixe um agente montar sua biblioteca" | O cliente entrega os materiais que já tem; um agente estrutura em documentos; o humano revisa | `references/02-context-layer.md` |
| 4 | Fluxo guiado de ferramentas | Ordem fixa: contexto → recursos → gerar → executar | `references/03-ferramentas-para-agentes.md` |
| 5 | Confirmação em duas fases | Toda escrita relevante devolve primeiro uma prévia; só grava com `confirm=True` | `references/03-ferramentas-para-agentes.md` |
| 6 | Rascunho → link de configuração → publicar | Segredos nunca passam pelo chat; terceiros preenchem credenciais por um link de 24h sem acessar o workspace | `references/03-ferramentas-para-agentes.md` |
| 7 | Dispatcher de ferramentas | Lista curta de ferramentas principais; as raras e as "ao vivo" ficam atrás de `descobrir → executar` | `references/03-ferramentas-para-agentes.md` |
| 8 | Permissão herdada + token escopado + log por ferramenta | O agente nunca vê mais que a pessoa; tokens só estreitam; toda chamada fica auditada | `references/04-permissoes-e-governanca.md` |

## Como usar esta skill

- **Pergunta conceitual** ("como funciona o contexto do Nekt?", "por que duas fases?"): responda direto com base no arquivo de referência certo. Uma resposta curta, com o porquê.
- **Pergunta de design do GPTThink** ("como aplico isso no nosso produto?"): leia `references/05-traducao-para-gptthink.md`. Ele tem o mapeamento conceito a conceito, o modelo de dados sugerido e o que **não** copiar.
- **Visão geral / onboarding de alguém novo:** comece por `references/01-visao-geral.md` e depois o quadro acima.
- **Se a pessoa tiver o MCP do Nekt conectado**, dá para mostrar os padrões ao vivo: `get_semantic_context` (leitura de contexto), `create_context_document` sem `confirm` (ver a prévia da escrita em duas fases), `list_semantic_layer_folders` (pastas com permissão). Use só ferramentas de leitura ou prévias, e nunca confirme escritas no workspace do cliente só para demonstrar.

## Cuidados ao responder

- **Separe fato de inferência.** O que está nos arquivos de referência como "Fato (docs)" veio da documentação pública do Nekt. O que está como "Leitura de design" é interpretação nossa sobre o motivo da decisão. Não apresente inferência como fato.
- **O Nekt é plataforma de dados, o GPTThink é atendimento.** Nem tudo se transfere. Lakehouse, SQL, camadas físicas e pipelines não têm equivalente direto; o que se transfere é o modelo de contexto, os padrões de ferramenta e a governança.
- **O GPT Maker continua sendo o motor.** Qualquer proposta precisa compilar para o que a API do GPT Maker aceita (campo de comportamento, treinamentos de texto, intenções, campos de contato). Ver a seção "Restrições do motor" em `references/05-traducao-para-gptthink.md`.
- **Documentação muda.** Os nomes de ferramentas do Nekt já foram renomeados uma vez (várias viraram versões genéricas com argumento `kind`). Para detalhe atual, consulte `https://docs.nekt.com/llms.txt` ou a página `.md` específica.

## Arquivos de referência

- `references/01-visao-geral.md` — o que é o Nekt, módulos, para quem, posicionamento.
- `references/02-context-layer.md` — a camada de contexto em profundidade: estrutura do documento, anotações, sintaxe, pastas, templates, boas práticas.
- `references/03-ferramentas-para-agentes.md` — como o Nekt desenha ferramentas para agentes: ordem de uso, duas fases, rascunho e link, dispatcher, mensagens de erro úteis.
- `references/04-permissoes-e-governanca.md` — token completo vs. escopado, herança do criador, resultado vazio ambíguo, log de acesso por ferramenta.
- `references/05-traducao-para-gptthink.md` — o mapeamento para o GPTThink, modelo de dados sugerido, roadmap e o que não copiar.
