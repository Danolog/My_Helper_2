-- #193: brak kontekstu salonu daje zawsze ten sam wynik.
-- Po transakcji z set_config(..., true) zmienna na tym połączeniu wraca do '' (nie do
-- NULL), a ''::uuid rzuca 22P02. Wynik zależał więc od historii połączenia z puli.
-- Po zmianie nullif(..., '')::uuid = NULL: USING odfiltrowuje wszystko (0 wierszy),
-- WITH CHECK odrzuca zapis (42501), na świeżym i na używanym połączeniu.
--
-- Każda polityka tenant_* odtworzona przez DROP POLICY + CREATE POLICY w transakcji
-- migracji. Treść poza rzutem kontekstu bez zmian względem 0005/0006: migawka
-- scripts/rls-policies.snapshot.json przed i po różni się wyłącznie nullif.
-- DROP POLICY bez IF EXISTS: brak polityki = błąd migracji, nie ciche założenie nowej.
-- Produkcja: poza tym PR.

DO $$
DECLARE
  t text;
  direct_tables text[] := ARRAY[
    'clients','employees','service_categories','services','appointments',
    'gallery_photos','albums','reviews','notifications','waiting_list',
    'product_categories','products','promotions','promo_codes','loyalty_points',
    'invoices','newsletters','marketing_consents','favorite_salons',
    'salon_subscriptions','subscription_payments','deposit_payments',
    'fiscal_receipts','scheduled_posts','ai_conversations','ai_generated_media'
  ];
BEGIN
  FOREACH t IN ARRAY direct_tables LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (salon_id = nullif(current_setting(''app.current_salon_id'', true), '''')::uuid) '
      || 'WITH CHECK (salon_id = nullif(current_setting(''app.current_salon_id'', true), '''')::uuid);',
      t
    );
  END LOOP;
END
$$;
--> statement-breakpoint

DO $$
DECLARE
  indirect_map text[][] := ARRAY[
    ['time_blocks','employees','employee_id','id'],
    ['work_schedules','employees','employee_id','id'],
    ['employee_services','employees','employee_id','id'],
    ['employee_service_prices','employees','employee_id','id'],
    ['employee_commissions','employees','employee_id','id'],
    ['service_variants','services','service_id','id'],
    ['service_products','services','service_id','id'],
    ['appointment_materials','appointments','appointment_id','id'],
    ['treatment_history','appointments','appointment_id','id'],
    ['product_usage','products','product_id','id'],
    ['photo_albums','gallery_photos','photo_id','id'],
    ['loyalty_transactions','loyalty_points','loyalty_id','id']
  ];
  i int;
  child text; parent text; fk text; pk text;
BEGIN
  FOR i IN 1 .. array_length(indirect_map, 1) LOOP
    child  := indirect_map[i][1];
    parent := indirect_map[i][2];
    fk     := indirect_map[i][3];
    pk     := indirect_map[i][4];
    EXECUTE format('DROP POLICY tenant_isolation ON %I;', child);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (EXISTS ('
      || 'SELECT 1 FROM %I p WHERE p.%I = %I.%I '
      || 'AND p.salon_id = nullif(current_setting(''app.current_salon_id'', true), '''')::uuid)) '
      || 'WITH CHECK (EXISTS ('
      || 'SELECT 1 FROM %I p WHERE p.%I = %I.%I '
      || 'AND p.salon_id = nullif(current_setting(''app.current_salon_id'', true), '''')::uuid));',
      child, parent, pk, child, fk,
      parent, pk, child, fk
    );
  END LOOP;
END
$$;
--> statement-breakpoint

DROP POLICY tenant_self ON salons;
--> statement-breakpoint
CREATE POLICY tenant_self ON salons
  USING (id = nullif(current_setting('app.current_salon_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.current_salon_id', true), '')::uuid);
--> statement-breakpoint

-- Kontrola w tej samej transakcji: żadna polityka w public nie rzutuje kontekstu bez nullif.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      replace(coalesce(qual, ''), 'NULLIF(current_setting(''app.current_salon_id''', '')
        LIKE '%current_setting(''app.current_salon_id''%'
      OR replace(coalesce(with_check, ''), 'NULLIF(current_setting(''app.current_salon_id''', '')
        LIKE '%current_setting(''app.current_salon_id''%'
    );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'polityki bez nullif na app.current_salon_id: %', bad;
  END IF;
END
$$;

-- ROLLBACK: ręcznie, tylko baza lokalna/test — odtworzyć polityki z 0005 i 0006 bez
-- nullif: te same trzy bloki z `current_setting('app.current_salon_id', true)::uuid`
-- zamiast `nullif(current_setting('app.current_salon_id', true), '')::uuid`.
-- Wycofanie nie usuwa wpisu 0010 z drizzle.__drizzle_migrations.
