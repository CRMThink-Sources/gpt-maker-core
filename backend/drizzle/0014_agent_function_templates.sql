CREATE TYPE "public"."agent_function_mode" AS ENUM('SIMPLE', 'ADVANCED', 'TAKEN_OVER');--> statement-breakpoint
CREATE TYPE "public"."function_publication_status" AS ENUM('IDLE', 'PENDING', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."managed_resource_kind" AS ENUM('TRAINING', 'INTENTION');--> statement-breakpoint
CREATE TABLE "agent_function_block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"draft" jsonb NOT NULL,
	"content" jsonb,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_function_config" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version_id" uuid,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_answers" jsonb,
	"mode" "agent_function_mode" DEFAULT 'SIMPLE' NOT NULL,
	"additional_instructions" text,
	"taken_over_behavior" text,
	"published_state" jsonb,
	"publication_status" "function_publication_status" DEFAULT 'IDLE' NOT NULL,
	"publication_target" jsonb,
	"publication_error" text,
	"needs_republish_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_function_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"draft" jsonb NOT NULL,
	"latest_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_function_template_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_managed_resource" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"kind" "managed_resource_kind" NOT NULL,
	"key" text NOT NULL,
	"hash" text NOT NULL,
	"training_id" uuid,
	"intention_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_reserved_agent" (
	"gptmaker_agent_id" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_reserved_agent_purpose_unique" UNIQUE("purpose")
);
--> statement-breakpoint
ALTER TABLE "agent_intention" ADD COLUMN "managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "training" ADD COLUMN "managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "is_partner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_function_config" ADD CONSTRAINT "agent_function_config_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_function_config" ADD CONSTRAINT "agent_function_config_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_function_config" ADD CONSTRAINT "agent_function_config_template_id_agent_function_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agent_function_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_function_config" ADD CONSTRAINT "agent_function_config_version_id_agent_function_template_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."agent_function_template_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_function_template_version" ADD CONSTRAINT "agent_function_template_version_template_id_agent_function_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agent_function_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_function_template_version" ADD CONSTRAINT "agent_function_template_version_published_by_backoffice_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."backoffice_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_managed_resource" ADD CONSTRAINT "agent_managed_resource_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_managed_resource" ADD CONSTRAINT "agent_managed_resource_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_managed_resource" ADD CONSTRAINT "agent_managed_resource_training_id_training_id_fk" FOREIGN KEY ("training_id") REFERENCES "public"."training"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_managed_resource" ADD CONSTRAINT "agent_managed_resource_intention_id_agent_intention_id_fk" FOREIGN KEY ("intention_id") REFERENCES "public"."agent_intention"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_function_block_code_uq" ON "agent_function_block" USING btree ("code");--> statement-breakpoint
CREATE INDEX "agent_function_config_tenant_idx" ON "agent_function_config" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "agent_function_config_version_idx" ON "agent_function_config" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_function_template_code_uq" ON "agent_function_template" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_function_template_version_uq" ON "agent_function_template_version" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_managed_resource_key_uq" ON "agent_managed_resource" USING btree ("agent_id","kind","key");