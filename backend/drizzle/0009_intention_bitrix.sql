CREATE TYPE "public"."intention_execution_status" AS ENUM('SUCCESS', 'FAILED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."intention_kind" AS ENUM('WEBHOOK', 'BITRIX');--> statement-breakpoint
CREATE TABLE "intention_execution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"intention_id" uuid NOT NULL,
	"status" "intention_execution_status" NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dialog_id" text,
	"message" text NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_intention" ADD COLUMN "kind" "intention_kind" DEFAULT 'WEBHOOK' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_intention" ADD COLUMN "actions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_intention" ADD COLUMN "token_encrypted" text;--> statement-breakpoint
ALTER TABLE "intention_execution" ADD CONSTRAINT "intention_execution_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intention_execution" ADD CONSTRAINT "intention_execution_intention_id_agent_intention_id_fk" FOREIGN KEY ("intention_id") REFERENCES "public"."agent_intention"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intention_execution_intention_idx" ON "intention_execution" USING btree ("intention_id","created_at");--> statement-breakpoint
CREATE INDEX "intention_execution_tenant_idx" ON "intention_execution" USING btree ("tenant_id","created_at");