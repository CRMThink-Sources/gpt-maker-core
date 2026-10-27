CREATE TABLE "agent_function_template_tenant" (
	"template_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_function_template_tenant_template_id_tenant_id_pk" PRIMARY KEY("template_id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "agent_function_template_tenant" ADD CONSTRAINT "agent_function_template_tenant_template_id_agent_function_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agent_function_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_function_template_tenant" ADD CONSTRAINT "agent_function_template_tenant_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_function_template_tenant_tenant_idx" ON "agent_function_template_tenant" USING btree ("tenant_id");