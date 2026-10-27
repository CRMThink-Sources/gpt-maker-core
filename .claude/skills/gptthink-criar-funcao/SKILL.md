---
name: gptthink-criar-funcao
description: "Use quando alguém pedir para criar, escrever, gerar ou ajustar uma função do agente do GPTThink / GPT Maker Conector (SDR, Suporte, Agendamento, Pós-venda, Cobrança, Recepção ou qualquer função nova) e quiser o JSON completo do template para colar no backoffice — formulário, comportamento, trechos das opções, base de conhecimento e ações no Bitrix24. Também quando um JSON de função não publica (pior caso acima de 3000 caracteres, marcador sem campo, campo dependente sem uso, intenção inválida)."
---

# Criar função do GPTThink (JSON completo)

O cliente do GPTThink não escreve prompt: ele escolhe uma **função** e responde um formulário. A função é um template JSON que diz quais perguntas existem e como cada resposta vira o **comportamento** do agente (no máximo 3000 caracteres), os **treinamentos** (um por item da base) e as **intenções** (ações no Bitrix24). Esta skill produz esse JSON pronto para o backoffice.

Arquivos desta skill:
- `referencia/formato.md`: todos os campos, limites e ações. Leia antes de escrever o JSON.
- `referencia/blocos.json`: os blocos compartilhados (`comum`, `registro`, `duvida`, `transferir`, `crm`) com os ids dos campos de cada um.
- `exemplos/suporte.json` e `exemplos/sdr.json` (funções publicadas) e `exemplos/cobranca.json` (gerada com esta skill, aprovada pela checagem real). Copie a estrutura da mais parecida.
- `scripts/validar.mjs`: a checagem de publicação do backoffice, sem dependências.
- `scripts/gerar-referencia.ts` (só no repositório): regenera `blocos.json` e os exemplos do seed com `npx tsx .claude/skills/gptthink-criar-funcao/scripts/gerar-referencia.ts`. Rode depois de mudar um bloco ou template do seed; um teste do backend acusa quando a referência fica velha.

## Processo

1. **Entenda a função** antes de escrever. Se o pedido não deixar claro, pergunte (de uma vez só):
   - a missão, em uma frase, e o que a função **não** faz;
   - as decisões que mudam de cliente para cliente (viram `CHOICE`);
   - os fatos do negócio (viram campos livres ou base de conhecimento);
   - o que precisa ser registrado no Bitrix24 e quando.
2. **Leia** `referencia/formato.md` e o exemplo mais parecido.
3. **Escreva o JSON** no formato de saída abaixo, num arquivo (ex.: `funcao-cobranca.json`).
4. **Valide:** `node <pasta-da-skill>/scripts/validar.mjs funcao-cobranca.json`. Corrija até aparecer `OK`. O validador mostra quanto cada campo pesa no pior caso: corte primeiro o maior.
5. **Entregue** no formato abaixo, com o resultado do validador (pior caso / 3000).

## Formato de saída

A aba JSON do backoffice aceita **só o rascunho** (o objeto que começa em `"agentType"`). Código, nome e descrição vão no formulário "Nova função", não no JSON. Colar o objeto com `code`/`name`/`draft` na aba JSON dá `agentType: Invalid option`, `profile/fields/behavior: expected ..., received undefined`. Por isso a entrega tem sempre duas partes:

**1. Dados da nova função** (para o formulário "Nova função"):

| Campo | Valor |
|---|---|
| Código | `COBRANCA` (maiúsculas e `_`) |
| Nome | Cobrança (até 100) |
| Descrição | Uma ou duas frases que o cliente lê ao escolher a função (até 500) |

**2. JSON para a aba JSON:** um bloco de código com o rascunho, e nada em volta:

```json
{
  "agentType": "SUPPORT",
  "settings": { "enabledHumanTransfer": true, "limitSubjects": true },
  "profile": { "jobName": "{{empresa.nome}}", "jobDescription": "{{empresa.descricao}}", "jobSite": "" },
  "blocks": ["comum", "registro", "duvida", "transferir", "crm"],
  "crmAccess": false,
  "fields": [ ... ],
  "behavior": "Você é {{agente.nome}}, ...",
  "intentions": [ ... ],
  "transfers": [ ... ]
}
```

