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
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { MODULES } from "@/lib/features";
import { PLAN_FEATURES } from "@/lib/plan-features";

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

function expectNoMatch(relPath: string, pattern: RegExp) {
  const match = read(relPath).match(pattern);
  expect(match?.[0], `${relPath} zawiera „${match?.[0]}”`).toBeUndefined();
}

describe("prawda w marketingu", () => {
  it("rejestr modułów nadal wyłącza globalnie funkcje, których nie obiecujemy", () => {
    // Jeśli któryś moduł przestanie być hardOff, ten test trzeba świadomie
    // zaktualizować razem z tekstami sprzedażowymi.
    const hardOff = MODULES.filter((m) => m.hardOff).map((m) => m.key).sort();
    expect(hardOff).toEqual([
      "aiNotifications",
      "clientMarketing",
      "fiscal",
      "invoices",
      "loyalty",
      "newsletters",
      "pushNotifications",
      "socialPosts",
      "videoGen",
      "voiceAi",
    ]);
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

    it.each(all)("„%s” nie obiecuje wyłączonej funkcji", (feature) => {
      expect(feature).not.toMatch(VOICE);
      expect(feature).not.toMatch(VIDEO);
      expect(feature).not.toMatch(SOCIAL_POSTS);
      expect(feature).not.toMatch(FISCAL);
      expect(feature).not.toMatch(/Stripe|Blik/i);
      expect(feature).not.toMatch(/Widget planowania/i);
      expect(feature).not.toMatch(SENTIMENT);
      expect(feature).not.toMatch(AUTO_REVIEW_REPLIES);
      expect(feature).not.toMatch(POPULARITY_CLAIM);
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

    it("trasa /api/subscription-plans i seed testowy biorą listy z jednego źródła", () => {
      expect(read("src/app/api/subscription-plans/route.ts")).toMatch(/PLAN_FEATURES/);
      expect(read("scripts/seed-test.ts")).toMatch(/PLAN_FEATURES/);
    });
  });
});
