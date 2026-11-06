ALTER TYPE "public"."message_status" ADD VALUE 'SKIPPED_OUT_OF_HOURS' BEFORE 'FAILED';--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "business_hours" jsonb;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "out_of_hours_message" text;