CREATE TABLE "crm_tool_guidance" (
	"key" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_tool_guidance" ADD CONSTRAINT "crm_tool_guidance_updated_by_backoffice_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."backoffice_user"("id") ON DELETE no action ON UPDATE no action;