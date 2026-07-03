-- 0006 — domknięcie integralności schematu (audyt 2026-07):
--   1. Tabela ai_generated_media (dotąd tylko w schema.ts / db:push) + jej RLS.
--   2. Brakujące FK: appointments.variant_id, appointment_materials.product_id,
--      fiscal_receipts.appointment_id / salon_id.
--   3. Brakujące indeksy: appointments(variant_id), appointments(end_time),
--      clients(birthday).
--
-- Migracja jest IDEMPOTENTNA: bazy dev/prod mogły już dostać część tych
-- obiektów przez `drizzle-kit push` (bez wpisu w journalu). CREATE ... IF NOT
-- EXISTS + guardy na constraintach pozwalają uruchomić ją bezpiecznie i na
-- czystej bazie, i na bazie "wypchniętej" push-em.
--
-- Przed każdym ADD CONSTRAINT czyszczone są sieroty — inaczej walidacja FK
-- wywali migrację na danych historycznych.

CREATE TABLE IF NOT EXISTS "ai_generated_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"type" text NOT NULL,
	"source_url" text,
	"result_url" text,
	"provider" text NOT NULL,
	"prompt" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"task_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- RLS dla ai_generated_media: migracja 0005 celowo POMIJA tabele, których
-- jeszcze nie ma — na czystej bazie tabela powstaje dopiero tutaj, więc
-- polityka tenant_isolation musi zostać założona tutaj (ten sam kształt co 0005).
ALTER TABLE "ai_generated_media" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "ai_generated_media";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_generated_media"
  USING (salon_id = current_setting('app.current_salon_id', true)::uuid)
  WITH CHECK (salon_id = current_setting('app.current_salon_id', true)::uuid);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_generated_media_salon_id_salons_id_fk') THEN
    DELETE FROM "ai_generated_media" m WHERE NOT EXISTS (SELECT 1 FROM "salons" s WHERE s."id" = m."salon_id");
    ALTER TABLE "ai_generated_media" ADD CONSTRAINT "ai_generated_media_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_generated_media_salon_id_idx" ON "ai_generated_media" USING btree ("salon_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_generated_media_status_idx" ON "ai_generated_media" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_generated_media_task_id_idx" ON "ai_generated_media" USING btree ("task_id");--> statement-breakpoint

-- appointment_materials.product_id (NOT NULL, cascade): sieroty do usunięcia —
-- wpis o zużyciu nieistniejącego produktu nie niesie informacji.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointment_materials_product_id_products_id_fk') THEN
    DELETE FROM "appointment_materials" am WHERE NOT EXISTS (SELECT 1 FROM "products" p WHERE p."id" = am."product_id");
    ALTER TABLE "appointment_materials" ADD CONSTRAINT "appointment_materials_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

-- appointments.variant_id (nullable, set null): sieroty wyzerować, nie kasować
-- wizyt — usunięcie wariantu usługi nie może dotykać historii.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_variant_id_service_variants_id_fk') THEN
    UPDATE "appointments" a SET "variant_id" = NULL
      WHERE a."variant_id" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "service_variants" v WHERE v."id" = a."variant_id");
    ALTER TABLE "appointments" ADD CONSTRAINT "appointments_variant_id_service_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."service_variants"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

-- fiscal_receipts (NOT NULL, cascade): sieroty (paragon bez wizyty/salonu w DB)
-- do usunięcia — to zapisy symulatora, realna fiskalizacja żyje w drukarce.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_receipts_appointment_id_appointments_id_fk') THEN
    DELETE FROM "fiscal_receipts" fr WHERE NOT EXISTS (SELECT 1 FROM "appointments" a WHERE a."id" = fr."appointment_id");
    ALTER TABLE "fiscal_receipts" ADD CONSTRAINT "fiscal_receipts_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_receipts_salon_id_salons_id_fk') THEN
    DELETE FROM "fiscal_receipts" fr WHERE NOT EXISTS (SELECT 1 FROM "salons" s WHERE s."id" = fr."salon_id");
    ALTER TABLE "fiscal_receipts" ADD CONSTRAINT "fiscal_receipts_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_variant_id_idx" ON "appointments" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_end_time_idx" ON "appointments" USING btree ("end_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_birthday_idx" ON "clients" USING btree ("birthday");
