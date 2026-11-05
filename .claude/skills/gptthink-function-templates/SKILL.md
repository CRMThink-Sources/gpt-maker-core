---
name: gptthink-function-templates
description: Guia para criar ou ajustar uma função do agente do GPTThink (SDR, Suporte, Agendamento, Pós-venda ou uma nova) — o template que o backoffice publica e que vira o comportamento, os treinamentos e as intenções do agente no GPT Maker. Use sempre que alguém for escrever ou revisar um template de função, um bloco compartilhado, o texto do comportamento, os trechos das opções do formulário, os itens da base de conhecimento ou as intenções geradas, ou perguntar por que um template não publica (orçamento de 3000 caracteres, marcador sem campo, dependente sem uso, intenção inválida).
---

# Templates de função do GPTThink

O cliente não escreve prompt. Ele escolhe a função do agente e responde um formulário sobre o negócio. O **template** da função (escrito por nós) diz quais perguntas existem e como cada resposta vira texto. A compilação monta:

- o **comportamento** (≤ 3000 caracteres) a partir do texto do template;
- um **treinamento de texto** por item da base (≤ 1028 caracteres);
- as **intenções** (ações no Bitrix24) ativadas pelas escolhas;
- os **settings** e o tom derivados.

Código de referência: `packages/contracts/src/agent-functions.ts` (schema), `agent-function-compiler.ts` (compilação), `agent-function-check.ts` (checagem de publicação). Templates reais: `backend/src/modules/agent-functions/seed/`. Desenho completo: `openspec/changes/agent-function-templates/`.

Para gerar o JSON completo de uma função nova (inclusive fora deste repositório), use a skill `gptthink-criar-funcao`.

## Editor visual (backoffice)

Em `/admin/functions`, cada função abre num editor em abas. O JSON é a última aba, só para o que o visual não cobrir.

| Aba | O que fica lá |
|---|---|
| **Geral** | tipo no GPT Maker, configurações derivadas (transferência, assuntos, busca inteligente, mensagem de "não sei"), blocos incluídos, "Exige acesso ao CRM", dados da empresa |
| **Formulário** | perguntas, na ordem do cliente. Cada escolha tem opções com rótulo, **texto da opção** (o trecho) e efeitos recolhidos (tom, emojis…); dependentes ficam dentro da opção |
| **Texto do agente** | o comportamento; "Inserir campo" coloca o marcador no cursor e mostra só os que existem. "Ver como fica ao lado" mostra o texto compilado com as respostas da aba Testar |
| **Ações** | intenções: quando usar, condição, o que coletar e os passos no Bitrix24 (comentário, lead, negócio, tarefa, processo, transferência para operador, usuário ou canal aberto). Campos do CRM têm sugestões (`TITLE`, `COMMENTS`…) e aceitam `UF_CRM_…`. Abaixo, **Transferências entre agentes**: quando transferir, para qual campo Agente, condição e se a conversa volta ao terminar |
| **Testar** | o formulário como o cliente vê e o agente que sai, compilado no navegador sem salvar. "Preencher com exemplo" e "Maior texto possível" (pior caso) |
| **JSON** | o mesmo conteúdo; JSON inválido não altera as outras abas |

- **Barra no topo (fixa):** passos Editar → Testar → Publicar, Desfazer/Refazer (Ctrl+Z / Ctrl+Shift+Z fora dos campos de texto), Salvar (Ctrl+S), sandbox e publicar. Fechar a aba com alteração não salva pede confirmação.
- **Painel ao lado:** tamanho máximo do texto (pior caso), com o rótulo de cada pergunta, e os problemas que impedem publicar — inclusive campo vazio, antes só visto ao salvar. Clique no problema: o editor abre a aba e a pergunta ou ação certa e rola até ela.
- **Ids:** nascem do rótulo e acompanham o rótulo até a primeira publicação. Depois ficam travados (as respostas dos agentes usam o id), e o campo não muda de tipo. Para mudar, crie um campo novo.
- **Identificador da ação (chave):** liga a ação ao que já foi publicado. Fica travado depois da primeira publicação.
- **Nova função:** use "Começar a partir de" com a função mais parecida; a cópia é independente.
- **Blocos:** em "Blocos compartilhados", o mesmo editor (sem a aba Geral). Publicar um bloco não muda os templates: ele entra na próxima versão de cada template que o usa.
  - **Novo bloco:** em branco ou cópia de outro. Na cópia, os ids dos campos passam a usar o código do bloco novo (`comum.tom` ⇒ `novo.tom`); os identificadores das ações não mudam, então renomeie antes de usar os dois blocos na mesma função.
  - **Excluir bloco:** só quando nenhuma função o inclui no rascunho (tire-o pela aba Geral). É exclusão lógica: o código fica reservado (o seed não recria) e as versões já publicadas não mudam, porque guardam o bloco expandido.
