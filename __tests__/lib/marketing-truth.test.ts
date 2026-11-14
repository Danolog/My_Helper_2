/**
 * Strażnik „prawdy w marketingu” (plan wejścia na rynek: B9, zadanie 1.3).
 *
 * Teksty sprzedażowe nie mogą obiecywać funkcji, które są wyłączone globalnie
 * (`hardOff` w `src/lib/features.ts`), zadatków płatnych online (decyzja D1)
 * ani powoływać się na zmyślony dowód społeczny (liczba salonów, oceny,
 * opinie). Test czyta źródła stron i pilnuje, żeby te obietnice nie wróciły.
 *
 * Nie mogą też obiecywać funkcji, których w kodzie w ogóle nie ma (analiza
 * sentymentu opinii).
 *
 * Lista modułów zamrożonych pochodzi z rejestru (`MODULES` z flagą `hardOff`),
 * nie z tego pliku. Tu żyje tylko mapa „moduł zamrożony → po czym poznać jego
 * obietnicę w tekście” (`FROZEN_MODULE_PROMISES`); test kompletności pada,
 * gdy rejestr i mapa się rozjadą.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { MODULES } from "@/lib/features";
import { PLAN_FEATURES, PLAN_SUMMARY } from "@/lib/plan-features";

const ROOT = process.cwd();
const read = (relPath: string) => readFileSync(join(ROOT, relPath), "utf8");

const SALES_DIR = "src/app/(site)/dla-salonow/_components";
const SALES_FILES = [
  "src/app/(site)/dla-salonow/page.tsx",
  ...readdirSync(join(ROOT, SALES_DIR)).map((f) => `${SALES_DIR}/${f}`),
];

// Pliki, które pokazują ofertę planów: strona sprzedażowa, cennik, wybór
// planu przy rejestracji, panel subskrypcji, bramka planu Pro.
const SUBSCRIPTION_DIR = "src/app/dashboard/subscription/_components";
const PLAN_OFFER_FILES = [
  ...SALES_FILES,
  "src/app/(site)/pricing/page.tsx",
  "src/components/auth/_components/StepPlanSelection.tsx",
  "src/components/dashboard/create-salon-prompt.tsx",
  "src/components/subscription/pro-plan-gate.tsx",
  ...readdirSync(join(ROOT, SUBSCRIPTION_DIR)).map((f) => `${SUBSCRIPTION_DIR}/${f}`),
];

const VOICE = /g[łl]osow|odbieranie po[łl][ąa]cze[ńn]/i;
const VIDEO = /wideo|video/i;
const SOCIAL_POSTS = /post(y|[óo]w)\b[^"\n]*social/i;
const FISCAL = /drukark[ąa] fiskaln/i;
const ONLINE_DEPOSITS = /Stripe \+ Blik|p[łl]atno[śs]ci zadatk[óo]w|zadatk[óo]w przez Stripe/i;
// Analizy sentymentu nie ma w kodzie: `grep -rniE "sentyment|sentiment" src`
// nie znajduje żadnej implementacji.
const SENTIMENT = /sentyment|sentiment/i;
// Odpowiedzi na opinie AI tylko generuje, na żądanie właściciela (przycisk
// „Generuj odpowiedz AI” w `src/app/dashboard/reviews/page.tsx`); zapisuje je
// człowiek. Nic nie odpowiada automatycznie — nie ma takiego zadania cron.
const AUTO_REVIEW_REPLIES = /automatyczn[a-z]* odpowied/i;
// Znaczek przy planie nie może twierdzić nic o popularności (nie mamy liczb,
// które by to pokrywały) ani oceniać planu („Polecany” — ocena bez podstaw
// przy planie trzy razy droższym). Znaczek opisuje różnicę: „Z asystentem AI”.
const POPULARITY_CLAIM =
  /najpopularniejsz|najcz[ęe]stszy wyb[óo]r|najcz[ęe][śs]ciej wybieran|polecan/i;
const FAKE_SOCIAL_PROOF = /setek salon|Tester Beta|zadowolonych w[łl]a[śs]cicieli|>4[.,]9</i;
// „Asystent AI content” obiecywał generowanie treści marketingowych. Po
// zamrożeniu newsletterów i postów social zostaje z niego tylko generowanie
// opisów usług — i tak ma się to nazywać.
const AI_CONTENT =
  /asystent\w*\s+(AI\s+)?content|content\s+marketing|generowani[ea]\s+tre[śs]ci/i;

/**
 * Po czym poznać w tekście obietnicę modułu zamrożonego. Klucze muszą być
 * dokładnie zbiorem modułów `hardOff` z rejestru — zamrożenie nowego modułu
 * bez wzorca albo odmrożenie bez zdjęcia wzorca czerwieni test kompletności.
 */
