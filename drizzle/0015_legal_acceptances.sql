CREATE TABLE "legal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"document" text NOT NULL,
	"version" text NOT NULL,
	"source" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_acceptances_document_valid" CHECK ("legal_acceptances"."document" IN ('terms', 'dpa')),
	CONSTRAINT "legal_acceptances_source_valid" CHECK ("legal_acceptances"."source" IN ('registration', 'create_salon', 'email_pilot')),
	CONSTRAINT "legal_acceptances_version_nonempty" CHECK (length("legal_acceptances"."version") BETWEEN 1 AND 64),
	CONSTRAINT "legal_acceptances_user_nonempty" CHECK (length("legal_acceptances"."user_id") > 0)
);
--> statement-breakpoint
CREATE INDEX "legal_acceptances_salon_accepted_idx" ON "legal_acceptances" USING btree ("salon_id","accepted_at");--> statement-breakpoint
CREATE INDEX "legal_acceptances_user_accepted_idx" ON "legal_acceptances" USING btree ("user_id","accepted_at");--> statement-breakpoint
-- Dopisane ręcznie: RLS salonu (kształt jak 0010 i 0014, z nullif) i zapis tylko do dopisywania dla roli aplikacji.
-- Drizzle nie wyraża polityk ani uprawnień. Strażnik RLS czyta tę migrację z listy RLS_EXTRA_MIGRATION_FILES.
ALTER TABLE legal_acceptances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON legal_acceptances
  USING (salon_id = nullif(current_setting('app.current_salon_id', true), '')::uuid)
  WITH CHECK (salon_id = nullif(current_setting('app.current_salon_id', true), '')::uuid);
--> statement-breakpoint
-- REVOKE ALL odbiera też uprawnienia nadane przez uprawnienia domyślne schematu (0005)
-- i uprawnienia kolumnowe; potem tylko odczyt i dopisywanie.
REVOKE ALL ON TABLE legal_acceptances FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE legal_acceptances FROM myhelper_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE legal_acceptances TO myhelper_app;
--> statement-breakpoint
-- Kontrola w tej samej transakcji: SELECT i INSERT są, zmiany i usuwania nie ma, RLS włączone.
DO $$
DECLARE
  bad text;
BEGIN
  IF NOT has_table_privilege('myhelper_app', 'public.legal_acceptances', 'SELECT')
     OR NOT has_table_privilege('myhelper_app', 'public.legal_acceptances', 'INSERT') THEN
    RAISE EXCEPTION 'myhelper_app bez SELECT albo INSERT na legal_acceptances';
  END IF;
  SELECT string_agg(p, ', ') INTO bad
  FROM unnest(ARRAY['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
  WHERE has_table_privilege('myhelper_app', 'public.legal_acceptances', p)
     OR (p IN ('UPDATE','REFERENCES') AND has_any_column_privilege('myhelper_app', 'public.legal_acceptances', p));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'myhelper_app ma zakazane uprawnienia do legal_acceptances: %', bad;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'myhelper_app_login') THEN
    SELECT string_agg(p, ', ') INTO bad
    FROM unnest(ARRAY['UPDATE','DELETE','TRUNCATE']) AS p
    WHERE has_table_privilege('myhelper_app_login', 'public.legal_acceptances', p);
    IF bad IS NOT NULL THEN
      RAISE EXCEPTION 'myhelper_app_login ma zakazane uprawnienia do legal_acceptances: %', bad;
    END IF;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.legal_acceptances'::regclass) THEN
    RAISE EXCEPTION 'legal_acceptances bez RLS';
  END IF;
END
$$;

-- ROLLBACK: ręcznie, tylko baza lokalna/test — DROP TABLE legal_acceptances; (wpis 0015 w drizzle.__drizzle_migrations zostaje).
