-- Jedna opinia na wizytę, wymuszona przez bazę.
--
-- Indeks unikalny częściowy (WHERE appointment_id IS NOT NULL), bo FK
-- reviews.appointment_id ma ON DELETE SET NULL: po usunięciu wizyt wiele opinii
-- może mieć NULL i to jest poprawny stan. Wygenerowane ze schematu
-- (uniqueIndex(...).where() w src/lib/schema.ts, snapshot 0016).
-- Trasa POST /api/client/appointments/[id]/review zamienia naruszenie (23505) na 409.
--
-- Dopisane ręcznie przed indeksem:
-- 0. SET LOCAL lock_timeout: LOCK TABLE ... IN SHARE MODE czeka na koniec każdej
--    transakcji piszącej do reviews, a w kolejce za nim stają kolejne zapytania.
--    Jeśli blokady nie da się wziąć w 5 s, migracja kończy się błędem 55P03 i nic
--    się nie zmienia. Ponowienie = ponowne uruchomienie migracji. Obowiązuje do końca
--    transakcji migratora (reguła: __tests__/lint/migration-lock-timeout.test.ts).
-- 1. LOCK TABLE ... IN SHARE MODE: blokuje zapisy do reviews do końca transakcji
--    migracji (odczyty działają), więc między kontrolą a indeksem nie dojdzie
--    nowy duplikat. CREATE INDEX i tak bierze tę samą blokadę.
-- 2. Kontrola duplikatów: jeśli jakaś wizyta ma więcej niż jedną opinię,
--    migracja kończy się błędem z liczbą takich wizyt. Niczego nie kasujemy;
--    duplikaty rozstrzyga człowiek, potem migracja idzie ponownie.
--    Zapytanie kontrolne (tylko odczyt) do uruchomienia przed migracją:
--      SELECT appointment_id, count(*) FROM reviews
--      WHERE appointment_id IS NOT NULL
--      GROUP BY appointment_id HAVING count(*) > 1;
--
-- ROLLBACK: ręcznie — DROP INDEX "reviews_appointment_id_uq";
--   (wpis 0016 w drizzle.__drizzle_migrations zostaje; ponowne włączenie = nowa migracja).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
LOCK TABLE "reviews" IN SHARE MODE;--> statement-breakpoint
DO $$
DECLARE
  dup_appointments integer;
  dup_rows integer;
BEGIN
  SELECT count(*), coalesce(sum(n), 0) INTO dup_appointments, dup_rows
  FROM (
    SELECT count(*) AS n
    FROM reviews
    WHERE appointment_id IS NOT NULL
    GROUP BY appointment_id
    HAVING count(*) > 1
  ) d;
  IF dup_appointments > 0 THEN
    RAISE EXCEPTION 'reviews: % wizyt ma więcej niż jedną opinię (% wierszy). Migracja 0016 przerwana, nic nie zostało usunięte.', dup_appointments, dup_rows
      USING HINT = 'SELECT appointment_id, count(*) FROM reviews WHERE appointment_id IS NOT NULL GROUP BY appointment_id HAVING count(*) > 1; — rozstrzygnij duplikaty ręcznie i uruchom migrację ponownie.';
  END IF;
END
$$;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_appointment_id_uq" ON "reviews" USING btree ("appointment_id") WHERE "reviews"."appointment_id" is not null;
