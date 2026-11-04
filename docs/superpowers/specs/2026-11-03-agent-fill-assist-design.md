# Ajuda da IA para preencher a função do agente — design

Data: 2026-11-03. Status: rascunho para aprovação.

## Intenção e por quê

O cliente do GPTThink escolhe uma função (Suporte, SDR, Agendamento, Pós-venda, e as geradas pela
skill `gptthink-criar-funcao`) e responde um formulário que vira o comportamento, os treinamentos e
as intenções do agente. A revisão por IA (`backend/src/modules/function-review`) já avalia o que o
cliente escreveu. Falta ajudar **antes**: o cliente que olha para um campo de texto vazio ou para
uma base de conhecimento vazia e não sabe por onde começar.

Não há dor medida com clientes reais. É uma melhoria preventiva, para facilitar a configuração.
Por isso a primeira versão é opcional, pequena e ajustável sem deploy.

## Objetivos

- Botão opcional "Ajuda da IA" no formulário da função. Sem clicar, o fluxo é exatamente o de hoje.
- O cliente descreve a empresa e o agente em poucas linhas e responde a perguntas de entrevista em
  linguagem de leigo, definidas por campo.
- **Campos de texto** (`TEXT`, `TEXT_LIST`): a IA redige o texto do campo a partir das respostas.
- **Base de conhecimento** (`KNOWLEDGE`): a IA propõe o esqueleto de itens (título e pergunta guia
  em `[preencher: …]`) e, quando o cliente já deu informação, redige o conteúdo do item.
- O resultado entra no assistente de aplicar sugestões que já existe (`agent-review-wizard`): o
  cliente aceita, edita ou pula. Nada é publicado sem ele.
- **Parametrizável no backoffice**, por função e por campo: perguntas de entrevista, instruções
  para a IA, liga/desliga da ajuda e o modo (redigir ou só montar o esqueleto).
- Atualizar a skill `gptthink-criar-funcao` para gerar essas perguntas e instruções, e ajustar os
  seeds das funções padrão para trazê-las.

## Não objetivos

- Campos de escolha (`CHOICE`, `MULTI_CHOICE`, `INTEGER`, `AGENT`, `BITRIX_SPA`): ficam de fora.
- Ler site ou URL do cliente (evita buscar páginas externas na primeira versão).
- Conversa de várias rodadas com a IA. É uma entrevista de uma rodada.
- Substituir ou alterar a revisão por IA existente. As duas coexistem; a revisão continua sendo a
  segunda camada, que o cliente pode rodar depois de aplicar a ajuda.

## Anti-objetivos (falha mesmo que tecnicamente funcione)

- A IA inventar fato do negócio (preço, prazo, política, horário). O que ela não souber vira
  `[preencher: …]`.
- A ajuda virar obrigatória ou mudar o comportamento de quem não a usa.
- Texto gerado estourar o limite de caracteres do campo ou do comportamento (3000 no pior caso).

## Restrições

- Reaproveitar o que a revisão já tem: chamada ao modelo (`VIBECODE_REVIEW_MODEL`), chave de IA do
  tenant, limite por tenant, cobrança no razão e saída validada por schema.
- Respeitar os limites do template (tamanho por campo e orçamento do comportamento).
- Nada é publicado sem o cliente aplicar e publicar; o rascunho do formulário já cobre o desfazer.
- Marcador `[preencher: …]` pendente continua bloqueando a publicação, como hoje.

## Decisões do usuário

- Ajuda opcional; sem ela, o fluxo atual.
- Só campos de texto e base de conhecimento (a base é onde a ajuda mais vale: o cliente sabe o
  conteúdo mas não sabe como começar).
- A IA pode redigir o conteúdo; se não se comportar bem, ajusta-se depois.
- Parametrização no backoffice sempre que possível.
- Atualizar a skill `gptthink-criar-funcao` e os seeds das funções padrão.
- Entrega em duas fatias, nesta ordem: (1) campos de texto, (2) base de conhecimento.

## Pontos propostos por mim (o usuário concordou com o desenho; os detalhes abaixo são meus)

