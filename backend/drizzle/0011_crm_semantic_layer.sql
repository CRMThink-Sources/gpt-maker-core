CREATE TYPE "public"."crm_access_status" AS ENUM('DISABLED', 'CONNECTING', 'CONNECTED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."crm_entity" AS ENUM('lead', 'deal', 'contact', 'company');--> statement-breakpoint
CREATE TABLE "agent_crm_access" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" "crm_access_status" DEFAULT 'DISABLED' NOT NULL,
	"token_hash" text,
	"token_encrypted" text,
	"gptmaker_intention_id" text,
	"gptmaker_mcp_id" text,
	"last_error" text,
	"last_call_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_field_setting" (
	"tenant_id" uuid NOT NULL,
	"entity" "crm_entity" NOT NULL,
	"field_code" text NOT NULL,
	"exposed" boolean NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_field_setting_tenant_id_entity_field_code_pk" PRIMARY KEY("tenant_id","entity","field_code")
);
--> statement-breakpoint
ALTER TABLE "agent_crm_access" ADD CONSTRAINT "agent_crm_access_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_crm_access" ADD CONSTRAINT "agent_crm_access_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_field_setting" ADD CONSTRAINT "crm_field_setting_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_crm_access_token_hash_uq" ON "agent_crm_access" USING btree ("token_hash");