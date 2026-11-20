CREATE TABLE "deposit_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"deposit_paid" boolean NOT NULL,
	"previous_deposit_paid" boolean NOT NULL,
	"source" text NOT NULL,
	"actor_user_id" text,
	"actor_role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposit_status_events_source_valid" CHECK ("deposit_status_events"."source" IN ('manual_mark', 'manual_unmark', 'owner_edit', 'stripe_confirmation', 'refund')),
	CONSTRAINT "deposit_status_events_value_changed" CHECK ("deposit_status_events"."deposit_paid" <> "deposit_status_events"."previous_deposit_paid"),
	CONSTRAINT "deposit_status_events_direction" CHECK (("deposit_status_events"."source" IN ('manual_mark', 'stripe_confirmation') AND "deposit_status_events"."deposit_paid") OR ("deposit_status_events"."source" IN ('manual_unmark', 'refund') AND NOT "deposit_status_events"."deposit_paid") OR "deposit_status_events"."source" = 'owner_edit'),
	CONSTRAINT "deposit_status_events_actor" CHECK (("deposit_status_events"."source" IN ('stripe_confirmation', 'refund') AND "deposit_status_events"."actor_user_id" IS NULL AND "deposit_status_events"."actor_role" IS NULL) OR ("deposit_status_events"."source" IN ('manual_mark', 'manual_unmark') AND "deposit_status_events"."actor_user_id" IS NOT NULL AND "deposit_status_events"."actor_role" IN ('owner', 'receptionist')) OR ("deposit_status_events"."source" = 'owner_edit' AND "deposit_status_events"."actor_user_id" IS NOT NULL AND "deposit_status_events"."actor_role" = 'owner'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_id_salon_id_uidx" ON "appointments" USING btree ("id","salon_id");--> statement-breakpoint
ALTER TABLE "deposit_status_events" ADD CONSTRAINT "deposit_status_events_appointment_salon_fk" FOREIGN KEY ("appointment_id","salon_id") REFERENCES "public"."appointments"("id","salon_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deposit_status_events_appointment_created_idx" ON "deposit_status_events" USING btree ("appointment_id","created_at");--> statement-breakpoint
CREATE INDEX "deposit_status_events_salon_created_idx" ON "deposit_status_events" USING btree ("salon_id","created_at");--> statement-breakpoint
-- Dopisane ręcznie: RLS salonu (kształt jak 0010, z nullif) i zapis tylko do dopisywania dla roli aplikacji.
-- Drizzle nie wyraża polityk ani uprawnień. Strażnik RLS czyta tę migrację z listy RLS_EXTRA_MIGRATION_FILES.
ALTER TABLE deposit_status_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON deposit_status_events
  USING (salon_id = nullif(current_setting('app.current_salon_id', true), '')::uuid)
  WITH CHECK (salon_id = nullif(current_setting('app.current_salon_id', true), '')::uuid);
--> statement-breakpoint
-- REVOKE ALL odbiera też uprawnienia nadane przez uprawnienia domyślne schematu (0005)
-- i uprawnienia kolumnowe; potem tylko odczyt i dopisywanie.
REVOKE ALL ON TABLE deposit_status_events FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE deposit_status_events FROM myhelper_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE deposit_status_events TO myhelper_app;
--> statement-breakpoint
-- Kontrola w tej samej transakcji: SELECT i INSERT są, zmiany i usuwania nie ma, RLS włączone.
DO $$
DECLARE
  bad text;
BEGIN
  IF NOT has_table_privilege('myhelper_app', 'public.deposit_status_events', 'SELECT')
     OR NOT has_table_privilege('myhelper_app', 'public.deposit_status_events', 'INSERT') THEN
    RAISE EXCEPTION 'myhelper_app bez SELECT albo INSERT na deposit_status_events';
  END IF;
  SELECT string_agg(p, ', ') INTO bad
  FROM unnest(ARRAY['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
  WHERE has_table_privilege('myhelper_app', 'public.deposit_status_events', p)
     OR (p IN ('UPDATE','REFERENCES') AND has_any_column_privilege('myhelper_app', 'public.deposit_status_events', p));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'myhelper_app ma zakazane uprawnienia do deposit_status_events: %', bad;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'myhelper_app_login') THEN
    SELECT string_agg(p, ', ') INTO bad
    FROM unnest(ARRAY['UPDATE','DELETE','TRUNCATE']) AS p
    WHERE has_table_privilege('myhelper_app_login', 'public.deposit_status_events', p);
    IF bad IS NOT NULL THEN
      RAISE EXCEPTION 'myhelper_app_login ma zakazane uprawnienia do deposit_status_events: %', bad;
    END IF;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.deposit_status_events'::regclass) THEN
    RAISE EXCEPTION 'deposit_status_events bez RLS';
  END IF;
END
$$;

-- ROLLBACK: ręcznie, tylko baza lokalna/test — DROP TABLE deposit_status_events; DROP INDEX appointments_id_salon_id_uidx; (wpis 0014 w drizzle.__drizzle_migrations zostaje).
