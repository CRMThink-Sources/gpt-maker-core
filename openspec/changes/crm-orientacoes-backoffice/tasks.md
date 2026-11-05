# Tasks

## 1. Contratos e dados

- [x] 1.1 Adicionar em `@gptmaker/contracts` `CRM_GUIDANCE_KEYS`, `crmGuidanceInputSchema` (trim, 1 a 1000 caracteres) e `CrmGuidanceView`, com teste do schema (vazio, só espaços, 1001 caracteres); verificar com `npm test -w packages/contracts`
- [x] 1.2 Criar a tabela `crm_tool_guidance` no schema Drizzle, exportar em `schema/index.ts` e gerar a migração `0019`; verificar que `npm run db:migrate -w backend` aplica num banco local

## 2. Leitura com padrão e cache

- [x] 2.1 Mover os textos atuais para `crm-guidance.defaults.ts` sem mudar a redação; verificar que os testes atuais de `crm-tools.service.test.ts` continuam passando
- [x] 2.2 Criar `CrmGuidanceService.current()` com cache Redis de 60s e volta ao padrão em caso de falha, e testar: sem linhas devolve o padrão, com linha devolve a edição, Redis ou banco com erro devolve o padrão
- [x] 2.3 Fazer o `CrmToolsService` montar a orientação e a mensagem de não identificado a partir de `current()`, e testar que um texto editado aparece na resposta de `negocios_do_cliente` seguido do escopo

## 3. API do backoffice

- [x] 3.1 Criar `admin/crm-guidance` (GET, PUT, DELETE) com `@AdminAuth`, auditoria `crm_guidance.updated`/`crm_guidance.reset` e `redis.del` depois de gravar, e testar: SUPPORT recebe 403 no PUT, chave desconhecida recebe 404, texto inválido recebe 400, e PUT e DELETE gravam auditoria com before/after

## 4. Página do backoffice

- [ ] 4.1 Criar `frontend/src/app/admin/crm-guidance/page.tsx` com um card por texto (contador, selo Editado/Padrão, Restaurar padrão, autor e data), a prévia das orientações compostas e a edição desabilitada para SUPPORT, e adicionar o item no menu em `admin-provider.tsx`; verificar typecheck e lint, e testar a página no backoffice local com os dois perfis

## 5. Verificação integrada

- [ ] 5.1 Editar um texto no backoffice local, chamar a ferramenta pelo chat de teste do agente e conferir a orientação nova; depois restaurar o padrão e conferir o texto original
- [x] 5.2 Rodar `openspec validate crm-orientacoes-backoffice --strict` e verificar que passa
