DROP INDEX "trigger_action_position_uq";--> statement-breakpoint
ALTER TABLE "trigger_action" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "trigger_action_position_uq" ON "trigger_action" USING btree ("trigger_id","position") WHERE "trigger_action"."deleted_at" is null;