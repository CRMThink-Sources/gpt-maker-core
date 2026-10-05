CREATE TYPE "public"."notification_status" AS ENUM('PENDING', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('CREDIT_80', 'CREDIT_ZERO', 'PAYMENT_FAILED', 'PERIOD_ENDING', 'MODEL_DOWNGRADED', 'TEST');--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"dedupe_key" text NOT NULL,
	"message" text NOT NULL,
	"status" "notification_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_recipient" (
	"tenant_id" uuid NOT NULL,
	"bitrix_user_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_recipient_tenant_id_bitrix_user_id_pk" PRIMARY KEY("tenant_id","bitrix_user_id")
);
--> statement-breakpoint
CREATE TABLE "portal_admin" (
	"tenant_id" uuid NOT NULL,
	"bitrix_user_id" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_admin_tenant_id_bitrix_user_id_pk" PRIMARY KEY("tenant_id","bitrix_user_id")
);
--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipient" ADD CONSTRAINT "notification_recipient_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_admin" ADD CONSTRAINT "portal_admin_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_log_dedupe_uq" ON "notification_log" USING btree ("tenant_id","type","dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_log_pending_idx" ON "notification_log" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notification_log_tenant_idx" ON "notification_log" USING btree ("tenant_id","created_at");