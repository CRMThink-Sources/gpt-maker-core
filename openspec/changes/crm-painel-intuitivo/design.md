# Design

## Context

A tela fica em `frontend/src/app/app/crm/page.tsx`. Ela tem uma aba por entidade (`CRM_ENTITY_TABS`, em `frontend/src/lib/crm.ts`) e uma aba Funis (`PipelinesTab`), que só lê `catalog.pipelines`. A linha do campo (`FieldSummary`) mostra tipo, valores aceitos e o código técnico. O campo sem descrição mostra o link "+ Adicionar descrição", que só aparece para quem pode alterar. A API `/app/crm/*` e o contrato `CrmCatalogView` atendem tudo o que a tela nova precisa. Motivação em proposal.md.

## Goals / Non-Goals

**Goals:**
- Resolver as duas dores relatadas: o propósito da tela e o resultado da configuração.
- Manter o fluxo atual de adicionar, remover e descrever (modal de seleção múltipla, edição inline).

**Non-Goals:**
- Prévia com dados reais de um cliente do portal (exigiria rota nova e trata dado pessoal).
- Mudar o backend, o contrato ou o que o agente recebe.
- Reordenar as abas ou unir entidades.

## Decisions

**1. A prévia é montada no frontend, a partir do catálogo já carregado.**
Uma função pura `buildAgentPreview(fields)` em `lib/crm.ts` recebe os campos expostos de uma entidade e devolve linhas `{ label, example, description }`. Ela não chama o backend. Assim a prévia se atualiza na hora em que `onFieldSaved` muda o catálogo, e dá para testar a função com Vitest.
- Alternativa: uma rota que devolve a resposta real do MCP para um cliente de exemplo. Descartada porque exige um cliente real (dado pessoal) e uma chamada ao Bitrix24 a cada mudança.

**2. O valor de exemplo vem do tipo do campo.**
Para lista e booleano, a prévia usa o primeiro valor aceito (`field.options[0]`). Para os outros tipos, usa um mapa fixo por tipo, ao lado de `FIELD_TYPES`: texto "Exemplo", número "42", valor "R$ 1.500,00", data "15/03/2026", usuário "Ana (responsável)", telefone/e-mail "(11) 91234-5678", funil "Vendas", etapa "Proposta enviada". Tipo desconhecido usa "…". Antes do tipo, campos padrão conhecidos têm valor próprio por código (`NAME` "Maria", `LAST_NAME` "Souza", `POST` "Gerente comercial", `TITLE` por entidade…), porque "Exemplo" em todos os campos de texto não mostrava nada. A prévia fica com cara de dado real, sem inventar nada ligado ao portal.
- Alternativa: mostrar só o nome do tipo ("Texto"). Descartada porque não responde "o que o agente recebe".

**3. A prévia é um card dentro da aba, abaixo da lista de campos.**
O layout escolhido foi o de abas enxutas, sem painel lateral. O card "O que o agente recebe" fica abaixo da lista, com fonte monoespaçada leve, no formato `Nome: valor — descrição`. Ele explica que é um exemplo, não um cliente real.

**4. Os textos por entidade ficam em `lib/crm.ts`.**
O mapa `CRM_ENTITY_USAGE: Record<CrmEntity, string>` segue o requisito "Identificar o cliente da conversa" de `agent-crm-tools`:
- Contato: o agente usa ao identificar o cliente da conversa.
- Negócio: o agente lê esses campos nos negócios do cliente (até 10, do mais recente para o mais antigo).
- Lead: usado quando a conversa está ligada a um lead e ainda não há contato.
- Empresa: usado quando a conversa está ligada só a uma empresa.

**5. O bloco "Como funciona" é fixo e curto.**
São dois passos numerados, abaixo do cabeçalho e antes das abas. Ele não pode ser fechado: tem duas linhas e é a principal resposta à dor "não entendo o propósito". Uma opção de fechar exigiria guardar estado por usuário.

**6. O código técnico só aparece como dica.**
O `title` do nome do campo recebe o código. Os valores aceitos continuam na linha, porque ajudam a escrever a descrição. A busca do modal continua aceitando o código.

**7. O aviso de descrição faltando vale só para campos personalizados.**
Na primeira versão o aviso aparecia em todo campo exposto; no portal de desenvolvimento, as abas ficaram cheias de alertas em campos que se explicam pelo nome (Criado em, Sobrenome). O aviso fica só onde `field.custom` é verdadeiro; nos campos padrão volta o link discreto "+ Adicionar descrição". No campo personalizado, quem pode alterar vê "Sem descrição: explique o que este campo significa" com um botão que abre a edição. Quem só consulta vê o mesmo aviso, sem o botão.

**8. A aba Funis sai de vez.**
Saem `PipelinesTab`, o tipo `Tab` com `'pipelines'`, `STAGE_TONES` e os imports de `STAGE_SEMANTIC_LABELS` e `StageSemantic` que só ela usava. A mensagem de sucesso da atualização vira "Campos atualizados do Bitrix24.". O estado `tab` passa a ser `CrmEntity`.

## Risks / Trade-offs

- [O exemplo pode parecer dado real] → O card diz "Exemplo com valores fictícios" no título.
- [Sem a aba Funis, o cliente não confere as etapas pelo painel] → Ele confere no Bitrix24. A tradução não muda, e "Atualizar do Bitrix24" continua relendo os funis.
- [Os textos de uso por entidade ficam desatualizados se a regra de identificação mudar] → Eles ficam num único mapa, que referencia o requisito de `agent-crm-tools`.

## Migration Plan

Mudança só de frontend, publicada no deploy normal. Para reverter, volte o commit. Não há dado nem contrato para migrar.
