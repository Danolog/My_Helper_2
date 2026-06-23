import nextConfig from "eslint-config-next/core-web-vitals";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      ".cache/**",
      "dist/**",
      "build/**",
      "create-agentic-app/**",
      "drizzle/**",
      "scripts/**",
    ],
  },
  ...nextConfig,
  {
    rules: {
      // React rules
      "react/jsx-no-target-blank": "error",
      "react/no-unescaped-entities": "off",

      // React Hooks rules
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Import rules
      "import/no-anonymous-default-export": "warn",
      "import/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling"],
            "index",
            "type",
          ],
          pathGroups: [
            {
              pattern: "react",
              group: "builtin",
              position: "before",
            },
            {
              pattern: "next/**",
              group: "builtin",
              position: "before",
            },
            {
              pattern: "@/**",
              group: "internal",
              position: "before",
            },
          ],
          pathGroupsExcludedImportTypes: ["react", "next"],
          "newlines-between": "never",
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
        },
      ],

      // Best practices
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  {
    // ADR-001 sekcja 2.3 — zakaz surowego `db` w trasach API poza warstwą repo.
    // Trasa importuje forSalon(salonId) z @/lib/server/repository (wymusza
    // izolację salonu), nie surowy `db`.
    //
    // POZIOM `error` (R3, domknięcie strukturalne). Refaktor R2 jest KOMPLETNY:
    // wszystkie trasy owner-scoped migrowane na forSalon. Pozostałe importy `db`
    // w src/app/api/** to ZADEKLAROWANE WYJĄTKI — każdy opatrzony
    // `// eslint-disable-next-line no-restricted-imports` z powodem (kontekst
    // klienta / publiczny katalog / webhook / cron / seed / per-user / globalny
    // katalog planów / lookup salons.ownerId). Nowy nieoznaczony import `db`
    // łamie `pnpm lint` → quality-gate CI, co jest celem bramki: każdy nowy
    // surowy `db` wymaga świadomej decyzji + adnotacji. Plan przejścia: ADR-001
    // sekcja 5/7 (R2 paczkami → R3 flip na `error`).
    files: ["src/app/api/**/*.ts"],
    ignores: ["src/app/api/**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "@/lib/db",
          importNames: ["db"],
          message:
            "Trasy API nie importują surowego `db`. Użyj forSalon(salonId) z @/lib/server/repository — to wymusza izolację salonu. Wyjątki (webhooki/cron/seed) deklarują kontekst jawnie (patrz ADR-001 sekcja 4).",
        }],
      }],
    },
  },
];

export default config;
