# Proposal

## Why

Quem configura a tela "CRM para o agente" não entende para que ela serve nem vê o efeito do que configurou: escolhe campos e escreve descrições sem saber quando o agente usa cada entidade nem como os dados chegam a ele. A aba Funis aumenta a confusão — é só leitura, não guarda nenhuma escolha, e o que dá para configurar de funil (os campos Funil e Etapa) já fica na aba Negócio.

## What Changes

- Remove a aba **Funis** da tela. Os funis continuam no catálogo do backend (tradução de etapas, ferramenta `etapas_do_funil`, atualização a cada 10 minutos); só deixam de ser exibidos no painel. Funil e Etapa seguem configuráveis como campos da aba Negócio.
- Adiciona um bloco **"Como funciona"** no topo da tela, com os dois passos: escolher os campos que o agente pode ler e descrever o que cada um significa no negócio.
- Cada aba de entidade (Contato, Negócio, Lead, Empresa) ganha uma frase curta dizendo **quando o agente usa** aqueles campos.
- O **código técnico** do campo (`UF_CRM_...`) sai da linha e fica só na dica ao passar o mouse; a linha mostra nome, tipo e selos.
- Campo **personalizado** exposto sem descrição ganha um aviso visível pedindo a explicação. Campos padrão (Nome, Sobrenome, Criado em…) mantêm só o link discreto, para a tela não virar uma lista de alertas.
- Cada aba ganha uma **prévia "O que o agente recebe"**: um exemplo montado com os campos expostos daquela entidade (nome, valor de exemplo e descrição), sem ler dados reais de clientes.
- A mensagem depois de "Atualizar do Bitrix24" deixa de citar funis.

## Capabilities

### New Capabilities
<!-- nenhuma -->

### Modified Capabilities
- `crm-semantic-layer`: o requisito "Configuração pelo painel" passa a definir o que a tela mostra (orientação, uso por entidade, prévia, aviso de descrição faltando) e deixa de exibir os funis.

## Impact

- Frontend: `frontend/src/app/app/crm/page.tsx` e `frontend/src/lib/crm.ts` (textos por entidade e montagem da prévia).
- Backend, contratos (`@gptmaker/contracts`) e API `/app/crm/*`: sem mudança. `CrmCatalogView.pipelines` continua sendo devolvido, só não é exibido.
- Nenhuma migração, nenhuma mudança para o agente no GPTMaker.
