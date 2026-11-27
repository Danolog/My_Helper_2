-- Blokada rezerwacji online klienta i CHECK statusu wizyty.
--
-- Ze schematu (src/lib/schema.ts, snapshot 0019):
--   clients.blocked_at  — timestamptz, NULL = rezerwacja online dozwolona,
--   clients.blocked_by  — text: 'auto' (próg nieobecności) albo id konta
--                          właściciela; bez FK, ślad ma przetrwać usunięcie konta,
--   clients.block_note  — text, notatka właściciela (najwyżej 500 znaków),
--   clients_block_pair  — CHECK: czas i autor blokady występują wyłącznie razem,
--   clients_block_note_requires_block — CHECK: notatka tylko przy blokadzie,
--   clients_block_note_length — CHECK: notatka do 500 znaków,
--   clients_salon_blocked_idx — indeks częściowy (salon_id) WHERE blocked_at IS NOT NULL:
--          sprawdzenie przy rezerwacji online czyta tylko zablokowane karty salonu,
--   appointments_status_valid — CHECK: status wizyty z zamkniętej listy
--          'scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'.
--          Licznik nieobecności decyduje o blokadzie, więc liczy wartość
--          pilnowaną przez bazę, a nie tylko przez kod.
--
-- Dopisane ręcznie:
-- 1. SET LOCAL lock_timeout: ADD COLUMN i ADD CONSTRAINT biorą ACCESS EXCLUSIVE na
--    clients i appointments. Jeśli blokady nie da się wziąć w 5 s, migracja kończy
--    się błędem 55P03 i nic się nie zmienia. Ponowienie = ponowne uruchomienie migracji.
-- 2. CHECK statusu najpierw jako NOT VALID (bez skanu przy dodaniu), potem
--    VALIDATE CONSTRAINT (skan istniejących wierszy). Migrator stosuje plik w jednej
--    transakcji, więc ACCESS EXCLUSIVE z ADD CONSTRAINT trwa do końca migracji;
--    rozbicie daje czytelny błąd walidacji (23514 na appointments_status_valid)
--    zamiast błędu dodania. Wiersz z inną wartością przerywa migrację i nic się
--    nie zmienia. Zapytanie kontrolne (tylko odczyt) przed migracją:
--      SELECT status, count(*) FROM appointments
--      WHERE status NOT IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')
--      GROUP BY status;
--
-- RLS: bez zmian. Nowe kolumny są w tabeli clients, która ma już politykę
-- tenant_isolation (0005, 0010); uprawnienia roli aplikacji obejmują całą tabelę.
--
-- ROLLBACK: ręcznie:
--   ALTER TABLE appointments DROP CONSTRAINT appointments_status_valid;
--   DROP INDEX clients_salon_blocked_idx;
--   ALTER TABLE clients DROP CONSTRAINT clients_block_note_length;
--   ALTER TABLE clients DROP CONSTRAINT clients_block_note_requires_block;
--   ALTER TABLE clients DROP CONSTRAINT clients_block_pair;
--   ALTER TABLE clients DROP COLUMN block_note, DROP COLUMN blocked_by, DROP COLUMN blocked_at;
--   (wpis 0019 w drizzle.__drizzle_migrations zostaje; ponowne włączenie = nowa migracja).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "blocked_by" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "block_note" text;--> statement-breakpoint
CREATE INDEX "clients_salon_blocked_idx" ON "clients" USING btree ("salon_id") WHERE "clients"."blocked_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_block_pair" CHECK (("clients"."blocked_at" IS NULL) = ("clients"."blocked_by" IS NULL));--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_block_note_requires_block" CHECK ("clients"."block_note" IS NULL OR "clients"."blocked_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_block_note_length" CHECK ("clients"."block_note" IS NULL OR length("clients"."block_note") <= 500);--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_status_valid" CHECK ("appointments"."status" IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')) NOT VALID;--> statement-breakpoint
ALTER TABLE "appointments" VALIDATE CONSTRAINT "appointments_status_valid";
