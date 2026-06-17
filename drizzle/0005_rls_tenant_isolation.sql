-- ADR-001 sekcja 3/5.1 — RLS (Row-Level Security) jako druga tama izolacji salonów.
-- WYŁĄCZNIE baza lokalna/test. Produkcja Neon = osobna czerwona linia (sign-off Darka).
--
-- Wzorzec referencyjny (pamięć repo): ENABLE (nie FORCE); rola app bez BYPASSRLS;
-- izolacja przez rolę myhelper_app + SET LOCAL ROLE + SET LOCAL app.current_salon_id
-- w runtime (wrapper forSalon). Owner/migrator omija polityki (ENABLE-not-FORCE) —
-- dzięki temu seed/migracje/ścieżki systemowe (webhooki, crony) działają bez kontekstu.

-- 1. Dedykowana rola aplikacyjna BEZ BYPASSRLS. NOLOGIN: wchodzi się w nią przez
--    SET LOCAL ROLE z poziomu połączenia ownera (pool aplikacji), nie osobnym loginem.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'myhelper_app') THEN
    CREATE ROLE myhelper_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint

-- 2. Rola app dostaje DML na wszystkich tabelach + użycie sekwencji; NIE dostaje
--    BYPASSRLS ani uprawnień DDL. current_user (owner/dev_user) nadaje GRANT.
GRANT USAGE ON SCHEMA public TO myhelper_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO myhelper_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO myhelper_app;
--> statement-breakpoint
-- Tabele/sekwencje tworzone w przyszłości też (na bazie lokalnej; na prod osobno).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO myhelper_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO myhelper_app;
--> statement-breakpoint

-- 3. ENABLE RLS + polityka tenant_isolation na 25 tabelach z bezpośrednim salon_id.
--    USING chroni odczyt/update/delete (widać tylko swoje); WITH CHECK chroni
--    insert/update (nie wstawisz wiersza do cudzego salonu). 'true' w current_setting
--    = nie rzucaj, gdy zmienna nieustawiona (zwróci NULL => 0 wierszy, nie błąd).
DO $$
DECLARE
  t text;
  direct_tables text[] := ARRAY[
    'clients','employees','service_categories','services','appointments',
    'gallery_photos','albums','reviews','notifications','waiting_list',
    'product_categories','products','promotions','promo_codes','loyalty_points',
    'invoices','newsletters','marketing_consents','favorite_salons',
    'salon_subscriptions','subscription_payments','deposit_payments',
    'fiscal_receipts','scheduled_posts','ai_conversations'
  ];
BEGIN
  FOREACH t IN ARRAY direct_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (salon_id = current_setting(''app.current_salon_id'', true)::uuid) '
      || 'WITH CHECK (salon_id = current_setting(''app.current_salon_id'', true)::uuid);',
      t
    );
  END LOOP;
END
$$;
--> statement-breakpoint

-- 4. Tabele salon-scoped POŚREDNIO (FK do encji nadrzędnej, bez własnego salon_id).
--    Polityka EXISTS na rodzicu (ADR 3.3). Mapowania zweryfikowane wobec realnego
--    schematu (kolumny FK rożnią się od draftu ADR — patrz raport):
--      time_blocks/work_schedules             -> employees.salon_id (employee_id)
--      employee_services/_service_prices      -> employees.salon_id (employee_id)
--      employee_commissions                   -> employees.salon_id (employee_id)
--      service_variants/service_products      -> services.salon_id  (service_id)
--      appointment_materials/treatment_history-> appointments.salon_id (appointment_id)
--      product_usage                          -> products.salon_id (product_id)
--      photo_albums                           -> gallery_photos.salon_id (photo_id)
--      loyalty_transactions                   -> loyalty_points.salon_id (loyalty_id)
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
    -- Pomiń, jeśli tabela nie istnieje na tej bazie (model bywa węższy niż ADR).
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=child) THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', child);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', child);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (EXISTS ('
      || 'SELECT 1 FROM %I p WHERE p.%I = %I.%I '
      || 'AND p.salon_id = current_setting(''app.current_salon_id'', true)::uuid)) '
      || 'WITH CHECK (EXISTS ('
      || 'SELECT 1 FROM %I p WHERE p.%I = %I.%I '
      || 'AND p.salon_id = current_setting(''app.current_salon_id'', true)::uuid));',
      child, parent, pk, child, fk,
      parent, pk, child, fk
    );
  END LOOP;
END
$$;
--> statement-breakpoint

-- 5. Korzeń najemcy: salons. To JEST tabela najemcy — izolacja po jej id przez
--    kontekst app.current_salon_id (właściciel widzi swój salon po jego id).
--    Publiczny katalog (salons/[id] przez unstable_cache) czyta pod rolą owner —
--    omija RLS (ENABLE-not-FORCE).
ALTER TABLE salons ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_self ON salons;
--> statement-breakpoint
CREATE POLICY tenant_self ON salons
  USING (id = current_setting('app.current_salon_id', true)::uuid)
  WITH CHECK (id = current_setting('app.current_salon_id', true)::uuid);
