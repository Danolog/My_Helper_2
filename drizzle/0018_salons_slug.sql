-- Krótki adres salonu `/s/<slug>`.
--
-- Ze schematu (src/lib/schema.ts, snapshot 0018):
--   slug — text, NULL dozwolony (wiersze wstawiane poza aplikacją; każda ścieżka
--          zakładania salonu w kodzie nadaje slug),
--   salons_slug_uq — indeks unikalny (NULL-e się nie zderzają),
--   salons_slug_format — CHECK: 3–50 znaków, małe litery, cyfry, pojedyncze myślniki
--          wewnątrz (jak SALON_SLUG_PATTERN w src/lib/salon-slug.ts).
--
-- Dopisane ręcznie:
-- 1. SET LOCAL lock_timeout: ADD COLUMN i ADD CONSTRAINT biorą ACCESS EXCLUSIVE na
--    salons. Jeśli blokady nie da się wziąć w 5 s, migracja kończy się błędem 55P03
--    i nic się nie zmienia. Ponowienie = ponowne uruchomienie migracji.
-- 2. Uzupełnienie sluga istniejącym salonom, przed indeksem i CHECK. Ten sam
--    algorytm co slugFromSalonName + pickAvailableSalonSlug w src/lib/salon-slug.ts:
--    polskie litery → ASCII, małe litery, każdy ciąg innych znaków → jeden myślnik,
--    bez myślników na brzegach, najwyżej 50 znaków; pusty → `salon`; za krótki albo
--    zastrzeżony → przedrostek `salon-`; zajęty → sufiks `-2`, `-3`… Kolejność:
--    najstarszy salon dostaje adres bez sufiksu.
--    Różnica względem aplikacji: inne litery z akcentem (é, ü) aplikacja zamienia
--    na literę bazową, a migracja na myślnik. Na produkcji są tylko salony testowe.
--    Lista zastrzeżona = RESERVED_SALON_SLUGS w src/lib/salon-slug.ts (stan na dziś).
--    Zapytanie kontrolne (tylko odczyt) przed migracją:
--      SELECT count(*) FROM salons;
--
-- 3. Tabela salon_slug_history (rejestr adresów salonów, opis przy tabeli niżej):
--    RLS salonu, kontrola uprawnień i uzupełnienie bieżących adresów.
--
-- ROLLBACK: ręcznie:
--   DROP TABLE salon_slug_history;
--   ALTER TABLE salons DROP CONSTRAINT salons_slug_format;
--   DROP INDEX salons_slug_uq;
--   ALTER TABLE salons DROP COLUMN slug;
--   (wpis 0018 w drizzle.__drizzle_migrations zostaje; ponowne włączenie = nowa migracja).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "salons" ADD COLUMN "slug" text;--> statement-breakpoint
DO $$
DECLARE
  reserved constant text[] := ARRAY[
    'admin', 'api', 'app', 'appointments', 'assets', 'auth', 'book', 'booking',
    'calendar', 'calendar-demo', 'cennik', 'contact', 'dashboard', 'design-system',
    'dla-klientow', 'dla-salonow', 'dpa', 'favorites', 'forgot-password', 'help',
    'kontakt', 'login', 'logout', 'myhelper', 'null', 'offline', 'podprocesorzy',
    'polityka-prywatnosci', 'pomoc', 'portal', 'pricing', 'privacy', 'profile',
    'public', 'register', 'regulamin', 'reset-password', 'rezerwacja', 's', 'salons',
    'settings', 'signin', 'signup', 'static', 'support', 'terms', 'undefined',
    'waiting-list', 'www'
  ];
  r record;
  base text;
  candidate text;
  n integer;
BEGIN
  FOR r IN SELECT id, name FROM salons WHERE slug IS NULL ORDER BY created_at, id LOOP
    -- Polskie litery przed lower(): przy kolacji C lower() nie zmienia liter spoza ASCII.
    base := lower(translate(r.name, 'ĄĆĘŁŃÓŚŹŻąćęłńóśźż', 'ACELNOSZZacelnoszz'));
    base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
    base := regexp_replace(base, '^-+|-+$', '', 'g');
    base := regexp_replace(left(base, 50), '-+$', '');
    IF base = '' THEN
      base := 'salon';
    ELSIF length(base) < 3 OR base = ANY (reserved) THEN
      base := regexp_replace(left('salon-' || base, 50), '-+$', '');
    END IF;

    candidate := base;
    n := 2;
    WHILE EXISTS (SELECT 1 FROM salons WHERE slug = candidate) LOOP
      candidate := regexp_replace(left(base, 50 - length('-' || n)), '-+$', '') || '-' || n;
      n := n + 1;
    END LOOP;

    UPDATE salons SET slug = candidate WHERE id = r.id;
  END LOOP;
