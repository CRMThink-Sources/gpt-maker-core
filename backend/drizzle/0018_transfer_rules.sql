ALTER TYPE "public"."managed_resource_kind" ADD VALUE 'TRANSFER_RULE';--> statement-breakpoint
ALTER TABLE "agent_managed_resource" ADD COLUMN "transfer_rule_id" text;