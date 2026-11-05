-- Contexto das conversas de teste encurtado para `<tenantId>:t-<10 hex>`: com `<tenantId>:test-<uuid>`
-- (78 caracteres) o GPTMaker responde success=false ("Transaction silently rolled back"). As
-- conversas criadas no formato antigo ganham uma chave nova (o contexto antigo nunca funcionou).
UPDATE "agent_test_conversation"
SET "context_id" = "tenant_id"::text || ':t-' || substr(md5("id"::text || clock_timestamp()::text), 1, 10)
WHERE "context_id" LIKE '%:test-%';
