# Documentação técnica

- Arquitetura e decisões: `openspec/changes/bitrix-gptmaker-agents-platform/design.md`
- Contrato do `crmthink-platform`: `openspec-crmthink-platform/` e o OpenAPI publicado pela plataforma (`/openapi.json`, `/docs`)
- API do GPTMaker, com os payloads reais dos webhooks: `gptmaker-api.md` (§5.4.1)
- Roteiro de provisionamento do staging: `staging.md`
- Comportamento observado do Bitrix24 (eventos do chatbot, vínculo do diálogo com o CRM): `bitrix-observado.md`
- Runbook de operação (DLQ, reautorização, segredos, backup, fechamento mensal, eventos de pagamento): `runbook.md`
- Ferramentas do agente sobre o CRM e agenda do Calendário: `crm-tools.md` (roteiro de teste: `roteiro-teste-agenda.md`)
- Produção no Droplet compartilhado: `producao.md`