- O JSON vai **completo**: nada de `...`, comentários ou "resto igual". Ele precisa colar e funcionar.
- `blocks` é obrigatório na entrega: sem ele os campos dos blocos somem (`marcador sem campo: {{empresa.nome}}`, `bloco não incluído no template: crm`).
- `behavior` é uma string só, com `\n` nas quebras de linha.
- O validador aceita o rascunho sozinho ou o objeto `{ code, name, description, draft }` (esse é o corpo de `POST /admin/functions`, para quem usa a API).

**Passo a passo no backoffice** (inclua na entrega):
1. **Funções → Nova função**: preencha código, nome e descrição; em "Começar a partir de", qualquer função.
2. Abra a função → aba **JSON** → selecione tudo (Ctrl+A) e cole o JSON da parte 2. O topo deve mostrar "Estrutura válida".
3. Confira na aba **Geral** que os blocos estão marcados → **Salvar** → **Testar** → **Sandbox** → **Publicar**.

## Regras que a publicação impõe

- **Toda opção tem `snippet`.** O texto do template não tem `if`: a lógica fica nas escolhas. O trecho da opção escolhida entra onde está o marcador `{{id.do.campo}}`.
- **Dependentes:** uma opção pode ter `dependents`, campos que só aparecem com ela. Todo dependente precisa ser citado num trecho, no comportamento, numa intenção ou numa condição. Ação que usa um dependente precisa de `when` garantindo a opção dele.
- **Ids:** `minúsculas.com_ponto` (`cobranca.prazo`), únicos na função inteira, contando dependentes e os campos dos blocos (`empresa.nome`, `comum.tom`, `comum.emojis`, `registro.onde`, `registro.funil`, `duvida.depois`). Prefixe os ids com o nome da função.
- **Marcadores válidos:** ids de campo, `{{agente.nome}}`, `{{avancado.instrucoes_adicionais}}`, `{{bloco.<código>}}` dos blocos incluídos e, em funil, `{{campo.categoryId}}` / `{{campo.stageId}}`. Só nas intenções: `{{fields.<campo_coletado>}}`, `{{contact.name}}`, `{{contact.phone}}`, `{{intencao.respostas}}` (com `collectFrom`).
- **Pior caso ≤ 3000:** texto fixo + cada campo livre no limite (lista = itens × (tamanho + 3)) + o trecho mais longo de cada escolha + todas as opções de múltipla escolha + nome do agente (100) + instruções adicionais (400). Mire em até ~2900.
- **Item da base ≤ 1028:** o `format` + a soma dos `maxLength` dos subcampos.
- **Intenção com `responseMode: "INSTRUCTIONS"`** precisa de `instructions` (o que o agente diz depois da ação).

## Como escrever o comportamento

Estrutura que funciona (veja os exemplos):

```
Você é {{agente.nome}}, <papel> da {{empresa.nome}}. {{empresa.descricao}}
<Missão em uma frase. O que NÃO faz.>

{{bloco.crm}}

COMO CONDUZIR
- <uma regra por linha, no imperativo>
- {{funcao.alguma_escolha}}

<SEÇÕES CURTAS EM MAIÚSCULAS: PREÇO, QUANDO TRANSFERIR...>

{{bloco.duvida}}

ESTILO
{{comum.tom}} {{comum.emojis}} Respostas curtas e diretas.

{{avancado.instrucoes_adicionais}}
```