- **Sandbox e Publicar** gravam o rascunho antes, se houver alteração, e ficam bloqueados enquanto houver problema. Publicar abre uma confirmação com as perguntas e ações novas ou removidas e o diff do texto contra a versão atual.

## Como um template é publicado

1. Editar o rascunho no backoffice (`/admin/functions`).
2. **Testar** (aba) com respostas de exemplo: ver o comportamento compilado, os treinamentos e as intenções.
3. **Sandbox**: publicar no agente de sandbox com as respostas da aba Testar e conversar com ele (roteiro abaixo).
4. **Publicar**: revisar a confirmação; cria uma versão nova e imutável. Nenhum agente muda até o cliente republicar.
5. Errou? Restaurar a versão anterior (publica o conteúdo antigo como versão nova).

## Estrutura do template

| Parte | O que é |
|---|---|
| `agentType` | `SALE` ou `SUPPORT` no GPT Maker |
| `settings` | Settings derivados (ex.: `enabledHumanTransfer`, `limitSubjects`) |
| `profile` | `jobName`, `jobDescription`, `jobSite` com marcadores |
| `blocks` | Blocos incluídos (`comum`, `registro`, `duvida`, `transferir`, `crm`) |
| `crmAccess` | Exige o acesso ao CRM do agente; também vem de um bloco incluído com `crmAccess` |
| `fields` | Perguntas do formulário |
| `behavior` | Texto do comportamento com `{{marcadores}}` |
| `intentions` | Ações geradas, com condição opcional |

### Tipos de campo

| Tipo | Entra no comportamento como |
|---|---|
| `TEXT`, `URL` | o texto |
| `TEXT_LIST` | tópicos `- item` |
| `CHOICE` | o **trecho da opção escolhida** |
| `MULTI_CHOICE` | trechos das marcadas, unidos pelo `separator` (`'\n\n'` para seções, `', '` para itens) |
| `INTEGER`, `BITRIX_USER` | o número (útil em ações) |
| `BITRIX_STAGE` | use `{{campo.categoryId}}` e `{{campo.stageId}}` nas ações |
| `BITRIX_USER` com "vários usuários" | lista de ids: nas ações (`responsibleId`, `userId`) cada execução vai para o próximo, em rodízio. Travado depois de publicado |
| `BITRIX_OPENLINE` (canal aberto) | não entra: use em "Transferir para atendente", destino Canal aberto (`lineId`) |
| `AGENT` | não entra: destino de uma transferência entre agentes (`transfers`) |
| `KNOWLEDGE` | não entra: cada item vira um treinamento pelo `format` |

### Regras que a checagem impõe

- **Escolha carrega o texto.** Toda opção tem `snippet` (não vazio). Não existe `if` no texto do template.
- **Lógica fica no formulário.** Uma opção pode ter `dependents`: campos que só aparecem com ela. Todo dependente precisa ser citado em algum texto (trecho, comportamento, intenção) ou em uma condição — senão é "campo dependente sem uso".
- **Marcadores válidos:** ids de campos, `agente.nome`, `avancado.instrucoes_adicionais`, `bloco.<código>` (no rascunho) e, só em intenções, `intencao.respostas` e as raízes de execução (`fields.*`, `contact.*`...).
- **Ids** de campo: minúsculas com ponto (`sdr.perfil_ideal`), únicos no template inteiro, inclusive dependentes e blocos.
- **Pior caso ≤ 3000:** texto fixo + todos os campos no limite + o trecho mais longo de cada escolha + todas as opções de múltipla escolha + instruções adicionais (400) + nome do agente (100).
- **Intenções compilam em toda variação:** a checagem compila uma vez por opção de cada escolha e valida as ações.

## Orçamento: como caber em 3000

Referência das funções atuais (pior caso): SDR 2997, Agendamento 2639, Suporte 2403, Pós-venda 1997. O texto fixo fica entre 330 e 680.

- Some antes de escrever: os campos livres são o que mais pesa (lista de 5 × 90 = 464).
- Corte primeiro os limites dos campos, depois o texto fixo, por último as instruções adicionais.
- Links e dados que precisam ser exatos vão no comportamento (sempre presente). Descrições longas vão para a base.
- O erro de publicação mostra a contribuição de cada campo: comece pelo maior.

