ALTER TYPE "public"."training_status" ADD VALUE 'EXPIRED';--> statement-breakpoint
ALTER TABLE "training" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "training" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "training" ADD COLUMN "expired_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "training_expiry_scan_idx" ON "training" USING btree ("expires_at") WHERE "training"."expires_at" is not null and "training"."expired_at" is null and "training"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "training_tags_gin_idx" ON "training" USING gin ("tags");