- As perguntas de entrevista e as instruções da IA moram no template da função, ao lado dos campos.
- O liga/desliga e o modo (redigir ou só esqueleto) são por função, editáveis no backoffice.
- Entrada do cliente: texto livre sobre a empresa e o agente, mais as respostas da entrevista.

## Fatias (decisão do usuário)

- **Fatia 1, campos de texto (`TEXT`, `TEXT_LIST`):** já sai com a parametrização completa no
  backoffice (perguntas de entrevista, instruções para a IA, liga/desliga por função) e com a skill
  `gptthink-criar-funcao` atualizada para gerar esses atributos.
- **Fatia 2, base de conhecimento (`KNOWLEDGE`):** esqueleto de itens, redação do conteúdo e o modo
  "só esqueleto".
- **Seeds das funções padrão (decisão minha, o usuário não fechou o prazo):** a fatia 1 inclui as
  perguntas dos campos de texto das funções padrão. Sem isso o botão não aparece nelas, já que o
  padrão é desligado; a fatia 2 inclui as da base.

## Decisões minhas depois da checagem do construtor (marcadas como minhas, não do usuário)

- **Padrão da ajuda:** desligada até a função definir perguntas ou instruções. Funções já
  publicadas e geradas antes da skill ficam sem o botão até alguém configurar no backoffice.
  Não há prompt genérico na primeira versão.
- **Edição no backoffice:** o editor de função já tem uma tela por campo
  (`frontend/src/app/admin/functions/editor/field-editor.tsx`) além da aba JSON. A parametrização
  entra como dois atributos novos do campo (perguntas de entrevista e instruções para a IA) nessa
  tela e no schema do template, não como uma tela nova. Como a mudança chega a tenants que já têm a
  função publicada segue o versionamento de template que já existe; o construtor confirma.
- **Campo já preenchido:** a ajuda só atua em campo **vazio** (texto) ou base **vazia**. Texto que o
  cliente já escreveu nunca é trocado; quem quiser melhorá-lo usa a revisão por IA.
- **Modo "só esqueleto":** vale apenas para `KNOWLEDGE`. Em `TEXT` e `TEXT_LIST` a ajuda sempre
  redige, deixando `[preencher: …]` onde faltar informação.
- **Limite de caracteres:** a IA recebe o limite do próprio campo. O orçamento de 3000 do
  comportamento continua sendo barrado na publicação, como hoje.
- **Critério de liberação:** nenhum caso do eval com fato inventado (preço, prazo, política) e
  nenhum texto acima do limite.

## Adendo: assistente de criação do agente (decisão do usuário, 2026-11-03)

- A ajuda também aparece no **assistente de criação do agente**, onde o formulário está todo vazio e o
  cliente mais trava. A fatia 1 entregou só a tela da função de um agente já criado (decisão minha,
  que não foi avisada na hora; corrigida aqui).
- Como ainda não há agente, a chamada vai por **código da função**
  (`POST /app/agent-functions/:code/assist`), com a mesma lógica, a mesma cobrança e as mesmas regras
  de prompt. Usa a versão mais recente publicada e a disponibilidade da função para o portal.
- O botão fica **sempre visível** quando a função tem a ajuda configurada: desabilitado, com o
  motivo, quando não há campo vazio para ajudar. Sem a ajuda configurada, nada muda na tela.
- Plano: `docs/superpowers/plans/2026-11-03-agent-fill-assist-creation.md`.

## Deixado para quem construir

- Forma exata do contrato e do schema (campos novos no template, endpoint, formato da saída).
- Se a geração é uma chamada por campo ou em lote.
- Como a entrevista aparece na interface e como se liga ao assistente existente.
- Como o preço da ajuda entra na cobrança e no limite por tenant, seguindo o padrão da revisão.
- Casos do eval (`function-review/eval`) para medir invenção de fatos, uso de marcador e limites.
- A migração dos seeds e a regeneração da referência da skill
  (`scripts/gerar-referencia.ts`, `blocos.json`, exemplos, teste `skill-validator.test.ts`).
