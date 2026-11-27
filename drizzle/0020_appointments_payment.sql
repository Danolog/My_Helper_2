-- Płatność zapisana przy zakończeniu wizyty (gotówka, karta, BLIK) bez terminala.
--
-- Ze schematu (src/lib/schema.ts, snapshot 0020):
--   appointments.paid_amount    — numeric(10,2), kwota faktycznie zapłacona w złotych;
--                                 NULL = wizyta bez zapisu płatności (sprzed tej zmiany),
--   appointments.payment_method — text: 'cash', 'card' albo 'blik'; NULL jak wyżej,
--   appointments_payment_method_valid — CHECK: metoda z zamkniętej listy,
--   appointments_payment_pair         — CHECK: kwota i metoda występują wyłącznie razem,
--   appointments_paid_amount_nonneg   — CHECK: kwota >= 0 (0 = wizyta gratis).
--
-- Dopisane ręcznie:
-- 1. SET LOCAL lock_timeout: ADD COLUMN i ADD CONSTRAINT biorą ACCESS EXCLUSIVE na
--    appointments. Jeśli blokady nie da się wziąć w 5 s, migracja kończy się
--    błędem 55P03 i nic się nie zmienia. Ponowienie = ponowne uruchomienie migracji.
-- 2. Każdy CHECK najpierw jako NOT VALID (bez skanu przy dodaniu), potem
--    VALIDATE CONSTRAINT (skan istniejących wierszy). Migrator stosuje plik w jednej
--    transakcji, więc ACCESS EXCLUSIVE z ADD CONSTRAINT trwa do końca migracji;
--    rozbicie daje czytelny błąd walidacji (23514 z nazwą ograniczenia) zamiast
--    błędu dodania. Obie kolumny są nowe i puste we wszystkich istniejących
--    wierszach, więc każdy CHECK przechodzi; zapytanie kontrolne przed migracją
--    nie jest potrzebne.
--
-- RLS: bez zmian. Nowe kolumny są w tabeli appointments, która ma już politykę
-- tenant_isolation (0005, 0010); uprawnienia roli aplikacji obejmują całą tabelę.
--
-- ROLLBACK: ręcznie:
--   ALTER TABLE appointments DROP CONSTRAINT appointments_paid_amount_nonneg;
--   ALTER TABLE appointments DROP CONSTRAINT appointments_payment_pair;
--   ALTER TABLE appointments DROP CONSTRAINT appointments_payment_method_valid;
--   ALTER TABLE appointments DROP COLUMN payment_method, DROP COLUMN paid_amount;
--   (wpis 0020 w drizzle.__drizzle_migrations zostaje; ponowne włączenie = nowa migracja).
--   Usunięcie kolumn kasuje zapisane kwoty i metody — przed wycofaniem zrzut:
--     SELECT id, salon_id, paid_amount, payment_method FROM appointments
--     WHERE paid_amount IS NOT NULL;
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "paid_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_payment_method_valid" CHECK ("appointments"."payment_method" IN ('cash', 'card', 'blik')) NOT VALID;--> statement-breakpoint
ALTER TABLE "appointments" VALIDATE CONSTRAINT "appointments_payment_method_valid";--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_payment_pair" CHECK (("appointments"."paid_amount" IS NULL) = ("appointments"."payment_method" IS NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "appointments" VALIDATE CONSTRAINT "appointments_payment_pair";--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_paid_amount_nonneg" CHECK ("appointments"."paid_amount" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "appointments" VALIDATE CONSTRAINT "appointments_paid_amount_nonneg";