- Imperativo e concreto: "Faça uma pergunta por vez", e não "É importante que...".
- Use "NUNCA" só no que é crítico (preço, desconto, inventar). O excesso deixa o agente engessado.
- Cite as ações sempre como `use a ação "Nome"` (ou `use "Nome"`), com o `name` exato da intenção. O validador avisa quando o nome citado não existe. Toda ação criada deve ser citada em algum texto.
- Os trechos das opções se leem sozinhos e encaixam onde está o marcador. Opções de campos diferentes não podem se contradizer.
- Preço, produto, política e FAQ vão para campos `KNOWLEDGE`, não para o comportamento. Links e dados que precisam ser exatos vão no comportamento.
- Num `MULTI_CHOICE`, use `separator: ", "` para itens de uma frase ("peça: nome, e-mail"), `"\n"` para uma lista (cada trecho começa com `- `) e `"\n\n"` para seções.
- `INTEGER` também pode entrar no texto ("até {{cobranca.max_parcelas}} parcelas").

## Vários usuários, canal aberto e transferência entre agentes

- **Vários usuários em rodízio:** `BITRIX_USER` com `"multiple": true` e o marcador sozinho em `responsibleId` (tarefa) ou `userId` (transferência). Cada execução vai para o próximo da lista. Depois de publicado, `multiple` não muda.
- **Canal aberto:** campo `BITRIX_OPENLINE` ("Canal aberto do Bitrix24") e `TRANSFER_TO_HUMAN` com `{ "target": "LINE", "lineId": "{{x.canal}}" }`.
- **Outro agente:** campo `AGENT` (o cliente escolhe um agente do portal) e um item em `transfers` com `agent: "{{x.agente}}"` e `instructions` dizendo quando transferir. Use quando parte do atendimento é de outra função (ex.: o Suporte passa pedidos de compra ao SDR). Detalhes em `referencia/formato.md`.
- Esses três campos não entram no texto do agente: não cite `{{x.agente}}`, `{{x.canal}}` nem um campo de vários usuários no `behavior`.

## Orçamento na prática

Com os blocos padrão, já estão reservados cerca de **1430** dos 3000 caracteres: instruções adicionais (400), texto de `crm` (355) e de `duvida` (156), `empresa.descricao` (250), nome do agente (100), `empresa.nome` (80) e tom + emojis (85). Sobram uns **1500** para o seu texto fixo e os seus campos somados. Planeje com isso antes de escrever.

Limites que funcionam: nome ou canal 60–80; frase curta 100–150; descrição 200–250; link 120–150 (se faltar espaço, peça um link encurtado no `help`); lista com 3–5 itens de 60–90. Se mesmo assim não couber, mova o conteúdo para um `KNOWLEDGE`, que não conta no orçamento.

## Blocos

Inclua sempre `comum`, `duvida` e `transferir`. Inclua `registro` quando alguma ação gravar no Bitrix24, e `crm` quando o agente deve reconhecer o cliente pelo CRM. Os campos dos blocos entram no começo do formulário e as intenções deles são somadas às suas. Não recrie o que um bloco já faz: transferir ("Transferir para atendente") e registrar dúvida ("Registrar dúvida") já existem; só cite essas ações pelo nome. `{{bloco.duvida}}` e `{{bloco.crm}}` precisam aparecer no comportamento; `comum`, `registro` e `transferir` não têm texto.

## Erros comuns

| Erro | Correção |
|---|---|
| `campo dependente sem uso` | Cite o dependente no trecho da opção pai, ou use-o numa ação com `when` |
| `marcador sem campo` | O id não existe (veja os blocos) ou é `{{fields.x}}` fora de intenção |
| Pior caso acima de 3000 | Reduza primeiro os `maxLength` / `maxItems` dos campos maiores, depois o texto fixo |
| `{{fields.x}}` não é campo coletado | O nome vem de `fields[].name` normalizado: "Dados do cliente" → `fields.dados_do_cliente` |
| `categoryId` / `responsibleId` como texto com mais coisa | Número, ou um marcador sozinho: `"{{cobranca.funil.categoryId}}"` |
| Ação citada no texto sem intenção | Crie a intenção, ou cite uma ação de bloco existente |
| `transferência x: escolha um campo de agente` | `agent` precisa ser só `"{{id}}"` de um campo `AGENT` |
| Conhecimento no comportamento | Mova para um `KNOWLEDGE` com `format` "Rótulo: {{titulo}}\n{{texto}}" |
