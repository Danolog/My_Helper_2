CREATE TABLE "deposit_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"salon_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'PLN' NOT NULL,
	"payment_method" text NOT NULL,
	"blik_phone_number" text,
	"stripe_payment_intent_id" text,
	"stripe_refund_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp,
	"refunded_at" timestamp,
	"refund_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"salon_id" uuid NOT NULL,
	"receipt_number" text NOT NULL,
	"nip" text,
	"client_name" text,
	"employee_name" text,
	"service_name" text,
	"service_price" numeric(10, 2) NOT NULL,
	"materials_cost" numeric(10, 2) DEFAULT '0',
	"total_amount" numeric(10, 2) NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '23',
	"vat_amount" numeric(10, 2),
	"net_amount" numeric(10, 2),
	"payment_method" text DEFAULT 'cash',
	"printer_model" text,
	"printed_at" timestamp DEFAULT now() NOT NULL,
	"print_status" text DEFAULT 'sent' NOT NULL,
	"receipt_data_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"post_type" text NOT NULL,
	"content" text NOT NULL,
	"hashtags" jsonb DEFAULT '[]'::jsonb,
	"tone" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"published_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"default_quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "rating" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "booked_by_user_id" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "reminder_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "reminder_1h_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "reminder_push_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "reminder_push_1h_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "promo_code_id" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "discount_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "guest_name" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "guest_phone" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "guest_email" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "birthday" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "require_deposit" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "deposit_type" text DEFAULT 'percentage';--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "deposit_value" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "commission_rate" numeric(5, 2) DEFAULT '50';--> statement-breakpoint
ALTER TABLE "gallery_photos" ADD COLUMN "show_products_to_clients" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "client_name" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "client_address" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "vat_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "vat_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "net_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "invoice_data_json" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "email_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "email_sent_to" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "owner_response" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "owner_response_at" timestamp;--> statement-breakpoint
ALTER TABLE "salon_subscriptions" ADD COLUMN "scheduled_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "salon_subscriptions" ADD COLUMN "scheduled_change_at" timestamp;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "suggested_next_visit_days" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "deposit_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "deposit_percentage" integer DEFAULT 30;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'client';--> statement-breakpoint
ALTER TABLE "waiting_list" ADD COLUMN "offered_start_time" timestamp;--> statement-breakpoint
ALTER TABLE "waiting_list" ADD COLUMN "offered_end_time" timestamp;--> statement-breakpoint
ALTER TABLE "waiting_list" ADD COLUMN "offered_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "waiting_list" ADD COLUMN "existing_appointment_id" uuid;--> statement-breakpoint
ALTER TABLE "waiting_list" ADD COLUMN "accept_token" text;--> statement-breakpoint
ALTER TABLE "deposit_payments" ADD CONSTRAINT "deposit_payments_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_payments" ADD CONSTRAINT "deposit_payments_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_services" ADD CONSTRAINT "employee_services_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_services" ADD CONSTRAINT "employee_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_products" ADD CONSTRAINT "service_products_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_products" ADD CONSTRAINT "service_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deposit_payments_appointment_id_idx" ON "deposit_payments" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "deposit_payments_salon_id_idx" ON "deposit_payments" USING btree ("salon_id");--> statement-breakpoint
CREATE INDEX "deposit_payments_status_idx" ON "deposit_payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "employee_services_employee_id_idx" ON "employee_services" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_services_service_id_idx" ON "employee_services" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "fiscal_receipts_appointment_id_idx" ON "fiscal_receipts" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "fiscal_receipts_salon_id_idx" ON "fiscal_receipts" USING btree ("salon_id");--> statement-breakpoint
CREATE INDEX "fiscal_receipts_receipt_number_idx" ON "fiscal_receipts" USING btree ("receipt_number");--> statement-breakpoint
CREATE INDEX "product_categories_salon_id_idx" ON "product_categories" USING btree ("salon_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "scheduled_posts_salon_id_idx" ON "scheduled_posts" USING btree ("salon_id");--> statement-breakpoint
CREATE INDEX "scheduled_posts_status_idx" ON "scheduled_posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scheduled_posts_scheduled_at_idx" ON "scheduled_posts" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "service_products_service_id_idx" ON "service_products" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "service_products_product_id_idx" ON "service_products" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_booked_by_user_id_user_id_fk" FOREIGN KEY ("booked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiting_list" ADD CONSTRAINT "waiting_list_offered_employee_id_employees_id_fk" FOREIGN KEY ("offered_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiting_list" ADD CONSTRAINT "waiting_list_existing_appointment_id_appointments_id_fk" FOREIGN KEY ("existing_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;