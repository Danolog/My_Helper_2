## Environment Variables

```
POSTGRES_URL                          # PostgreSQL connection string
BETTER_AUTH_SECRET                    # min 32 znaki
BETTER_AUTH_URL                       # bazowy URL (produkcja)
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET  # OAuth (opcjonalne)
NEXT_PUBLIC_APP_URL                   # bazowy URL (domyslnie http://localhost:3000)
BLOB_READ_WRITE_TOKEN                 # Vercel Blob (opcjonalnie)
STRIPE_SECRET_KEY / NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_BASIC / STRIPE_PRICE_PRO
```

## Key Config Files

- `drizzle.config.ts` — dialect postgresql, schema src/lib/schema.ts
- `next.config.ts` — Turbopack dev, image domains, CSP headers, TS build errors ignored
- `docker-compose.yml` — pgvector/pgvector:pg18, port 5432, baza pos_dev
- `tsconfig.json` — target ES2017, strict mode, path alias @/* -> ./src/*
- `vitest.config.ts` — konfiguracja Vitest
- `playwright.config.ts` — konfiguracja Playwright
- `vercel.json` — build command pnpm build:ci
- `components.json` — konfiguracja shadcn/ui
