/**
 * `featuresFor()` — jedyne miejsce, które rozstrzyga, skąd interfejs bierze
 * listę funkcji planu: dla Basic i Pro z kodu (`PLAN_FEATURES`), dla planu
 * o nieznanym slugu z kolumny `features_json`.
 */
import { describe, it, expect } from "vitest";
import { PLAN_FEATURES, featuresFor } from "@/lib/plan-features";

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
