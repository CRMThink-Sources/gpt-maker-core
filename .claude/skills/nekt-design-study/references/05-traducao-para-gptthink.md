# Traduzindo o modelo do Nekt para o GPTThink

Tudo neste arquivo é **proposta de design** da CRMThink inspirada no Nekt — não descreve como o GPTThink ou o GPT Maker funcionam hoje, exceto onde marcado como restrição do motor.

## Índice
1. O paralelo em uma tabela
2. Restrições do motor (GPT Maker)
3. O conceito único: Contexto do agente
4. Função do agente como template
5. Anotações no mundo Bitrix24
6. A camada de compilação
7. Roteamento: base de conhecimento vs. CRM ao vivo
8. Ações do agente com duas fases
9. Setup link para o modelo white label
10. Permissões e auditoria
11. Ciclo de aprendizado
12. O que NÃO copiar
13. Roadmap sugerido

---

## 1. O paralelo em uma tabela

| No Nekt | No GPTThink (proposta) |
|---|---|
| Documento de contexto (prosa + anotações) | **Contexto do agente**: um documento por assunto, em linguagem natural |
| Templates (receita, funil, cliente ativo…) | **Funções**: SDR, Suporte, Agendamento, Pós-venda, cada uma com contextos esperados |
| "Não sabe por onde começar?" | Assistente que lê o site/materiais do cliente e propõe os contextos |
| "Deixe um agente montar sua biblioteca" | Importar PDF/site/FAQ → IA estrutura em contextos → cliente revisa |
| Anotações `@table::…` | Menções a entidades do Bitrix24, etapas do funil, ações do agente e outros contextos |
| Busca semântica antes de gerar SQL | Recuperação feita pelo motor sobre os treinamentos, mais contexto do CRM injetado por sessão |
| Warehouse vs. Live Data | Base de conhecimento vs. consulta ao CRM em tempo real |
| `confirm=True` | Ações que escrevem no Bitrix24 com prévia e confirmação |
| Setup link | Link para o cliente final conectar canal, autorizar app ou informar credenciais |
| Token escopado / log por ferramenta | Escopo por agente e trilha de cada decisão do agente |

## 2. Restrições do motor (GPT Maker)

Fatos da documentação pública do GPT Maker e do manual do conector, que limitam o desenho:

- **Comportamento** é um campo de texto livre com limite de 3000 caracteres, mais o seletor de comunicação (formal, normal, descontraída) e a finalidade (Suporte, Vendas, Uso pessoal).
- **Treinamento** é a base de conhecimento. Pela API só treinamentos de **texto** podem ser atualizados; os outros tipos precisam ser removidos e recriados.
- **Intenções** permitem ao agente chamar APIs externas.
- **Contatos** têm campos padrão e campos personalizados (`customFieldValues`).
- A API de conversa aceita `chatName` e `phone`, e existe `add-message` para inserir mensagens no contexto da conversa.
- **O GPTThink não controla como o GPT Maker recupera treinamentos.** Isso é diferente do Nekt, que controla a própria busca semântica. Valide por teste qual granularidade de treinamento o motor recupera melhor.

**Consequência:** o GPTThink precisa de uma **camada própria de contexto** (fonte da verdade) e uma **camada de compilação** que traduz essa biblioteca para os campos que o GPT Maker aceita.

## 3. O conceito único: Contexto do agente

Assim como o Nekt só pede "documentos de contexto", o GPTThink pediria só **contextos**. Cada contexto tem um **tipo**, mas o tipo é inferido pelo sistema, não escolhido pelo cliente.

| Tipo (interno) | Exemplo | Vai para (no GPT Maker) |
|---|---|---|
| Fato | "Frete grátis acima de R$ 200" | Treinamento de texto |
| Regra | "Nunca ofereça frete grátis para o Norte" | Campo de comportamento |
| Estilo | "Respostas curtas, sem emoji" | Campo de comportamento / seletor de comunicação |
| Roteamento | "Status de pedido: consultar o CRM, não a base" | Comportamento + intenção que consulta o Bitrix24 |
| Missão | "Você qualifica e agenda; não vende" | Topo do comportamento (vem da função) |

