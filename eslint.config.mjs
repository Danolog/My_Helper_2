import nextConfig from "eslint-config-next/core-web-vitals";
import { dbIsolationConfig } from "./eslint.db-isolation.mjs";

const D1_MESSAGE =
  "Parametry zapytania i `detail` Postgresa zawierają dane osobowe; loguj `error` przez `logger` (redakcja w `safe-error.ts`)";

// D1 (Ryan, #64/#67): parametry zapytania (`params`) i `detail` błędu
// Postgresa niosą dane osobowe (imię, telefon, e-mail z INSERT-a). Nie
// wyciągamy ich ręcznie z obiektu błędu — `logger` redaguje błąd
// centralnie (safe-error.ts). `routeCtx.params` (parametry trasy) nie
// pasuje do selektorów: obiekt nie nazywa się jak błąd.
export const D1_SELECTORS = [
  {
    selector: "MemberExpression[property.name=/^(params|detail)$/][object.name=/^(e|err|error|cause|dbError)$/]",
    message: D1_MESSAGE,
  },
  {
    selector: "MemberExpression[property.name=/^(params|detail)$/][object.property.name='cause']",
    message: D1_MESSAGE,
  },
  {
    selector: "VariableDeclarator[init.name=/^(e|err|error)$/] > ObjectPattern > Property[key.name=/^(params|detail)$/]",
    message: D1_MESSAGE,
  },
];

const config = [
  {
    // Z5: nieużyte dyrektywy eslint-disable są błędem (po usunięciu wyjątków
    // komentarzem nie zostaje martwy komentarz).
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
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
      "test-results*/**",
      "playwright-report/**",
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
  // #193 P0a (ADR-001 §2.3, Z2–Z5): zakaz surowego `db` i puli systemowej w
  // całym src/ na poziomie `error`; wyjątki i dług przejściowy w
  // eslint.db-isolation.mjs. D1 jedzie w tych samych blokach, bo
  // `no-restricted-syntax` nie łączy opcji między blokami.
  ...dbIsolationConfig(D1_SELECTORS),
];

export default config;
