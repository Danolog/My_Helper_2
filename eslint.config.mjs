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
    // izolację salonu), nie surowy `db`. Faza R1: poziom `warn` — 53 trasy
    // jeszcze go łamią (migracja w R2). R3 podniesie do `error` (łamie build CI),
    // gdy 0 tras importuje `db` poza zadeklarowanymi wyjątkami systemowymi.
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
