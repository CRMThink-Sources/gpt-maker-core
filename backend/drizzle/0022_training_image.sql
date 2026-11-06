CREATE TABLE "training_image" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mimetype" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "training" ADD COLUMN "image_id" uuid;--> statement-breakpoint
ALTER TABLE "training_image" ADD CONSTRAINT "training_image_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_image" ADD CONSTRAINT "training_image_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_image_object_key_uq" ON "training_image" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "training_image_tenant_idx" ON "training_image" USING btree ("tenant_id") WHERE "training_image"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "training_image_agent_idx" ON "training_image" USING btree ("agent_id");--> statement-breakpoint
ALTER TABLE "training" ADD CONSTRAINT "training_image_id_training_image_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."training_image"("id") ON DELETE no action ON UPDATE no action;