END
$$;--> statement-breakpoint
CREATE UNIQUE INDEX "salons_slug_uq" ON "salons" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "salons" ADD CONSTRAINT "salons_slug_format" CHECK ("salons"."slug" IS NULL OR (length("salons"."slug") BETWEEN 3 AND 50 AND "salons"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'));--> statement-breakpoint
-- Rejestr adresów salonów: każdy adres, który salon kiedykolwiek miał.
--   retired_at IS NULL     — adres bieżący (ten sam co salons.slug),
--   retired_at IS NOT NULL — adres dawny: przekierowuje do salonu i nie może go
--                            zająć inny salon (rozesłane i wydrukowane linki).
-- Ochrona przed przejęciem to klucz główny na `slug`: zajęcie adresu to INSERT
-- wiersza (slug, salon, NULL), porzucenie — wiersz zostaje z retired_at. Ten sam
-- adres w dwóch salonach = 23505 na salon_slug_history_pkey, także przy dwóch
-- równoległych transakcjach (druga czeka na pierwszą i dostaje konflikt). Bez
-- wyzwalaczy i funkcji: kontekst RLS jednego salonu nie widzi wierszy innych
-- salonów, a ograniczenie unikalności działa niezależnie od widoczności.
-- Własny dawny adres salon odzyskuje: usuwa swój wiersz i wstawia go od nowa.
CREATE TABLE "salon_slug_history" (
	"slug" text PRIMARY KEY NOT NULL,
	"salon_id" uuid NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "salon_slug_history_slug_format" CHECK (length("salon_slug_history"."slug") BETWEEN 3 AND 50 AND "salon_slug_history"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "salon_slug_history" ADD CONSTRAINT "salon_slug_history_salon_id_salons_id_fk" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "salon_slug_history_salon_id_idx" ON "salon_slug_history" USING btree ("salon_id");--> statement-breakpoint
-- Najwyżej jeden adres bieżący na salon.
CREATE UNIQUE INDEX "salon_slug_history_current_uq" ON "salon_slug_history" USING btree ("salon_id") WHERE "salon_slug_history"."retired_at" IS NULL;--> statement-breakpoint
-- Dopisane ręcznie: bieżące adresy istniejących salonów (po uzupełnieniu sluga wyżej).
INSERT INTO salon_slug_history (slug, salon_id, retired_at)
SELECT slug, id, NULL FROM salons WHERE slug IS NOT NULL;
--> statement-breakpoint
-- Dopisane ręcznie: RLS salonu (kształt jak 0014 i 0015, z nullif). Drizzle nie wyraża
-- polityk. Strażnik RLS czyta tę migrację z listy RLS_EXTRA_MIGRATION_FILES. Uprawnienia
-- roli aplikacji (SELECT, INSERT, UPDATE, DELETE) z uprawnień domyślnych schematu (0005).
ALTER TABLE salon_slug_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON salon_slug_history
  USING (salon_id = nullif(current_setting('app.current_salon_id', true), '')::uuid)
  WITH CHECK (salon_id = nullif(current_setting('app.current_salon_id', true), '')::uuid);
--> statement-breakpoint
-- Kontrola w tej samej transakcji: RLS włączone, rola aplikacji ma odczyt i zapis.
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.salon_slug_history'::regclass) THEN
    RAISE EXCEPTION 'salon_slug_history bez RLS';
  END IF;
  IF NOT has_table_privilege('myhelper_app', 'public.salon_slug_history', 'SELECT')
     OR NOT has_table_privilege('myhelper_app', 'public.salon_slug_history', 'INSERT')
     OR NOT has_table_privilege('myhelper_app', 'public.salon_slug_history', 'UPDATE')
     OR NOT has_table_privilege('myhelper_app', 'public.salon_slug_history', 'DELETE') THEN
    RAISE EXCEPTION 'myhelper_app bez SELECT, INSERT, UPDATE albo DELETE na salon_slug_history';
  END IF;
END
$$;
