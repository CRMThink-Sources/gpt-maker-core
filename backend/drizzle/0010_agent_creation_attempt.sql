CREATE TABLE "agent_creation_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"gptmaker_agent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_creation_attempt" ADD CONSTRAINT "agent_creation_attempt_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_creation_attempt_gptmaker_idx" ON "agent_creation_attempt" USING btree ("gptmaker_agent_id");--> statement-breakpoint
CREATE INDEX "agent_creation_attempt_created_idx" ON "agent_creation_attempt" USING btree ("created_at");