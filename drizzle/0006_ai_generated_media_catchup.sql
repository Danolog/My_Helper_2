-- =========================================================================
-- 0006 — Catch-up: pojednanie historii migracji z `schema.ts` (dryf db:push).
--
-- STATUS: PRZYGOTOWANA — NIE ZAAPLIKOWANA NA PROD. Wykonanie na bazie
--         produkcyjnej Neon = czerwona linia (migracja schemy prod, CLAUDE.md
--         sekcja 4) → wymaga sign-offu Darka w Plan Mode. Patrz ADR-002.
--         Lokalnie/test: wchodzi normalnie przez `pnpm db:migrate` (idempotentna).
--
-- KONTEKST (ADR-002, dryf schematu). Repo używa dwóch ścieżek tworzenia schematu:
--   • migracje (`db:migrate`)  — `package.json:build`, README,
--   • `db:push` z `schema.ts`  — CI quality-gate (`.github/workflows/quality-gate.yml`
--                                 :92,:160), skrypty `db:dev`/`db:reset`.
-- Część obiektów zdefiniowanych w `src/lib/schema.ts` powstała wyłącznie przez
-- `db:push` i NIGDY nie trafiła do migracji ani do snapshotów drizzle. Najbardziej
-- znaczący przypadek: tabela `ai_generated_media` (schema.ts:816-843) — UŻYWANA
-- przez żywą funkcję AI media (4 trasy API + UI video/story generator), a mimo to
-- bez `CREATE TABLE` w 0000–0004 i nieznana `drizzle-kit generate` (0 w snapshotach).
-- Ten sam dryf dotyczy kilku FK/indeksów (appointment_materials, fiscal_receipts,
-- clients_birthday) — patrz niżej.
--
-- DECYZJA (ADR-002): Wariant 3 — BACKFILL / pojednanie historii, nie tworzenie na
-- ślepo. Cała migracja jest IDEMPOTENTNA (`IF NOT EXISTS`, guardy `pg_constraint`),
-- więc działa POPRAWNIE niezależnie od tego, czy obiekty już istnieją na danej
-- bazie (powstały przez `db:push`), czy nie:
--   • istnieją  -> no-op (czysty backfill, tylko snapshot/journal się pojednał),
--   • nie ma ich -> migracja je tworzy.
-- Definicje są 1:1 z tym, co `drizzle-kit generate` policzył wobec `schema.ts`.
--
-- WERYFIKACJA PRZED PROD (jedno read-only pytanie — ADR-002 „Weryfikacja"):
--   SELECT to_regclass('public.ai_generated_media');
--   NULL  -> tabela NIE istnieje na prod -> ta migracja JĄ TWORZY (+ FK + indeksy).
--   nazwa -> tabela ISTNIEJE (db:push) -> CREATE IF NOT EXISTS = no-op, pojednanie.
--
-- KOLEJNOŚĆ vs RLS prod (0005 / runbook): jeśli RLS na prod jeszcze nie wdrożony —
-- najpierw ta migracja (tabela istnieje), POTEM runbook RLS (ma `ai_generated_media`
-- na liście direct_tables, więc założy politykę). Jeśli RLS już wdrożony — sekcja 5
-- niżej dokłada politykę tej tabeli, by nie powstała dziura cross-tenant.
-- =========================================================================

-- 1. `ai_generated_media` — tabela 1:1 z schema.ts. IF NOT EXISTS => bezpieczne przy db:push-prod.
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

-- 2. FK + indeksy `ai_generated_media` (FK idempotentnie przez pg_constraint).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_generated_media_salon_id_salons_id_fk') THEN
    ALTER TABLE "ai_generated_media"
      ADD CONSTRAINT "ai_generated_media_salon_id_salons_id_fk"
      FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_generated_media_salon_id_idx" ON "ai_generated_media" USING btree ("salon_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_generated_media_status_idx"   ON "ai_generated_media" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_generated_media_task_id_idx"  ON "ai_generated_media" USING btree ("task_id");--> statement-breakpoint

-- 3. Pozostały dryf tego samego typu (definicje w schema.ts, nigdy w migracji) —
--    pojednane idempotentnie. To NIE są tabele z izolacją najemcy do założenia tu;
--    to brakujące FK/indeksy, które `db:push` już dawno założył na bazach push.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointment_materials_product_id_products_id_fk') THEN
    ALTER TABLE "appointment_materials"
      ADD CONSTRAINT "appointment_materials_product_id_products_id_fk"
      FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_receipts_appointment_id_appointments_id_fk') THEN
    ALTER TABLE "fiscal_receipts"
      ADD CONSTRAINT "fiscal_receipts_appointment_id_appointments_id_fk"
      FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_receipts_salon_id_salons_id_fk') THEN
    ALTER TABLE "fiscal_receipts"
      ADD CONSTRAINT "fiscal_receipts_salon_id_salons_id_fk"
      FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_birthday_idx" ON "clients" USING btree ("birthday");--> statement-breakpoint

-- 4. RLS na `ai_generated_media` — TYLKO jeśli RLS-tenant już wdrożony na tej bazie
--    (rozpoznane po roli `myhelper_app` z 0005/runbooka). Lokalnie/test: rola jest
--    => polityka się zakłada od razu. Na prod przed RLS: roli nie ma => blok pomija
--    się, a politykę założy runbook RLS. Idempotentny (DROP POLICY IF EXISTS + CREATE).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'myhelper_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_generated_media" TO myhelper_app;
    ALTER TABLE "ai_generated_media" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON "ai_generated_media";
    CREATE POLICY tenant_isolation ON "ai_generated_media"
      USING (salon_id = current_setting('app.current_salon_id', true)::uuid)
      WITH CHECK (salon_id = current_setting('app.current_salon_id', true)::uuid);
  END IF;
END $$;
