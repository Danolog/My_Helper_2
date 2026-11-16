-- #171: zapytanie kontrolne PRZED migracją 0009 (drizzle/0009_appointments_no_overlap.sql).
-- Tylko odczyt. Nie jest migracją — drizzle-kit migrate czyta wyłącznie pliki z
-- drizzle/meta/_journal.json, ten katalog pomija.
--
-- Każda liczba musi wynosić 0, inaczej ADD CONSTRAINT w 0009 się nie powiedzie
-- (cała migracja zostanie wycofana). Przy liczbie > 0 nie migrować — najpierw
-- decyzja, co zrobić z wierszami (lista: zapytania szczegółowe na dole).
--
-- Lokalnie: sesja główna. Neon/produkcja: dopiero za zgodą Darka.
--   psql -h localhost -U dev_user -d pos_dev -f drizzle/checks/0009_appointments_no_overlap_preflight.sql

-- 1. Podsumowanie (jeden wiersz).
SELECT
  (SELECT count(*) FROM appointments) AS appointments_total,
  (SELECT count(*) FROM appointments WHERE end_time <= start_time) AS appointments_end_not_after_start,
  (SELECT count(*) FROM time_blocks) AS time_blocks_total,
  (SELECT count(*) FROM time_blocks WHERE end_time <= start_time) AS time_blocks_end_not_after_start,
  (SELECT count(*)
     FROM appointments a
     JOIN appointments b
       ON a.employee_id = b.employee_id
      AND a.id < b.id
      AND a.status <> 'cancelled'
      AND b.status <> 'cancelled'
      AND a.start_time < b.end_time
      AND a.end_time > b.start_time) AS overlapping_active_pairs;

-- 2. Szczegóły naruszeń (puste, gdy wszystko 0).
SELECT 'appointments_end_not_after_start' AS violation, id::text AS a_id, NULL::text AS b_id,
       employee_id::text, start_time, end_time, status
  FROM appointments WHERE end_time <= start_time
UNION ALL
SELECT 'time_blocks_end_not_after_start', id::text, NULL, employee_id::text, start_time, end_time, block_type
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
