-- Wycofanie przełączenia: bramka kompletności i jedyne zatwierdzenie transakcji
-- otwartej w reverse-pre.sql. Ostatni plik sesji psql z
-- infra/db/cutover/copy-cloudsql-to-neon.sh, po strumieniu pg_dump -Fp.
--
-- Strumień ucięty na granicy wiersza albo tabeli psql zatwierdziłby przy końcu
-- wejścia. Dlatego przed zatwierdzeniem: count(*) każdej tabeli public i
-- last_value każdej sekwencji public (bez sekwencji trzech tabel wykluczonych)
-- muszą być równe liczbom źródła, a zbiory nazw identyczne. Inaczej RAISE:
-- ON_ERROR_STOP przerywa psql, połączenie zamyka się bez zatwierdzenia.
-- Zrzut ustawia pusty search_path, więc wszystko jest kwalifikowane schematem.
-- Bez poleceń psql z ukośnikiem: po uciętym zrzucie (bez końcowego unrestrict)
-- sesja psql zostaje w trybie restrict, a ten plik nadal musi wykonać bramkę.
-- Strażnik: __tests__/lib/cutover-copy-reverse-config.test.ts.
DO $gate$
DECLARE
  want jsonb := pg_catalog.current_setting('cutover_reverse.expected')::jsonb;
  rel record;
  got bigint;
  n_tables bigint := 0;
  n_seqs bigint := 0;
BEGIN
  FOR rel IN
    SELECT c.relname::text AS name
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
  LOOP
    IF NOT ((want -> 'tables') ? rel.name) THEN
      RAISE EXCEPTION 'bramka kompletności: zbiór tabel różny od źródła';
    END IF;
    EXECUTE pg_catalog.format('SELECT pg_catalog.count(*) FROM public.%I', rel.name) INTO got;
    IF got IS DISTINCT FROM ((want -> 'tables') ->> rel.name)::bigint THEN
      RAISE EXCEPTION 'bramka kompletności: liczba wierszy różna od źródła';
    END IF;
    n_tables := n_tables + 1;
  END LOOP;
  IF n_tables IS DISTINCT FROM (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(want -> 'tables')) THEN
    RAISE EXCEPTION 'bramka kompletności: zbiór tabel różny od źródła';
  END IF;

  FOR rel IN
    SELECT s.relname::text AS name
      FROM pg_catalog.pg_class s JOIN pg_catalog.pg_namespace n ON n.oid = s.relnamespace
      WHERE n.nspname = 'public' AND s.relkind = 'S'
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dep JOIN pg_catalog.pg_class t ON t.oid = dep.refobjid
                          WHERE dep.classid = 'pg_catalog.pg_class'::pg_catalog.regclass AND dep.objid = s.oid
                            AND dep.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass AND dep.deptype IN ('a', 'i')
                            AND t.relnamespace = n.oid
                            AND t.relname IN ('auth_rate_limit', 'session', 'verification'))
  LOOP
    IF NOT ((want -> 'sequences') ? rel.name) THEN
      RAISE EXCEPTION 'bramka kompletności: zbiór sekwencji różny od źródła';
    END IF;
    EXECUTE pg_catalog.format('SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM public.%I', rel.name) INTO got;
    IF got IS DISTINCT FROM ((want -> 'sequences') ->> rel.name)::bigint THEN
      RAISE EXCEPTION 'bramka kompletności: last_value sekwencji różne od źródła';
    END IF;
    n_seqs := n_seqs + 1;
  END LOOP;
  IF n_seqs IS DISTINCT FROM (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(want -> 'sequences')) THEN
    RAISE EXCEPTION 'bramka kompletności: zbiór sekwencji różny od źródła';
  END IF;
END
$gate$;
COMMIT;