const FROZEN_MODULE_PROMISES: Record<string, RegExp> = {
  voiceAi: VOICE,
  videoGen: VIDEO,
  socialPosts: SOCIAL_POSTS,
  fiscal: FISCAL,
  loyalty: /lojalno[śs]ciow|punkt(y|[óo]w) za wizyt/i,
  newsletters: /newsletter/i,
  invoices: /faktur/i,
  clientMarketing: /urodzin|t[ęe]sknimy/i,
  aiNotifications: /powiadomie\S+ (pisan|generowan|personalizowan)\S+ przez AI/i,
  pushNotifications: /\bpush\b/i,
};

const FROZEN_MODULE_KEYS = MODULES.filter((m) => m.hardOff).map((m) => m.key);

function expectNoMatch(relPath: string, pattern: RegExp) {
  const match = read(relPath).match(pattern);
  expect(match?.[0], `${relPath} zawiera „${match?.[0]}”`).toBeUndefined();
}

describe("prawda w marketingu", () => {
  it("każdy moduł zamrożony w rejestrze ma wzorzec obietnicy — i żaden inny", () => {
    // Lista modułów pochodzi z rejestru. Jeśli moduł zostanie zamrożony albo
    // odmrożony, mapę wzorców trzeba świadomie zaktualizować razem z tekstami.
    expect(FROZEN_MODULE_KEYS.length).toBeGreaterThan(0);
    expect(Object.keys(FROZEN_MODULE_PROMISES).sort()).toEqual([...FROZEN_MODULE_KEYS].sort());
  });

  describe("strona sprzedażowa /dla-salonow", () => {
    it.each(SALES_FILES)("%s nie obiecuje wyłączonych funkcji", (file) => {
      expectNoMatch(file, VOICE);
      expectNoMatch(file, VIDEO);
      expectNoMatch(file, SOCIAL_POSTS);
      expectNoMatch(file, FISCAL);
      expectNoMatch(file, ONLINE_DEPOSITS);
      expectNoMatch(file, /Stripe/);
    });

    it.each(SALES_FILES)("%s nie zawiera zmyślonego dowodu społecznego", (file) => {
      expectNoMatch(file, FAKE_SOCIAL_PROOF);
      expectNoMatch(file, /30\+/);
      expectNoMatch(file, /ekskluzywny dost[ęe]p/i);
    });

    it("sekcja opinii jest usunięta", () => {
      expect(existsSync(join(ROOT, SALES_DIR, "DlaSalonowTestimonials.tsx"))).toBe(false);
      expectNoMatch("src/app/(site)/dla-salonow/page.tsx", /Testimonials/);
    });
  });

  describe("cennik /pricing", () => {
    const file = "src/app/(site)/pricing/page.tsx";

    it("nie obiecuje wyłączonych funkcji ani zadatków online", () => {
      expectNoMatch(file, VOICE);
      expectNoMatch(file, VIDEO);
      expectNoMatch(file, SOCIAL_POSTS);
      expectNoMatch(file, FISCAL);
      expectNoMatch(file, ONLINE_DEPOSITS);
      expectNoMatch(file, /Widget planowania/i);
    });
  });

  describe("rejestracja i logowanie", () => {
    it("panel boczny nie powołuje się na setki salonów ani zmyśloną opinię", () => {
      const file = "src/app/(auth)/layout.tsx";
      expectNoMatch(file, /setek salon[óo]w/i);
      expectNoMatch(file, /Anna K\./);
      expectNoMatch(file, /&ldquo;/);
    });
  });

  describe("panel: subskrypcja i hub AI", () => {
    it("dialogi zmiany planu nie wspominają asystenta głosowego", () => {
      expectNoMatch("src/app/dashboard/subscription/_components/plan-actions.tsx", VOICE);
    });

    it("kafelek generatora treści i bramka Pro nie obiecują wideo ani postów social", () => {
      const source = read("src/app/dashboard/ai-assistant/page.tsx");
      // Kafelek asystenta głosowego zostaje w kodzie, ale jest ukryty flagą
      // modułu voiceAi (hardOff) — sprawdzamy pozostałe teksty.
      const withoutVoiceTile = source.replace(/\{\s*icon: Mic,[\s\S]*?module: "voiceAi",\s*\},/, "");
      expect(withoutVoiceTile).not.toMatch(VOICE);
      expect(withoutVoiceTile).not.toMatch(VIDEO);
      expect(withoutVoiceTile).not.toMatch(/Posty social/i);
    });

    it("bramka Pro generatora treści nie obiecuje postów social ani widgetu planowania", () => {
      const source = read("src/app/dashboard/content-generator/page.tsx");
      const gate = source.slice(source.indexOf("proBenefits"));
      expect(gate).not.toMatch(SOCIAL_POSTS);
      expect(gate).not.toMatch(/Widget planowania/i);
    });

    it("bramka Pro kosztów AI nie obiecuje wideo", () => {
      const source = read("src/app/dashboard/ai-usage/page.tsx");
      const gate = source.slice(source.indexOf("proBenefits"));
      expect(gate).not.toMatch(VIDEO);
    });
  });

  describe("oferta planów: cennik, rejestracja, panel subskrypcji", () => {
    it.each(PLAN_OFFER_FILES)("%s nie obiecuje analizy sentymentu", (file) => {
      expectNoMatch(file, SENTIMENT);
    });

    it.each(PLAN_OFFER_FILES)("%s nie obiecuje automatycznych odpowiedzi na opinie", (file) => {
      expectNoMatch(file, AUTO_REVIEW_REPLIES);
    });

    it.each(PLAN_OFFER_FILES)("%s nie twierdzi, że któryś plan jest najpopularniejszy ani polecany", (file) => {
      expectNoMatch(file, POPULARITY_CLAIM);
    });
  });

  describe("listy funkcji planów (źródło dla tabeli subscription_plans)", () => {
    const all = [...PLAN_FEATURES.basic, ...PLAN_FEATURES.pro];

    it.each([...all, PLAN_SUMMARY.basic, PLAN_SUMMARY.pro])("„%s” nie obiecuje wyłączonej funkcji", (feature) => {
      for (const key of FROZEN_MODULE_KEYS) {
        expect(feature, `moduł zamrożony: ${key}`).not.toMatch(FROZEN_MODULE_PROMISES[key]!);
      }
      expect(feature).not.toMatch(AI_CONTENT);
      expect(feature).not.toMatch(/Stripe|Blik/i);
      expect(feature).not.toMatch(/Widget planowania/i);
      expect(feature).not.toMatch(SENTIMENT);
      expect(feature).not.toMatch(AUTO_REVIEW_REPLIES);
      expect(feature).not.toMatch(POPULARITY_CLAIM);
    });

    it("plan Pro nadal obiecuje generowanie opisów usług (jedyne, co zostało z „AI content”)", () => {
      expect(PLAN_FEATURES.pro).toContain("Generowanie opisów usług");
    });

    it("plan Pro zaczyna się od wiersza, który filtruje dialog upgrade'u", () => {
      // plan-actions.tsx pomija dokładnie ten tekst na liście „Dodatkowe funkcje".
      expect(PLAN_FEATURES.pro[0]).toBe("Wszystko z planu Basic");
    });

    it("oba plany mają niepuste listy bez duplikatów", () => {
      expect(PLAN_FEATURES.basic.length).toBeGreaterThan(0);
      expect(PLAN_FEATURES.pro.length).toBeGreaterThan(0);
      expect(new Set(all).size).toBe(all.length);
    });

    // Każde miejsce, które pokazuje albo zapisuje listę funkcji planu, woła
    // `src/lib/plan-features.ts` — import ORAZ wywołanie, nie samo słowo
    // w komentarzu. Że pokazane pozycje są równe wynikowi tych funkcji,
    // sprawdza `__tests__/components/PlanFeaturesSingleSource.test.tsx`.
    const CONSUMERS: Array<[file: string, call: RegExp]> = [
      ["src/app/api/subscription-plans/route.ts", /\bfeaturesFor\(|PLAN_FEATURES\.(basic|pro)/],
      ["src/app/api/subscriptions/current/route.ts", /\bfeaturesFor\(/],
      ["scripts/seed-test.ts", /PLAN_FEATURES\.(basic|pro)/],
      ["src/app/(site)/dla-salonow/_components/DlaSalonowPricing.tsx", /\bplanHighlights\(/],
      ["src/app/(site)/pricing/page.tsx", /\bplanComparison\(/],
      ["src/components/dashboard/create-salon-prompt.tsx", /\bplanHighlights\(/],
      ["src/app/dashboard/subscription/_components/plan-actions.tsx", /\bproOnlyFeatures\(/],
    ];

    /** Źródło bez komentarzy — słowo w komentarzu nie jest wywołaniem. */
    const code = (relPath: string) =>
      read(relPath)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

    it.each(CONSUMERS)("%s importuje i woła jedno źródło list funkcji", (file, call) => {
      const source = code(file);
      expect(source).toMatch(/from ["'](@\/lib\/plan-features|\.\.\/src\/lib\/plan-features)["']/);
      expect(source).toMatch(call);
    });

    it.each(CONSUMERS)("%s nie ma listy funkcji wpisanej ręcznie", (file) => {
      const source = code(file);
      // Ręczna kopia: tablica napisów pod kluczem `features` albo wiersz
      // tabeli porównania `{ name: "…", basic: …, pro: … }`.
      expect(source).not.toMatch(/features:\s*\[\s*["'`]/);
      expect(source).not.toMatch(/name:\s*["'`][^"'`]+["'`],\s*basic:/);
    });
  });
});
