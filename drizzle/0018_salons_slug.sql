-- Krótki adres salonu `/s/<slug>` (plan wejścia na rynek, pkt 2.1).
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
-- ROLLBACK: ręcznie:
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
ALTER TABLE "salons" ADD CONSTRAINT "salons_slug_format" CHECK ("salons"."slug" IS NULL OR (length("salons"."slug") BETWEEN 3 AND 50 AND "salons"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'));
