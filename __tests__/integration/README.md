# Testy integracyjne — REALNA, lokalna baza

W odróżnieniu od `__tests__/api/*` (mockują db/auth) te testy uderzają w
**realną bazę** przez **realne handlery tras** i **realny SQL**. Dowodzą, że
filtr izolacji salonów `and(eq(id), eq(salonId))` faktycznie odcina cudzy salon
na żywo (a nie tylko w mocku).

## Bezpieczeństwo (krytyczne)

- Baza testowa jest **wyłącznie lokalna i efemeryczna** (Docker, `localhost`).
- Setup `setup-real-db.ts` ma **guard**: jeśli host DSN nie jest
  `localhost`/`127.0.0.1` (albo pasuje do wzorca hosta zdalnego, np. `neon.tech`),
  przerywa cały przebieg testów **zanim** cokolwiek dotknie bazy.
- Konfiguracja NIE ładuje `.env.local` (które drizzle-kit/Next auto-ładują i
  które na maszynie dewelopera bywa produkcją). Env idzie z pliku wskazanego
  jawnie zmienną `MYHELPER_TEST_ENV` (domyślnie `<repo>/../myhelper-test.env`).

## Plik env (poza repo)

Sekrety nie wchodzą do repo. Utwórz plik **poza repozytorium** (np.
`../myhelper-test.env`) z kluczami (wartości podaj sam, bez commitowania):

- `POSTGRES_URL` — DSN wskazujący LOKALNĄ bazę: host `localhost`, port `5440`,
  baza `pos_dev`, user `dev_user` (creds dev z `docker-compose.yml`).
- `BETTER_AUTH_SECRET` — dowolny ciąg min. 32 znaki na potrzeby testu.
- `BETTER_AUTH_URL` — `http://localhost:3000`.

## Uruchomienie

```bash
# 1. Postaw lokalnego Postgresa na porcie 5440 (omija kolizję z natywnym 5432)
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d

# 2. Migracje na LOKALNĄ bazę (DSN localhost z pliku env)
#    guard host=localhost jest też w setupie testu
npx drizzle-kit migrate     # z POSTGRES_URL wskazującym localhost

# 3. Test
pnpm test:integration
#    hasło użyte do signup/signin testowych: zmienna TEST_PW (domyślnie wbudowane)
```

## Co pokrywa

Reprezentatywna próbka tras `[id]` (wzorzec dla wszystkich 44): jako właściciel
salonu A na zasobach salonu B oczekujemy **404/403** (SQL odcina), na własnych
**200** (kontrola pozytywna):

- `clients/[id]` — GET, PUT, DELETE
- `appointments/[id]` — GET, PUT, DELETE
- `gallery/[id]` — GET, PATCH, DELETE (regresja P0-A)
