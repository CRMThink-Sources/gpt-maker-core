CREATE TYPE "public"."calendar_mode" AS ENUM('FIXED_USER', 'CLIENT_OWNER', 'USER_LIST');--> statement-breakpoint
CREATE TABLE "agent_calendar_config" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mode" "calendar_mode" NOT NULL,
	"user_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"slot_minutes" integer DEFAULT 30 NOT NULL,
	"min_notice_minutes" integer DEFAULT 60 NOT NULL,
	"max_days_ahead" integer DEFAULT 7 NOT NULL,
	"last_scope_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_calendar_config_slot_minutes_ck" CHECK ("agent_calendar_config"."slot_minutes" between 15 and 240 and "agent_calendar_config"."slot_minutes" % 5 = 0),
	CONSTRAINT "agent_calendar_config_min_notice_ck" CHECK ("agent_calendar_config"."min_notice_minutes" between 0 and 1440),
	CONSTRAINT "agent_calendar_config_max_days_ck" CHECK ("agent_calendar_config"."max_days_ahead" between 1 and 30),
	CONSTRAINT "agent_calendar_config_user_ids_ck" CHECK (("agent_calendar_config"."mode" = 'CLIENT_OWNER' and cardinality("agent_calendar_config"."user_ids") = 0)
        or ("agent_calendar_config"."mode" = 'FIXED_USER' and cardinality("agent_calendar_config"."user_ids") = 1)
        or ("agent_calendar_config"."mode" = 'USER_LIST' and cardinality("agent_calendar_config"."user_ids") between 1 and 10))
);
--> statement-breakpoint
ALTER TABLE "agent_calendar_config" ADD CONSTRAINT "agent_calendar_config_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_calendar_config" ADD CONSTRAINT "agent_calendar_config_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_calendar_config_tenant_idx" ON "agent_calendar_config" USING btree ("tenant_id");