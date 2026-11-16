-- #193: rola aplikacji bez dostępu do tabel sesji, kont i weryfikacji.
-- Adapter auth działa na puli systemowej (src/lib/server/system/auth-adapter.ts), nie na
-- roli aplikacji; transakcje forSalon (SET LOCAL ROLE myhelper_app) tych tabel nie czytają.
-- Tabela "user" bez zmian (lista kontrolna P6).
-- REVOKE ALL na tabeli odbiera też uprawnienia kolumnowe. FROM PUBLIC: na wypadek
-- uprawnień nadanych wszystkim (gdy nic nie ma, polecenie jest bez skutku).
-- subscription_plans: globalny katalog planów bez kolumny salonu; rola aplikacji zachowuje
-- wyłącznie SELECT (zapisy do tej tabeli idą poza rolą aplikacji).
-- Produkcja: poza tym PR.

REVOKE ALL ON TABLE session, account, verification FROM myhelper_app;
--> statement-breakpoint
REVOKE ALL ON TABLE session, account, verification FROM PUBLIC;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE subscription_plans FROM myhelper_app;
--> statement-breakpoint

-- Kontrola w tej samej transakcji: żadnego uprawnienia tabelowego ani kolumnowego roli aplikacji.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(t || ' ' || p, ', ') INTO bad
  FROM unnest(ARRAY['session','account','verification']) AS t
  CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
  WHERE has_table_privilege('myhelper_app', 'public.' || t, p)
     OR (p IN ('SELECT','INSERT','UPDATE','REFERENCES') AND has_any_column_privilege('myhelper_app', 'public.' || t, p));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'myhelper_app nadal ma uprawnienia do tabel auth: %', bad;
  END IF;
  -- subscription_plans: SELECT zostaje, żadnego innego uprawnienia tabelowego ani kolumnowego.
  SELECT string_agg(p, ', ') INTO bad
  FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
  WHERE has_table_privilege('myhelper_app', 'public.subscription_plans', p)
     OR (p IN ('INSERT','UPDATE','REFERENCES') AND has_any_column_privilege('myhelper_app', 'public.subscription_plans', p));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'myhelper_app nadal ma uprawnienia zapisu do subscription_plans: %', bad;
  END IF;
  IF NOT has_table_privilege('myhelper_app', 'public.subscription_plans', 'SELECT') THEN
    RAISE EXCEPTION 'myhelper_app bez SELECT na subscription_plans';
  END IF;
END
$$;

-- ROLLBACK: ręcznie, tylko baza lokalna/test —
--   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session, account, verification TO myhelper_app;
--   GRANT INSERT, UPDATE, DELETE ON TABLE subscription_plans TO myhelper_app;
-- (stan z 0005). Wycofanie nie usuwa wpisu 0011 z drizzle.__drizzle_migrations.