**Boas práticas herdadas do Nekt**, adaptadas:

- um assunto por contexto;
- escrever a intenção ("o que conta, o que não conta e por quê"), não roteiro de pergunta e resposta;
- incluir exemplos (uma conversa boa, uma ruim);
- referenciar em vez de repetir;
- contexto desatualizado é pior que nenhum — mostrar a data da última revisão.

## 4. Função do agente como template

Equivalente aos templates do Nekt, mas mais forte: a **função** define missão, regras padrão, estilo padrão e **quais contextos fazem sentido**.

Exemplo — função SDR:

- **Missão:** qualificar e agendar com um consultor. Não vende, não dá suporte.
- **Contextos esperados:** Empresa; Para quem vendemos; Planos em alto nível; Objeções frequentes; Critérios de qualificação; Casos de clientes.
- **Contextos que não pertencem:** manual técnico, procedimentos de suporte, tabela de preços detalhada.
- **Ações padrão:** registrar dados de qualificação no lead; oferecer horários; transferir clientes atuais para Suporte.

Ao subir conteúdo que não pertence à função, o GPTThink avisa e oferece criar outro agente (o "filtro por função"). Isso teria evitado o problema do SDR interno da CRMThink.

## 5. Anotações no mundo Bitrix24

O equivalente às menções `@tipo::identificador` do Nekt. Sugestão de vocabulário:

| Menção | Aponta para |
|---|---|
| `@etapa::C1:NEW` | Etapa de um funil de negócios |
| `@campo::UF_CRM_PLANO` | Campo do CRM (padrão ou personalizado) |
| `@entidade::CONTACT` | Tipo de entidade do CRM |
| `@acao::agendar_reuniao` | Uma ação/intenção do agente |
| `@agente::suporte` | Outro agente (para transferência) |
| `@contexto::objeções` | Outro contexto (referência cruzada) |

Para que servem:

- **Compilação:** a menção vira o nome legível certo no texto enviado ao GPT Maker e liga o contexto à intenção correspondente.
- **Integridade:** se o campo ou a etapa some no Bitrix24, o GPTThink sabe quais contextos quebraram (o mesmo benefício das anotações do Nekt).
- **Roteamento:** um contexto que menciona `@campo::…` indica que aquela informação vem do CRM ao vivo, não da base.

## 6. A camada de compilação

```
Biblioteca GPTThink (fonte da verdade, versionada)
   ├─ Função (missão, regras e estilo padrão)
   ├─ Contextos (fatos, regras, estilo, roteamento) + menções
   └─ Ações (intenções)
            │
            ▼  compilar
GPT Maker
   ├─ Comportamento  ← missão + regras + estilo + roteamento   (≤ 3000 caracteres)
   ├─ Treinamentos   ← um treinamento de texto por contexto do tipo "fato"
   └─ Intenções      ← ações
```

Regras da compilação:

- **Orçamento do comportamento:** a missão e as regras críticas entram primeiro. Se passar de 3000 caracteres, avisar o cliente com a lista do que ficou de fora, em vez de truncar silenciosamente.
- **Mapa de IDs:** guardar, para cada contexto, o ID do treinamento correspondente no GPT Maker. Como só treinamento de texto é atualizável, compilar tudo para texto (inclusive o que veio de PDF, depois de extraído e revisado).
- **Prévia antes de publicar:** mostrar o que vai mudar no agente (diferenças de comportamento e treinamentos), no espírito do `confirm=True` do Nekt.
- **Versões:** cada publicação é uma versão; dá para comparar e voltar.

## 7. Roteamento: base de conhecimento vs. CRM ao vivo

O Nekt usa o contexto para decidir entre warehouse e Live Data. No GPTThink, a pergunta equivalente é "isso se responde pela base ou consultando o Bitrix24?".

- **Base:** horários, políticas, planos, objeções.
- **CRM ao vivo:** status de pedido, etapa do negócio, responsável, próxima atividade.

Implementação sugerida: contextos do tipo "roteamento" compilam para uma regra no comportamento ("para status de pedido, use a ação X") e apontam para a intenção que consulta o Bitrix24. O contexto do cliente identificado (nome, responsável, negócio aberto) entra por sessão, via `chatName` e `add-message`, como discutido na integração com o Canal Aberto.

