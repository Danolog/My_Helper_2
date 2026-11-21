-- Wycofanie przełączenia: początek jedynej transakcji zapisu w bazie celu.
-- Wczytuje go wyłącznie infra/db/cutover/copy-cloudsql-to-neon.sh jako pierwszy
-- plik jednej sesji psql: -f reverse-pre.sql -f - (strumień pg_dump -Fp)
-- -f reverse-post.sql. Zmienna psql :expected = liczby źródła (JSON: nazwy
-- tabel i sekwencji z liczbami, bez danych).
--
-- READ WRITE nadpisuje default_transaction_read_only zamrożonej bazy tylko dla
-- tej transakcji; inne sesje zostają tylko do odczytu przez cały import.
-- Czyszczenie: jedna instrukcja na wszystkie tabele public (także session,
-- verification, auth_rate_limit — inaczej klucz obcy session → user blokuje
-- czyszczenie user). Bez CASCADE i bez zerowania sekwencji: klucz obcy spoza
-- public = błąd i brak importu. lock_timeout obejmuje blokadę wszystkich tabel.
-- Ten plik nie zatwierdza; zatwierdza wyłącznie ostatnia linia reverse-post.sql.
-- Strażnik: __tests__/lib/cutover-copy-reverse-config.test.ts.
BEGIN READ WRITE;
SET LOCAL lock_timeout = '10s';
SET LOCAL row_security = off;
SELECT FROM pg_catalog.set_config('cutover_reverse.expected', :'expected', true);
SELECT 'TRUNCATE ' || pg_catalog.string_agg(pg_catalog.format('public.%I', c.relname), ', ' ORDER BY c.relname COLLATE "C") || ' RESTRICT'
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition \gexec
