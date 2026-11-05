# Proposal

## Why

As respostas das ferramentas do CRM levam orientações fixas para o agente (o campo `orientacao`, o escopo de dados `DATA_SCOPE` e a mensagem de cliente não identificado). Esses textos estão no código, em `crm-tools.service.ts`. Todo ajuste de redação, por exemplo para corrigir um agente que promete dados que não tem, exige um deploy. A equipe precisa ajustar esses textos pelo backoffice e ver o efeito em minutos.

## What Changes

- As quatro orientações passam a ser editáveis no backoffice, como texto global (o mesmo para todos os tenants):
  - **Cliente identificado**: a orientação da resposta de identificação do cliente.
  - **Negócios do cliente**: a orientação da ferramenta `negocios_do_cliente`.
  - **Escopo dos dados**: o texto que hoje é o `DATA_SCOPE`, somado ao fim das duas orientações acima.
  - **Cliente não identificado**: a mensagem devolvida quando a conversa não está ligada ao CRM.
- O texto atual continua no código como **padrão**. Uma orientação que nunca foi editada usa o padrão. "Restaurar padrão" descarta a edição.
- Uma edição salva vale para as próximas chamadas em até 1 minuto, sem deploy nem reconfiguração no GPTMaker.
- Só operadores ADMIN editam. Operadores SUPPORT consultam. Toda edição fica no log de auditoria, com o texto anterior e o novo.
- A tela de edição mostra uma prévia da orientação completa, montada como o agente recebe.

## Capabilities

### New Capabilities
<!-- nenhuma -->

### Modified Capabilities
- `agent-crm-tools`: novo requisito para as orientações das respostas, editáveis no backoffice, com padrão no código, prazo de propagação e auditoria.

## Impact

- Backend:
  - Nova tabela (migração `0019`) com chave, texto, autor e data.
  - Novo controller `admin/crm-guidance` no módulo `backoffice`.
  - `crm-tools.service.ts` passa a ler as orientações por um serviço com cache Redis de 60 segundos, apagado ao salvar.
- Contratos: schema zod da orientação e do payload de edição em `@gptmaker/contracts`.
- Frontend: nova página `frontend/src/app/admin/crm-guidance/` e um item no menu do backoffice.
- Fora do escopo: texto por tenant e edição pelo portal do cliente.
