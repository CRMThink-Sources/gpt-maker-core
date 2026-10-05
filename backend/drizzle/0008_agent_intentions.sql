CREATE TYPE "public"."intention_http_method" AS ENUM('GET', 'POST');--> statement-breakpoint
CREATE TYPE "public"."intention_response_mode" AS ENUM('API', 'INSTRUCTIONS');--> statement-breakpoint
CREATE TABLE "agent_intention" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"gptmaker_intention_id" text,
	"name" text NOT NULL,
	"when_to_use" text NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"http_method" "intention_http_method" NOT NULL,
	"url" text NOT NULL,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body" text,
	"auto_generate_params" boolean DEFAULT false NOT NULL,
	"auto_generate_body" boolean DEFAULT false NOT NULL,
	"response_mode" "intention_response_mode" DEFAULT 'API' NOT NULL,
	"instructions" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_intention" ADD CONSTRAINT "agent_intention_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_intention" ADD CONSTRAINT "agent_intention_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_intention_gptmaker_id_uq" ON "agent_intention" USING btree ("gptmaker_intention_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_intention_agent_name_uq" ON "agent_intention" USING btree ("agent_id",lower("name")) WHERE "agent_intention"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "agent_intention_tenant_idx" ON "agent_intention" USING btree ("tenant_id");