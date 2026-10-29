# Design

## Context

Os textos estão em `backend/src/modules/crm-tools/crm-tools.service.ts`: `DATA_SCOPE` (`:95`), a orientação de cliente identificado (`:176`), a de negócios do cliente (`:201`) e a mensagem de `notIdentified()` (`:437`). O backoffice fica em `frontend/src/app/admin/`. Ele chama `backend/src/modules/backoffice/` por um proxy. As rotas usam `@AdminAuth()` para leitura e `@AdminAuth('ADMIN')` para escrita, e as edições são registradas pelo `AuditService.record` (exemplo: `models-admin.service.ts`). O repositório não tem tabela genérica de configuração nem cache de configuração em memória. O único cache Redis de valor é o saldo de créditos (`billing/balance.reader.ts`, TTL de 60 segundos, apagado ao gravar). O `CrmToolsService` já injeta `DB` e `REDIS`.

## Goals / Non-Goals

**Goals:**
- Editar os quatro textos sem deploy, com propagação em até 1 minuto.
- Manter o comportamento atual quando ninguém edita e quando a leitura falha.

**Non-Goals:**
- Texto por tenant ou edição pelo portal do cliente.
- Rascunho e publicação, ou histórico de versões com restauração de uma versão antiga. A auditoria guarda o texto anterior.
- Tornar editáveis os textos de erro (`erro`) de referência inválida ou funil inexistente.

## Decisions

**1. O padrão fica no código e o banco guarda só a edição.**
A tabela `crm_tool_guidance` tem `key` (chave primária, texto), `text`, `updated_by` (FK opcional para `backoffice_user`) e `updated_at`. Não há seed. Sem linha, vale a constante `CRM_GUIDANCE_DEFAULTS` no código. "Restaurar padrão" apaga a linha.
- Alternativa: fazer seed com `onConflictDoNothing`, como em `function-seed.ts`. Descartada: depois do seed, uma melhoria no texto padrão feita no código nunca chegaria a quem não editou. Sem seed, o padrão evolui com o produto e só a edição explícita o substitui.

**2. As chaves são fixas e validadas.**
O tipo `CRM_GUIDANCE_KEYS = ['cliente_identificado', 'negocios_do_cliente', 'escopo_dados', 'cliente_nao_identificado']` fica em `@gptmaker/contracts`. O PUT recusa chave desconhecida com 404 e valida o texto com zod (trim, 1 a 1000 caracteres).

**3. A leitura passa por um serviço com cache Redis de 60 segundos.**
`CrmGuidanceService.current()` lê todas as linhas numa consulta, junta com os padrões e guarda o resultado no Redis (`crm:guidance`, TTL 60s). O save e o restore fazem `redis.del` depois de gravar. Se o Redis ou o banco falharem, o serviço registra um aviso e devolve os padrões. Assim a ferramenta segue o requisito "Falha ao ler as edições" sem gastar o tempo limite de 10 segundos.
- Alternativa: ler do banco a cada chamada. É viável no volume atual, mas cada chamada de ferramenta ganharia uma consulta a mais. O cache segue o padrão do saldo de créditos.
- O prazo de 1 minuto vale para o caso de várias réplicas da API, porque o `del` atinge o Redis compartilhado. Na prática, a edição vale na chamada seguinte.

**4. A orientação é montada no `CrmToolsService`.**
A orientação vira `${textos[chave]} ${textos.escopo_dados}` nas duas respostas de sucesso, como hoje. A mensagem de não identificado usa `textos.cliente_nao_identificado`. O `DATA_SCOPE` exportado sai do service e o padrão passa para `crm-guidance.defaults.ts`.

**5. As rotas ficam em `admin/crm-guidance`.**
- `GET /admin/crm-guidance` (`@AdminAuth()`) devolve, para cada chave: `text` em uso, `defaultText`, `edited`, `updatedBy` e `updatedAt`.
- `PUT /admin/crm-guidance/:key` (`@AdminAuth('ADMIN')`) salva o texto.
- `DELETE /admin/crm-guidance/:key` (`@AdminAuth('ADMIN')`) restaura o padrão.
- O service registra as ações `crm_guidance.updated` e `crm_guidance.reset` com `before`/`after`.

**6. A página do backoffice tem um card por texto e uma prévia.**
`frontend/src/app/admin/crm-guidance/page.tsx` tem:
- um card por chave, com textarea, contador, o selo "Editado" ou "Padrão", o botão "Restaurar padrão" e a data e o autor da edição;
- abaixo, a prévia das duas orientações compostas, como o agente recebe.

O item de menu fica no grupo de configurações do agente, visível para todos. A edição fica desabilitada para SUPPORT.

## Risks / Trade-offs

- [Um ADMIN apaga uma regra de segurança, como "não invente"] → A tela mostra o padrão ao lado e tem "Restaurar padrão". A auditoria registra quem mudou o quê.
- [Texto longo aumenta o custo de cada chamada] → Limite de 1000 caracteres por texto. O contador fica visível.
- [Cache desatualizado se o `del` falhar] → O TTL de 60 segundos limita o atraso, o que cumpre o requisito.

## Migration Plan

1. Migração `0019_crm_tool_guidance.sql`, gerada por `npm run db:generate -w backend`. Ela roda sozinha quando a API sobe.
2. Deploy normal. Sem linhas na tabela, o comportamento é idêntico ao atual.
3. Rollback: reverter o código. A tabela pode ficar, porque nada mais a lê.
