CREATE TYPE "public"."agent_test_client_type" AS ENUM('contact', 'lead', 'company');--> statement-breakpoint
CREATE TYPE "public"."agent_test_message_role" AS ENUM('USER', 'AGENT');--> statement-breakpoint
CREATE TYPE "public"."agent_test_message_status" AS ENUM('PENDING', 'ANSWERED', 'FAILED', 'DELIVERED');--> statement-breakpoint
CREATE TABLE "agent_test_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"context_id" text NOT NULL,
	"client_type" "agent_test_client_type",
	"client_id" integer,
	"client_name" text,
	"created_by_user_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_test_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "agent_test_message_role" NOT NULL,
	"text" text NOT NULL,
	"status" "agent_test_message_status" NOT NULL,
	"model_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_test_conversation" ADD CONSTRAINT "agent_test_conversation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_test_conversation" ADD CONSTRAINT "agent_test_conversation_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_test_message" ADD CONSTRAINT "agent_test_message_conversation_id_agent_test_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_test_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_test_conversation_context_uq" ON "agent_test_conversation" USING btree ("context_id");--> statement-breakpoint
CREATE INDEX "agent_test_conversation_agent_idx" ON "agent_test_conversation" USING btree ("agent_id","last_message_at" desc);--> statement-breakpoint
CREATE INDEX "agent_test_message_conversation_idx" ON "agent_test_message" USING btree ("conversation_id","created_at");