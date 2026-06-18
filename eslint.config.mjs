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
    // POZIOM `warn` JEST ŚWIADOMY DO CZASU R3 (bramka F4 review Ryana, runbook
    // RLS sekcja 9). Stan faktyczny 2026-06-18: 99 tras w src/app/api/** wciąż
    // importuje surowy `db` (refaktor R2 częściowy, 68 tras zmigrowanych na
    // forSalon). Podniesienie na `error` TERAZ złamałoby `pnpm lint` → quality-gate
    // CI na 99 plikach — to nie zamknięcie długu, to zablokowanie repo. Flip na
    // `error` należy do PR domykającego R3, gdy 0 tras (poza zadeklarowanymi
    // wyjątkami systemowymi: webhooki/cron/seed) importuje `db`. Do tego czasu
    // `warn` utrzymuje sygnał w review bez psucia CI. Plan przejścia: ADR-001
    // sekcja 5/7 (R2 paczkami ~10 tras → R3 flip na `error`).
    files: ["src/app/api/**/*.ts"],
    ignores: ["src/app/api/**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["warn", {
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
