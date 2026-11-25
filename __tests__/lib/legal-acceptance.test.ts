/**
 * Reguła akceptacji regulaminu i umowy powierzenia przy zakładaniu salonu.
 *
 * Funkcje przyjmują stan (flagę i rejestr) jako parametry, więc test sprawdza
 * prawdziwą regułę przy obu wartościach flagi bez atrapy modułu dokumentów.
 */
import { describe, it, expect, vi } from "vitest";
import {
  LEGAL_ACCEPTANCE_REQUIRED_CODE,
  LegalDocumentsConfigError,
  checkLegalAcceptance,
  recordLegalAcceptances,
  requiredLegalVersions,
} from "@/lib/legal/acceptance";
import { LEGAL_DOCUMENTS, type LegalDocuments } from "@/lib/legal/documents";
import { legalAcceptances } from "@/lib/schema";
import type { DbTx } from "@/lib/server/repository";

const TERMS_V = "2026-12-01";
const DPA_V = "2026-12-02";
const VERSIONED: LegalDocuments = {
  ...LEGAL_DOCUMENTS,
  terms: { ...LEGAL_DOCUMENTS.terms, version: TERMS_V },
  dpa: { ...LEGAL_DOCUMENTS.dpa, version: DPA_V },
};
const REQUIRED = { terms: TERMS_V, dpa: DPA_V };

describe("requiredLegalVersions", () => {
  it("wartości w module (dokumenty nieopublikowane) → akceptacja nie obowiązuje", () => {
    expect(requiredLegalVersions()).toBeNull();
  });

  it("flaga wyłączona → null także przy ustalonych wersjach", () => {
    expect(requiredLegalVersions(false, VERSIONED)).toBeNull();
  });

  it("flaga włączona i obie wersje → bieżące wersje regulaminu i DPA", () => {
    expect(requiredLegalVersions(true, VERSIONED)).toEqual(REQUIRED);
  });

  it.each([
    ["terms", { ...VERSIONED, terms: { ...VERSIONED.terms, version: null } }],
    ["dpa", { ...VERSIONED, dpa: { ...VERSIONED.dpa, version: null } }],
  ] as const)("flaga włączona, %s bez wersji → błąd konfiguracji (rejestracja zablokowana)", (doc, docs) => {
    expect(() => requiredLegalVersions(true, docs)).toThrow(LegalDocumentsConfigError);
    expect(() => requiredLegalVersions(true, docs)).toThrow(doc);
  });
});

describe("checkLegalAcceptance", () => {
  it("akceptacja nie obowiązuje → ok bez wpisów, pola z żądania ignorowane", () => {
    expect(checkLegalAcceptance({}, null)).toEqual({ ok: true, acceptance: null });
    expect(
      checkLegalAcceptance({ termsVersion: "x", dpaVersion: "y", acceptanceSource: "registration" }, null)
    ).toEqual({ ok: true, acceptance: null });
  });

  it("obie bieżące wersje i źródło → akceptacja do zapisu", () => {
    expect(
      checkLegalAcceptance({ termsVersion: TERMS_V, dpaVersion: DPA_V, acceptanceSource: "create_salon" }, REQUIRED)
    ).toEqual({ ok: true, acceptance: { versions: REQUIRED, source: "create_salon" } });
  });

  it("brak obu wersji → odmowa z polami regulaminu i DPA oraz wymaganymi wersjami", () => {
    const r = checkLegalAcceptance({ acceptanceSource: "registration" }, REQUIRED);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.body.code).toBe(LEGAL_ACCEPTANCE_REQUIRED_CODE);
    expect(Object.keys(r.body.details).sort()).toEqual(["dpaVersion", "termsVersion"]);
    expect(r.body.requiredVersions).toEqual(REQUIRED);
  });

  it.each([
    ["tylko regulamin", { termsVersion: TERMS_V }, ["dpaVersion"]],
    ["tylko DPA", { dpaVersion: DPA_V }, ["termsVersion"]],
    ["nieaktualny regulamin", { termsVersion: "2026-01-01", dpaVersion: DPA_V }, ["termsVersion"]],
    ["nieaktualna DPA", { termsVersion: TERMS_V, dpaVersion: "2026-01-01" }, ["dpaVersion"]],
    ["wersje zamienione miejscami", { termsVersion: DPA_V, dpaVersion: TERMS_V }, ["dpaVersion", "termsVersion"]],
    ["wersja z białym znakiem", { termsVersion: ` ${TERMS_V}`, dpaVersion: DPA_V }, ["termsVersion"]],
  ])("%s → odmowa wskazująca pole", (_n, versions, fields) => {
    const r = checkLegalAcceptance({ ...versions, acceptanceSource: "registration" }, REQUIRED);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.body.details).sort()).toEqual(fields);
  });

  it("bieżące wersje bez źródła → odmowa", () => {
    const r = checkLegalAcceptance({ termsVersion: TERMS_V, dpaVersion: DPA_V }, REQUIRED);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.body.details)).toEqual(["acceptanceSource"]);
  });
});

describe("recordLegalAcceptances", () => {
  it("dwa wpisy (regulamin, DPA) z kontem, salonem, wersją i źródłem; czas nadaje baza", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn(() => ({ values }));
    const tx = { insert } as unknown as DbTx;

    await recordLegalAcceptances(tx, {
      salonId: "salon-1",
      userId: "user-1",
      acceptance: { versions: REQUIRED, source: "registration" },
    });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(legalAcceptances);
    expect(values).toHaveBeenCalledWith([
      { salonId: "salon-1", userId: "user-1", document: "terms", version: TERMS_V, source: "registration" },
      { salonId: "salon-1", userId: "user-1", document: "dpa", version: DPA_V, source: "registration" },
    ]);
  });

  it("błąd zapisu leci do wołającego (cofa jego transakcję)", async () => {
    const tx = {
      insert: () => ({ values: () => Promise.reject(new Error("db")) }),
    } as unknown as DbTx;
    await expect(
      recordLegalAcceptances(tx, {
        salonId: "s",
        userId: "u",
        acceptance: { versions: REQUIRED, source: "registration" },
      })
    ).rejects.toThrow("db");
  });
});