E, como no Nekt, quando um operador corrige o agente ("isso tinha que ter olhado no CRM"), o GPTThink oferece salvar um contexto de roteamento.

## 8. Ações do agente com duas fases

Dois níveis, inspirados no `confirm=True`:

1. **Na configuração:** toda publicação de agente passa por prévia (ver seção 6).
2. **Na conversa:** ações que escrevem no Bitrix24 e têm efeito relevante (criar negócio, mudar etapa, agendar, cancelar) devem ser declaradas como "de escrita" na definição da ação. O GPTThink exige confirmação explícita do cliente final na conversa ("Posso agendar para quinta, 10h?") antes de executar, e registra a confirmação.

A lição do Nekt é colocar a confirmação **no contrato da ação**, no backend do GPTThink, e não só no prompt.

## 9. Setup link para o modelo white label

O padrão de setup link encaixa no modelo de parceiro → cliente final:

- o parceiro Bitrix24 cria o agente para um cliente;
- o GPTThink gera um link (expira, escopo só daquele passo) para o **cliente final** conectar o WhatsApp, autorizar o app no portal ou informar uma credencial;
- o cliente não precisa de conta no painel do parceiro e não vê nada além daquele formulário;
- um webhook avisa o parceiro quando o passo foi concluído;
- preenchimento parcial é aceito.

Isso também resolve o problema de tokens colados em chat ou em e-mail.

## 10. Permissões e auditoria

Lições do Nekt aplicáveis:

- **Teto pelo criador:** um parceiro nunca concede ao cliente mais do que ele próprio tem; um agente nunca acessa mais do que o portal autorizou.
- **Escopo por agente:** o agente SDR só enxerga leads e negócios do funil comercial; o de Suporte só os contatos e o funil de pós-venda. O escopo restrito deve ser o padrão.
- **"Não encontrei" honesto:** quando a consulta ao CRM volta vazia por falta de permissão, o agente diz que não pode ver aquela informação e transfere — não inventa nem insiste.
- **Log por decisão:** registrar, para cada mensagem, quais contextos foram usados, qual ação foi chamada, com quais argumentos e com que resultado. É o que permite responder ao cliente "por que o agente disse isso?".

## 11. Ciclo de aprendizado

No Nekt, decisões de uso viram documentos. No GPTThink:

- **Corrigir resposta:** o operador ou o cliente marca uma resposta como errada e escreve o certo; o GPTThink classifica como fato, regra, estilo ou roteamento e propõe o contexto (com prévia).
- **Perguntas sem resposta:** agrupar perguntas que o agente não soube responder e sugerir os contextos que faltam.
- **Revisão periódica:** contextos sem revisão há muito tempo ganham um alerta.

## 12. O que NÃO copiar

- **A complexidade de dados.** Camadas físicas, lakehouse, SQL e pipelines não têm lugar na experiência do cliente do GPTThink.
- **Anotações expostas ao cliente leigo.** No Nekt o público é misto e técnico o suficiente. No GPTThink, as menções devem ser inseridas por um seletor ("ligar a um campo do CRM") ou pela IA, nunca digitadas.
- **Granularidade de permissão desde o primeiro dia.** O Nekt deixa permissão granular para planos maiores. Começar com papéis simples (parceiro, cliente admin, operador) e escopo por agente.
- **Renomear ferramentas quebrando integrações.** O Nekt fez isso com tabela de migração; num white label com parceiros, versione a API desde o início.

## 13. Roadmap sugerido

1. **Fundação:** biblioteca de contextos própria do GPTThink + compilação para o GPT Maker + versões e prévia.
2. **Funções:** templates por função com missão, regras e contextos esperados; filtro por função.
3. **Entrada assistida:** importar materiais com classificação automática (fato/regra/estilo/roteamento) e revisão.
4. **Ações seguras:** ações de escrita declaradas, confirmação na conversa, log por decisão.
5. **Parceiros:** setup link com webhook, escopos por parceiro e cliente.
6. **Aprendizado:** corrigir resposta, perguntas sem resposta, alertas de revisão.
