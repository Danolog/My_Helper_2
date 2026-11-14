/**
 * `featuresFor()` — jedyne miejsce, które rozstrzyga, skąd interfejs bierze
 * listę funkcji planu: dla Basic i Pro z kodu (`PLAN_FEATURES`), dla planu
 * o nieznanym slugu z kolumny `features_json`.
 */
import { describe, it, expect } from "vitest";
import {
  PLAN_FEATURES,
  PLAN_SUMMARY,
  PRO_INCLUDES_BASIC,
  featuresFor,
  planComparison,
  planHighlights,
  proOnlyFeatures,
} from "@/lib/plan-features";

const STALE = ["Asystent AI glosowy (odbieranie polaczen)", "Platnosci zadatkow (Stripe + Blik)"];

describe("featuresFor", () => {
  it.each(["basic", "pro"] as const)("plan %s: lista z kodu, features_json zignorowane", (slug) => {
    expect(featuresFor(slug, STALE)).toEqual([...PLAN_FEATURES[slug]]);
  });

  it("zwraca kopię — zmiana wyniku nie rusza PLAN_FEATURES", () => {
    const before = [...PLAN_FEATURES.pro];
    featuresFor("pro", null).push("Dopisane przez wywołującego");
    expect([...PLAN_FEATURES.pro]).toEqual(before);
  });

  it("plan o nieznanym slugu zachowuje listę z bazy", () => {
    expect(featuresFor("enterprise", ["Dedykowany opiekun"])).toEqual(["Dedykowany opiekun"]);
  });

  it.each([null, undefined, "tekst", 7, { 0: "a" }])(
    "plan o nieznanym slugu z features_json = %j dostaje pustą tablicę",
    (stored) => {
      expect(featuresFor("enterprise", stored)).toEqual([]);
    },
  );

  // Nazwy odziedziczone po Object.prototype nie są planami: operator `in`
  // uznawał je za znane i funkcja rzucała wyjątek przy rozwijaniu wartości.
  it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "slug „%s” (nazwa odziedziczona) jest traktowany jak nieznany plan",
    (slug) => {
      expect(featuresFor(slug, ["Dedykowany opiekun"])).toEqual(["Dedykowany opiekun"]);
    },
  );

  it("slug jest porównywany dokładnie — inna wielkość liter to nieznany plan", () => {
    expect(featuresFor("Pro", ["Z bazy"])).toEqual(["Z bazy"]);
  });
});

describe("pochodne list funkcji — wszystko wynika z PLAN_FEATURES", () => {
  it("PRO_INCLUDES_BASIC to pierwszy wiersz planu Pro", () => {
    expect(PRO_INCLUDES_BASIC).toBe("Wszystko z planu Basic");
    expect(PLAN_FEATURES.pro[0]).toBe(PRO_INCLUDES_BASIC);
  });

  it.each(["basic", "pro"] as const)("planHighlights(%s, n) to pierwsze n pozycji listy", (slug) => {
    expect(planHighlights(slug, 4)).toEqual(PLAN_FEATURES[slug].slice(0, 4));
    expect(planHighlights(slug, 0)).toEqual([]);
    expect(planHighlights(slug, 999)).toEqual([...PLAN_FEATURES[slug]]);
  });

  it("planHighlights zwraca kopię", () => {
    const before = [...PLAN_FEATURES.basic];
    planHighlights("basic", 3).push("Dopisane");
    expect([...PLAN_FEATURES.basic]).toEqual(before);
  });

  it("proOnlyFeatures to lista Pro bez wiersza „Wszystko z planu Basic”", () => {
    expect(proOnlyFeatures()).toEqual(PLAN_FEATURES.pro.filter((f) => f !== PRO_INCLUDES_BASIC));
    expect(proOnlyFeatures()).not.toContain(PRO_INCLUDES_BASIC);
    expect(proOnlyFeatures().length).toBe(PLAN_FEATURES.pro.length - 1);
  });

  it("planComparison: wiersze to dokładnie pozycje PLAN_FEATURES, każda raz", () => {
    const rows = planComparison().flatMap((c) => c.features);
    const names = rows.map((r) => r.name);

    expect(names).toEqual([...PLAN_FEATURES.basic, ...proOnlyFeatures()]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("planComparison: pozycje Basic są w obu planach, pozycje Pro tylko w Pro", () => {
    for (const row of planComparison().flatMap((c) => c.features)) {
      const inBasic = (PLAN_FEATURES.basic as readonly string[]).includes(row.name);
      expect(row.basic, row.name).toBe(inBasic);
      expect(row.pro, row.name).toBe(true);
    }
  });

  it("planComparison: kategorie są nazwane i niepuste", () => {
    for (const category of planComparison()) {
      expect(category.category.length).toBeGreaterThan(0);
      expect(category.features.length).toBeGreaterThan(0);
    }
  });

  it("PLAN_SUMMARY ma opis każdego planu", () => {
    expect(PLAN_SUMMARY.basic.length).toBeGreaterThan(0);
    expect(PLAN_SUMMARY.pro.length).toBeGreaterThan(0);
  });
});
