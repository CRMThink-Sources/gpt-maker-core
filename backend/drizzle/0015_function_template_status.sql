ALTER TABLE "agent_function_template" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_function_template" ADD COLUMN "deleted_at" timestamp with time zone;