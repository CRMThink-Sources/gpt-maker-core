ALTER TYPE "public"."reconciliation_status" ADD VALUE 'APPROVED';--> statement-breakpoint
ALTER TYPE "public"."reconciliation_status" ADD VALUE 'DISMISSED';--> statement-breakpoint
CREATE TABLE "usage_daily_unlinked" (
	"gptmaker_agent_id" text NOT NULL,
	"day" date NOT NULL,
	"model_code" text NOT NULL,
	"credits" integer NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_daily_unlinked_gptmaker_agent_id_day_model_code_pk" PRIMARY KEY("gptmaker_agent_id","day","model_code")
);
--> statement-breakpoint
ALTER TABLE "reconciliation_adjustment" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "reconciliation_adjustment" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "usage_daily_unlinked_day_idx" ON "usage_daily_unlinked" USING btree ("day");