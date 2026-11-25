-- Zgoda klienta na zapis informacji o zdrowiu (clients.allergies).
--
-- Kolumny i oba CHECK wygenerowane ze schematu (src/lib/schema.ts, snapshot 0017):
--   health_data_consent_at — kiedy personel zaznaczył zgodę (czas bazy, nadaje serwer),
--   health_data_consent_by — konto personelu z sesji (bez FK: dowód przeżywa usunięcie konta),
--   clients_allergies_require_consent — allergies tylko przy zapisanej zgodzie,
--   clients_health_consent_pair — czas i konto zgody występują wyłącznie razem.
-- Regułę egzekwują też trasy POST /api/clients i PUT /api/clients/[id] (400 przed zapisem).
--
-- Dopisane ręcznie:
-- 1. SET LOCAL lock_timeout: ADD COLUMN i ADD CONSTRAINT biorą ACCESS EXCLUSIVE na
--    clients (tabela z ruchem). Jeśli blokady nie da się wziąć w 5 s, migracja
--    kończy się błędem 55P03 i nic się nie zmienia, zamiast ustawiać w kolejce
--    wszystkie zapytania do clients za sobą. Ponowienie = ponowne uruchomienie migracji.
--    SET LOCAL obowiązuje do końca transakcji migratora (także kolejnych plików w tym przebiegu).
-- 2. UPDATE przed CHECK: nowe kolumny są puste, więc żaden istniejący wiersz nie ma
--    zgody. Wypełnione allergies zerujemy, bo inaczej baza przechowywałaby informację
--    o zdrowiu bez zgody (a CHECK by się nie dodał). Na produkcji są tylko dane testowe.
--    Zapytanie kontrolne (tylko odczyt) przed migracją:
--      SELECT count(*) FROM clients WHERE allergies IS NOT NULL;
--
-- ROLLBACK: ręcznie, częściowy — wyzerowanych allergies nie da się odtworzyć:
--   ALTER TABLE clients DROP CONSTRAINT clients_health_consent_pair;
--   ALTER TABLE clients DROP CONSTRAINT clients_allergies_require_consent;
--   ALTER TABLE clients DROP COLUMN health_data_consent_by;
--   ALTER TABLE clients DROP COLUMN health_data_consent_at;
--   (wpis 0017 w drizzle.__drizzle_migrations zostaje; ponowne włączenie = nowa migracja).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "health_data_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "health_data_consent_by" text;--> statement-breakpoint
UPDATE "clients" SET "allergies" = NULL WHERE "allergies" IS NOT NULL AND "health_data_consent_at" IS NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_allergies_require_consent" CHECK ("clients"."allergies" IS NULL OR "clients"."health_data_consent_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_health_consent_pair" CHECK (("clients"."health_data_consent_at" IS NULL) = ("clients"."health_data_consent_by" IS NULL));