## Como escrever o comportamento

- **Missão primeiro**, em duas frases: quem é, o que faz e o que **não** faz.
- **Seções curtas em maiúsculas** (`COMO CONDUZIR`, `PREÇO`...). Uma regra por linha.
- **Imperativo e concreto:** "Faça uma pergunta por vez" em vez de "É importante que...".
- **Pouco "NUNCA".** Use para o que é crítico (preço, desconto, inventar). Excesso deixa o agente engessado.
- **Cite ações pelo nome entre aspas**, igual ao `name` da intenção: `use a ação "Registrar dúvida"`.
- **Trechos de opção se leem sozinhos** e encaixam onde o marcador está. Leia o comportamento compilado com cada opção.
- **Sem contradição entre trechos:** duas opções de campos diferentes não podem mandar coisas opostas.
- **Sem conhecimento no comportamento:** preço, produto e política vão para a base.
- Termine com `ESTILO` (`{{comum.tom}} {{comum.emojis}}` + tamanho das respostas) e `{{avancado.instrucoes_adicionais}}`.

## Itens da base (`KNOWLEDGE`)

- Um assunto por item. O `format` começa com um rótulo e o título (`Pergunta: {{pergunta}}`): ajuda a busca e deixa cada treinamento único.
- Some os limites dos subcampos + o texto do `format`: precisa caber em 1028.
- Linha cujos subcampos ficaram todos vazios some do treinamento: subcampo opcional pode ter linha própria (`Valor: {{valor}}`).

## Intenções

- `key` estável: é ela que liga a intenção ao que já está publicado. Não renomeie sem necessidade.
- `when` liga a intenção a uma escolha; `when` numa ação liga só aquela ação.
- `collectFrom` transforma os itens de uma lista em campos coletados (`pergunta_1`...) e `{{intencao.respostas}}` lista "pergunta: resposta".
- Nomes de campo viram `fields.<nome_json>` ("Dados do cliente" → `fields.dados_do_cliente`).
- Marcador sozinho em campo numérico (`'{{suporte.responsavel}}'`) vira número na compilação.
- O "não sei" é a intenção do bloco `duvida`. O evento `onLackKnowLedge` do GPT Maker não dispara na prática.

## Consultar o cliente no CRM

- A consulta não é uma ação de bloco: é a intenção de sistema **"Consultar cliente no CRM"** do acesso ao CRM do agente (spec `agent-crm-tools`), que identifica o cliente pelo vínculo da conversa.
- O bloco `crm` só tem texto (consultar na primeira mensagem, usar o nome, não pedir o que já está no CRM) e `crmAccess: true`. Inclua o bloco e ponha `{{bloco.crm}}` no texto do agente.
- Ao publicar a função num agente, o publicador ativa o acesso ao CRM se ainda não estiver ativo. Se não conectar (ou `CRM_TOOLS_ENABLED` desligado), a publicação falha e pode ser repetida. Tirar o bloco depois não desliga o acesso.
- O sandbox não tem acesso ao CRM: lá a ação não existe. Teste a consulta no chat de teste do app, com um cliente simulado.

## Checklist antes de publicar

- [ ] Prévia sem erros, e o comportamento compilado lido com as opções mais longas.
- [ ] Contador de pior caso com folga razoável (se estiver acima de 2950, revise).
- [ ] Cada trecho de opção relido no contexto do marcador.
- [ ] Nenhuma ação citada no texto sem intenção correspondente (e vice-versa).
- [ ] Sandbox: os cenários abaixo testados.
- [ ] Diff contra a versão anterior revisado: o que mudou para os agentes que republicarem.

### Roteiro do sandbox

1. Pergunta coberta pela base → responde pela base.
2. Pergunta fora da base → usa "Registrar dúvida" em vez de inventar.
3. Pedido para falar com uma pessoa → transfere.
4. Caminho principal da função (qualificar, abrir chamado, enviar link, avaliar) → a ação certa, com os campos certos.
5. Assunto fora da função (ex.: suporte no SDR) → segue o trecho da escolha.

## Nova função

1. Comece copiando o template mais parecido em `seed/`.
2. Defina a missão e o que a função **não** faz.
3. Liste as decisões do cliente como `CHOICE` (cada uma com trechos testados) e os fatos como campos livres ou base.
4. Inclua os blocos `comum`, `registro`, `duvida` e `transferir`.
5. Crie pelo backoffice, rode a prévia, o sandbox e publique. Se for função padrão para todos os ambientes, adicione também em `seed/` (o seed só cria códigos que ainda não existem).
