-- Jawne uprawnienia roli aplikacji do rejestru adresów salonów (salon_slug_history).
--
-- Bez zmian schematu (snapshot 0020 = snapshot 0019).
--
-- Po co: 0018 nie nadaje uprawnień do salon_slug_history wprost, tylko polega na
-- uprawnieniach domyślnych schematu z 0005 (ALTER DEFAULT PRIVILEGES … TO myhelper_app).
-- Te działają tylko dla tabel tworzonych przez rolę, która je ustawiła. Gdy migrację
-- wykonuje inna rola albo uprawnienia domyślne zostały zmienione, tabela powstaje bez
-- dostępu roli aplikacji i aplikacja dostaje 42501 przy odczycie i zapisie adresu.
-- Tabele z 0014 i 0015 mają uprawnienia nadane wprost; ta migracja robi to samo dla
-- salon_slug_history, z tym samym zestawem co w kontroli 0018: SELECT, INSERT,
-- UPDATE, DELETE (zajęcie adresu, porzucenie z retired_at, odzyskanie własnego adresu).
-- Gdy kontrola uprawnień w 0018 przerwie migrację, naprawą jest nadanie uprawnień
-- (jak niżej), a nie usunięcie ani obejście kontroli.
--
-- Rola: myhelper_app (NOLOGIN, tworzona w 0005; 0014 i 0015 też odwołują się do niej
-- bez warunku). GRANT tylko dodaje uprawnienia: na bazie, gdzie tabela je już ma, nic się nie zmienia.
-- RLS bez zmian: polityka tenant_isolation z 0018 zostaje.
--
-- Dopisane ręcznie:
-- 1. SET LOCAL lock_timeout (reguła dla migracji od 0015). Jeśli blokady na
--    salon_slug_history nie da się wziąć w 5 s, migracja kończy się błędem 55P03
--    i nic się nie zmienia. Ponowienie = ponowne uruchomienie migracji.
-- 2. Kontrola w tej samej transakcji: rola aplikacji ma SELECT, INSERT, UPDATE, DELETE.
--
-- ROLLBACK: ręcznie, tylko gdy uprawnienia mają wrócić do stanu z uprawnień domyślnych:
--   REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE salon_slug_history FROM myhelper_app;
--   (po REVOKE aplikacja traci dostęp do rejestru adresów; wpis 0020 w
--   drizzle.__drizzle_migrations zostaje; ponowne włączenie = nowa migracja).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE salon_slug_history TO myhelper_app;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT has_table_privilege('myhelper_app', 'public.salon_slug_history', 'SELECT')
     OR NOT has_table_privilege('myhelper_app', 'public.salon_slug_history', 'INSERT')
     OR NOT has_table_privilege('myhelper_app', 'public.salon_slug_history', 'UPDATE')
     OR NOT has_table_privilege('myhelper_app', 'public.salon_slug_history', 'DELETE') THEN
    RAISE EXCEPTION 'myhelper_app bez SELECT, INSERT, UPDATE albo DELETE na salon_slug_history';
  END IF;
END
$$;
