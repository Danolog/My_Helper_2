-- #171: zapytanie kontrolne PRZED migracją 0009 (drizzle/0009_appointments_no_overlap.sql).
-- Tylko odczyt: transakcja READ ONLY (baza odrzuci każdy zapis), same SELECT, na końcu ROLLBACK.
-- Leży poza drizzle/, więc drizzle-kit migrate go nie podchwyci.
--
-- Każda z trzech liczb musi wynosić 0, inaczej ADD CONSTRAINT w 0009 się nie powiedzie
-- (cała migracja zostanie wycofana). Przy liczbie > 0 nie migrować — najpierw decyzja,
-- co zrobić z wierszami (lista: drugie zapytanie).
--
-- Lokalnie: sesja główna. Neon/produkcja: dopiero za zgodą Darka.
--   psql "<POSTGRES_URL>" -v ON_ERROR_STOP=1 -f scripts/sql/0009-precheck.sql

BEGIN READ ONLY;

-- 1. Trzy liczniki (jeden wiersz). Warunki = zaprzeczenie reguł migracji 0009:
--    CHECK end_time > start_time oraz EXCLUDE (ten sam pracownik, [start, end), bez cancelled).
SELECT
  (SELECT count(*) FROM appointments WHERE end_time <= start_time) AS appointments_check_violations,
  (SELECT count(*) FROM time_blocks WHERE end_time <= start_time) AS time_blocks_check_violations,
  (SELECT count(*)
     FROM appointments a
     JOIN appointments b
       ON a.employee_id = b.employee_id
      AND a.id < b.id
      AND a.status <> 'cancelled'
      AND b.status <> 'cancelled'
      AND a.start_time < b.end_time
      AND a.end_time > b.start_time) AS overlapping_active_pairs;

-- 2. Szczegóły naruszeń (puste, gdy wszystkie liczniki = 0).
SELECT 'appointments_check_violation' AS violation, id::text AS a_id, NULL::text AS b_id,
       employee_id::text, start_time, end_time, status
  FROM appointments WHERE end_time <= start_time
UNION ALL
SELECT 'time_blocks_check_violation', id::text, NULL, employee_id::text, start_time, end_time, block_type
  FROM time_blocks WHERE end_time <= start_time
UNION ALL
SELECT 'overlapping_active_pair', a.id::text, b.id::text, a.employee_id::text, a.start_time, a.end_time, a.status
  FROM appointments a
  JOIN appointments b
    ON a.employee_id = b.employee_id
   AND a.id < b.id
   AND a.status <> 'cancelled'
   AND b.status <> 'cancelled'
   AND a.start_time < b.end_time
   AND a.end_time > b.start_time
 ORDER BY 1, 4, 5;

ROLLBACK;
