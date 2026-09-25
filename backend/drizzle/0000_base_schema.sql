CREATE TYPE "public"."agent_inactive_reason" AS ENUM('MANUAL', 'SUBSCRIPTION_EXPIRED', 'TENANT_SUSPENDED', 'UNINSTALLED');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('ACTIVE', 'INACTIVE', 'DELETED', 'OUT_OF_SYNC');--> statement-breakpoint
CREATE TYPE "public"."agent_type" AS ENUM('SUPPORT', 'SALE', 'PERSONAL');--> statement-breakpoint
CREATE TYPE "public"."communication_type" AS ENUM('FORMAL', 'NORMAL', 'RELAXED');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('IN', 'OUT');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('RECEIVED', 'RESPONDED', 'BLOCKED_NO_CREDIT', 'SKIPPED_HUMAN', 'SKIPPED_INACTIVE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."training_status" AS ENUM('PROCESSING', 'DONE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."training_type" AS ENUM('TEXT', 'WEBSITE', 'VIDEO', 'DOCUMENT');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('OPERATOR', 'TENANT_USER', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."backoffice_role" AS ENUM('ADMIN', 'SUPPORT');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('GRANT', 'TOPUP', 'DEBIT', 'ADJUSTMENT', 'EXPIRE', 'REFUND');--> statement-breakpoint
CREATE TYPE "public"."wallet" AS ENUM('TRIAL', 'PLAN', 'EXTRA');--> statement-breakpoint
CREATE TYPE "public"."plan_type" AS ENUM('subscription', 'one_time');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('PENDING', 'DONE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."payment_event_status" AS ENUM('RECEIVED', 'PROCESSED', 'OBSOLETE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."subscription_modality" AS ENUM('stripe', 'manual');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'cancelled', 'trial_expired');--> statement-breakpoint
CREATE TYPE "public"."workspace_finding_kind" AS ENUM('ORPHAN', 'MISSING', 'STATUS_MISMATCH');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('ACTIVE', 'SUSPENDED', 'AUTH_ERROR', 'UNINSTALLED');--> statement-breakpoint
CREATE TYPE "public"."gptmaker_event" AS ENUM('onNewMessage', 'onLackKnowLedge', 'onTransfer', 'onFirstInteraction', 'onStartInteraction', 'onFinishInteraction', 'onCreateEvent', 'onCancelEvent');--> statement-breakpoint
CREATE TYPE "public"."trigger_action_type" AS ENUM('CREATE_LEAD', 'UPSERT_DEAL', 'TIMELINE_COMMENT', 'CREATE_TASK', 'START_BIZPROC', 'OUTBOUND_WEBHOOK');--> statement-breakpoint
CREATE TYPE "public"."trigger_execution_status" AS ENUM('PENDING', 'SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TABLE "agent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gptmaker_agent_id" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"behavior" text,
	"type" "agent_type" NOT NULL,
	"communication_type" "communication_type" NOT NULL,
	"job_name" text,
	"job_site" text,
	"job_description" text,
	"model_id" uuid NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "agent_status" DEFAULT 'ACTIVE' NOT NULL,
	"inactive_reason" "agent_inactive_reason",
	"webhook_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_bot" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bot_id" text NOT NULL,
	"bot_code" text NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dialog_state" (
	"tenant_id" uuid NOT NULL,
	"dialog_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"gptmaker_chat_id" text,
	"human_active" boolean DEFAULT false NOT NULL,
	"human_started_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dialog_state_tenant_id_dialog_id_pk" PRIMARY KEY("tenant_id","dialog_id")
);
--> statement-breakpoint
CREATE TABLE "message_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"dialog_id" text NOT NULL,
	"bitrix_message_id" text NOT NULL,
	"direction" "message_direction" NOT NULL,
	"status" "message_status" NOT NULL,
	"model_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"gptmaker_training_id" text,
	"type" "training_type" NOT NULL,
	"content" text,
	"url" text,
	"training_sub_pages" boolean,
	"training_interval" text,
	"document_key" text,
	"document_name" text,
	"document_mimetype" text,
	"document_size_bytes" integer,
	"status" "training_status" DEFAULT 'PROCESSING' NOT NULL,
	"callback_token_hash" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"tenant_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backoffice_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"totp_secret" text,
	"role" "backoffice_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_deduction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"remaining" integer NOT NULL,
	"ref_charge_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_deduction_amount_positive" CHECK ("credit_deduction"."amount" > 0),
	CONSTRAINT "credit_deduction_remaining_range" CHECK ("credit_deduction"."remaining" between 0 and "credit_deduction"."amount")
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"wallet" "wallet" NOT NULL,
	"type" "ledger_entry_type" NOT NULL,
	"amount" integer NOT NULL,
	"agent_id" uuid,
	"model_code" text,
	"unit_cost" integer,
	"subscription_id" text,
	"period_start" timestamp with time zone,
	"ref_type" text,
	"ref_id" text,
	"idempotency_key" text NOT NULL,
	"reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_amount_nonzero" CHECK ("credit_ledger"."amount" <> 0),
	CONSTRAINT "credit_ledger_amount_sign" CHECK (("credit_ledger"."type" in ('GRANT', 'TOPUP') and "credit_ledger"."amount" > 0)
        or ("credit_ledger"."type" in ('DEBIT', 'EXPIRE', 'REFUND') and "credit_ledger"."amount" < 0)
        or "credit_ledger"."type" = 'ADJUSTMENT'),
	CONSTRAINT "credit_ledger_debit_model" CHECK ("credit_ledger"."type" <> 'DEBIT' or ("credit_ledger"."model_code" is not null and "credit_ledger"."unit_cost" is not null))
);
--> statement-breakpoint
CREATE TABLE "tenant_balance" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"trial_balance" integer DEFAULT 0 NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"plan_balance" integer DEFAULT 0 NOT NULL,
	"extra_balance" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_balance_trial_nonnegative" CHECK ("tenant_balance"."trial_balance" >= 0),
	CONSTRAINT "tenant_balance_extra_nonnegative" CHECK ("tenant_balance"."extra_balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_model" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"credits_per_response" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_credits_positive" CHECK ("ai_model"."credits_per_response" > 0)
);
--> statement-breakpoint
CREATE TABLE "ai_model_cost_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"previous_cost" integer NOT NULL,
	"new_cost" integer NOT NULL,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_allowed_model" (
	"plan_spa_id" text NOT NULL,
	"model_id" uuid NOT NULL,
	CONSTRAINT "plan_allowed_model_plan_spa_id_model_id_pk" PRIMARY KEY("plan_spa_id","model_id")
);
--> statement-breakpoint
CREATE TABLE "plan_entitlement" (
	"plan_spa_id" text PRIMARY KEY NOT NULL,
	"plan_type" "plan_type" NOT NULL,
	"credits_per_cycle" integer,
	"credits_per_package" integer,
	"max_trainings" integer,
	"max_document_storage_mb" integer,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_entitlement_credits_by_type" CHECK (("plan_entitlement"."plan_type" = 'subscription' and "plan_entitlement"."credits_per_cycle" is not null and "plan_entitlement"."credits_per_cycle" >= 0)
        or ("plan_entitlement"."plan_type" = 'one_time' and "plan_entitlement"."credits_per_package" is not null and "plan_entitlement"."credits_per_package" > 0))
);
--> statement-breakpoint
CREATE TABLE "payment_event" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"installation_id" text NOT NULL,
	"tenant_id" uuid,
	"payload" jsonb NOT NULL,
	"status" "payment_event_status" DEFAULT 'RECEIVED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"aggregate_ref" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subscription_state" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"status" "subscription_status" NOT NULL,
	"modality" "subscription_modality" NOT NULL,
	"plan_id" text,
	"next_plan_id" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"version" integer NOT NULL,
	"grace_until" timestamp with time zone,
	"cancel_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_adjustment" (
	"agent_id" uuid NOT NULL,
	"day" date NOT NULL,
	"tenant_id" uuid NOT NULL,
	"real_total" integer NOT NULL,
	"debited_total" integer NOT NULL,
	"adjusted_total" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_adjustment_agent_id_day_pk" PRIMARY KEY("agent_id","day")
);
--> statement-breakpoint
CREATE TABLE "usage_daily_real" (
	"agent_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"model_code" text NOT NULL,
	"credits" integer NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_daily_real_agent_id_day_model_code_pk" PRIMARY KEY("agent_id","day","model_code")
);
--> statement-breakpoint
CREATE TABLE "workspace_sync_finding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "workspace_finding_kind" NOT NULL,
	"gptmaker_agent_id" text NOT NULL,
	"agent_id" uuid,
	"details" jsonb,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "app_user_permission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bitrix_user_id" text NOT NULL,
	"granted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" text NOT NULL,
	"member_id" text NOT NULL,
	"domain" text NOT NULL,
	"tenant_code" text NOT NULL,
	"status" "tenant_status" DEFAULT 'ACTIVE' NOT NULL,
	"suspended_reason" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uninstalled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"event" "gptmaker_event" NOT NULL,
	"dialog_id" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trigger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" text NOT NULL,
	"event" "gptmaker_event" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trigger_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" "trigger_action_type" NOT NULL,
	"config" jsonb NOT NULL,
	"secret" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trigger_execution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"trigger_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"agent_event_id" uuid NOT NULL,
	"status" "trigger_execution_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_model_id_ai_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_model"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_bot" ADD CONSTRAINT "agent_bot_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_bot" ADD CONSTRAINT "agent_bot_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialog_state" ADD CONSTRAINT "dialog_state_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialog_state" ADD CONSTRAINT "dialog_state_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training" ADD CONSTRAINT "training_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training" ADD CONSTRAINT "training_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_deduction" ADD CONSTRAINT "credit_deduction_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_balance" ADD CONSTRAINT "tenant_balance_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_cost_history" ADD CONSTRAINT "ai_model_cost_history_model_id_ai_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_model"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_allowed_model" ADD CONSTRAINT "plan_allowed_model_plan_spa_id_plan_entitlement_plan_spa_id_fk" FOREIGN KEY ("plan_spa_id") REFERENCES "public"."plan_entitlement"("plan_spa_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_allowed_model" ADD CONSTRAINT "plan_allowed_model_model_id_ai_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_model"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_outbox" ADD CONSTRAINT "payments_outbox_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_state" ADD CONSTRAINT "subscription_state_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_adjustment" ADD CONSTRAINT "reconciliation_adjustment_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_adjustment" ADD CONSTRAINT "reconciliation_adjustment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily_real" ADD CONSTRAINT "usage_daily_real_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily_real" ADD CONSTRAINT "usage_daily_real_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_sync_finding" ADD CONSTRAINT "workspace_sync_finding_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_permission" ADD CONSTRAINT "app_user_permission_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event" ADD CONSTRAINT "agent_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event" ADD CONSTRAINT "agent_event_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger" ADD CONSTRAINT "trigger_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger" ADD CONSTRAINT "trigger_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_action" ADD CONSTRAINT "trigger_action_trigger_id_trigger_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."trigger"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_execution" ADD CONSTRAINT "trigger_execution_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_execution" ADD CONSTRAINT "trigger_execution_trigger_id_trigger_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."trigger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_execution" ADD CONSTRAINT "trigger_execution_action_id_trigger_action_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."trigger_action"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_execution" ADD CONSTRAINT "trigger_execution_agent_event_id_agent_event_id_fk" FOREIGN KEY ("agent_event_id") REFERENCES "public"."agent_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_gptmaker_agent_id_uq" ON "agent" USING btree ("gptmaker_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_webhook_token_hash_uq" ON "agent" USING btree ("webhook_token_hash");--> statement-breakpoint
CREATE INDEX "agent_tenant_idx" ON "agent" USING btree ("tenant_id") WHERE "agent"."status" <> 'DELETED';--> statement-breakpoint
CREATE INDEX "agent_model_idx" ON "agent" USING btree ("model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_bot_tenant_bot_uq" ON "agent_bot" USING btree ("tenant_id","bot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_bot_tenant_code_uq" ON "agent_bot" USING btree ("tenant_id","bot_code");--> statement-breakpoint
CREATE INDEX "dialog_state_gptmaker_chat_idx" ON "dialog_state" USING btree ("gptmaker_chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_log_message_uq" ON "message_log" USING btree ("tenant_id","bitrix_message_id","direction");--> statement-breakpoint
CREATE INDEX "message_log_agent_idx" ON "message_log" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "message_log_dialog_idx" ON "message_log" USING btree ("tenant_id","dialog_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "training_gptmaker_training_id_uq" ON "training" USING btree ("gptmaker_training_id");--> statement-breakpoint
CREATE INDEX "training_agent_idx" ON "training" USING btree ("agent_id") WHERE "training"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "training_tenant_idx" ON "training" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_log_tenant_idx" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "backoffice_user_email_uq" ON "backoffice_user" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "credit_deduction_ref_charge_id_uq" ON "credit_deduction" USING btree ("ref_charge_id");--> statement-breakpoint
CREATE INDEX "credit_deduction_pending_idx" ON "credit_deduction" USING btree ("tenant_id") WHERE "credit_deduction"."remaining" > 0;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_idempotency_key_uq" ON "credit_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_ledger_tenant_idx" ON "credit_ledger" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_agent_idx" ON "credit_ledger" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_model_code_uq" ON "ai_model" USING btree ("code") WHERE "ai_model"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_model_default_uq" ON "ai_model" USING btree ("is_default") WHERE "ai_model"."is_default" and "ai_model"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "ai_model_cost_history_model_idx" ON "ai_model_cost_history" USING btree ("model_id","changed_at");--> statement-breakpoint
CREATE INDEX "payment_event_tenant_idx" ON "payment_event" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE INDEX "payment_event_pending_idx" ON "payment_event" USING btree ("received_at") WHERE "payment_event"."status" in ('RECEIVED', 'FAILED');--> statement-breakpoint
CREATE INDEX "payments_outbox_due_idx" ON "payments_outbox" USING btree ("next_attempt_at") WHERE "payments_outbox"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "payments_outbox_aggregate_idx" ON "payments_outbox" USING btree ("aggregate_ref","created_at");--> statement-breakpoint
CREATE INDEX "usage_daily_real_tenant_day_idx" ON "usage_daily_real" USING btree ("tenant_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_sync_finding_open_uq" ON "workspace_sync_finding" USING btree ("kind","gptmaker_agent_id") WHERE "workspace_sync_finding"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_permission_tenant_user_uq" ON "app_user_permission" USING btree ("tenant_id","bitrix_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_installation_id_uq" ON "tenant" USING btree ("installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_member_id_uq" ON "tenant" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_tenant_code_uq" ON "tenant" USING btree ("tenant_code");--> statement-breakpoint
CREATE INDEX "agent_event_agent_idx" ON "agent_event" USING btree ("agent_id","received_at");--> statement-breakpoint
CREATE INDEX "trigger_agent_event_idx" ON "trigger" USING btree ("agent_id","event") WHERE "trigger"."active" and "trigger"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "trigger_tenant_idx" ON "trigger" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trigger_action_position_uq" ON "trigger_action" USING btree ("trigger_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "trigger_execution_event_action_uq" ON "trigger_execution" USING btree ("agent_event_id","action_id");--> statement-breakpoint
CREATE INDEX "trigger_execution_trigger_idx" ON "trigger_execution" USING btree ("trigger_id","created_at");