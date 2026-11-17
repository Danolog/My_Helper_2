ALTER TABLE "waiting_list" ADD COLUMN "source" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "waiting_list" ADD COLUMN "client_request_confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "waiting_list" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "waiting_list" ADD CONSTRAINT "waiting_list_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waiting_list_created_by_user_id_idx" ON "waiting_list" USING btree ("created_by_user_id");--> statement-breakpoint
ALTER TABLE "waiting_list" ADD CONSTRAINT "waiting_list_source_valid" CHECK ("waiting_list"."source" IN ('client_portal', 'staff', 'legacy'));--> statement-breakpoint
ALTER TABLE "waiting_list" ADD CONSTRAINT "waiting_list_client_request_confirmed" CHECK ("waiting_list"."source" = 'legacy' OR "waiting_list"."client_request_confirmed_at" IS NOT NULL);