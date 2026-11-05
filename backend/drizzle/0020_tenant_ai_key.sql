CREATE TABLE "tenant_ai_key" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"api_key" text NOT NULL,
	"last4" text NOT NULL,
	"model" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_ai_key" ADD CONSTRAINT "tenant_ai_key_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;