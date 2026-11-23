/**
 * Pomocniki formularzy: pola akceptacji regulaminu i DPA przy zakładaniu salonu
 * oraz informacja przy rezerwacji gościa.
 *
 * Funkcje przyjmują stan (flagę i rejestr) jako parametry z wartościami domyślnymi
 * z modułu, więc test sprawdza prawdziwą regułę przy obu wartościach flagi bez
 * atrapy modułu. Wersje w polach muszą być tymi samymi, których wymaga trasa
 * (`requiredLegalVersions`).
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  LEGAL_ACCEPTANCE_REQUIRED_CODE as SERVER_CODE,
  requiredLegalVersions,
  type FormLegalAcceptanceSource,
} from "@/lib/legal/acceptance";
import {
  LEGAL_ACCEPTANCE_REQUIRED_CODE,
  LEGAL_DOCUMENTS,
  bookingLegalNotice,
  isLegalAcceptanceComplete,
  legalAcceptanceForm,
  legalAcceptanceRequestFields,
  type LegalAcceptanceFormSource,
  type LegalDocuments,
} from "@/lib/legal/documents";

const TERMS_V = "2026-12-01";
const DPA_V = "2026-12-02";
const PRIVACY_V = "2026-12-03";

const VERSIONED: LegalDocuments = {
  ...LEGAL_DOCUMENTS,
  privacy: { ...LEGAL_DOCUMENTS.privacy, version: PRIVACY_V },
  terms: { ...LEGAL_DOCUMENTS.terms, version: TERMS_V },
  dpa: { ...LEGAL_DOCUMENTS.dpa, version: DPA_V },
};

const BOTH = { terms: true, dpa: true };
const NONE = { terms: false, dpa: false };

describe("wartości w module (flaga wyłączona)", () => {
  it("bez pól akceptacji i bez informacji przy rezerwacji", () => {
    expect(legalAcceptanceForm()).toBeNull();
    expect(bookingLegalNotice()).toBeNull();
  });

  it("formularz można wysłać bez zaznaczeń, a żądanie nie dostaje dodatkowych pól", () => {
    expect(isLegalAcceptanceComplete(legalAcceptanceForm(), NONE)).toBe(true);
    expect(legalAcceptanceRequestFields(legalAcceptanceForm(), NONE, "registration")).toEqual({});
  });
});

describe("legalAcceptanceForm", () => {
  it("flaga wyłączona przy ustawionych wersjach → null", () => {
    expect(legalAcceptanceForm(false, VERSIONED)).toBeNull();
  });

  it("flaga włączona → regulamin i DPA z adresem i wersją z rejestru", () => {
    expect(legalAcceptanceForm(true, VERSIONED)).toEqual({
      terms: { key: "terms", href: "/terms", title: LEGAL_DOCUMENTS.terms.title, version: TERMS_V },
      dpa: { key: "dpa", href: "/dpa", title: LEGAL_DOCUMENTS.dpa.title, version: DPA_V },
    });
  });

  it.each([
    ["regulamin", "terms"],
    ["DPA", "dpa"],
  ] as const)("flaga włączona, %s bez wersji (błąd konfiguracji) → null", (_n, key) => {
    const broken: LegalDocuments = { ...VERSIONED, [key]: { ...VERSIONED[key], version: null } };
    expect(legalAcceptanceForm(true, broken)).toBeNull();
  });

  it("wersje w polach = wersje wymagane przez trasę", () => {
    const form = legalAcceptanceForm(true, VERSIONED);
    expect(form && { terms: form.terms.version, dpa: form.dpa.version }).toEqual(
      requiredLegalVersions(true, VERSIONED)
    );
  });
});

describe("isLegalAcceptanceComplete i legalAcceptanceRequestFields (flaga włączona)", () => {
  const form = legalAcceptanceForm(true, VERSIONED);

  it.each([
    ["nic", NONE],
    ["tylko regulamin", { terms: true, dpa: false }],
    ["tylko DPA", { terms: false, dpa: true }],
  ])("zaznaczone %s → niekompletne, żądanie bez pól", (_n, checks) => {
    expect(isLegalAcceptanceComplete(form, checks)).toBe(false);
    expect(legalAcceptanceRequestFields(form, checks, "registration")).toEqual({});
  });

  it.each(["registration", "create_salon"] as const)(
    "oba zaznaczone, źródło %s → kompletne, wersje z rejestru",
    (source) => {
      expect(isLegalAcceptanceComplete(form, BOTH)).toBe(true);
      expect(legalAcceptanceRequestFields(form, BOTH, source)).toEqual({
        termsVersion: TERMS_V,
        dpaVersion: DPA_V,
        acceptanceSource: source,
      });
    }
  );
});

describe("bookingLegalNotice", () => {
  it("flaga włączona → odnośniki do regulaminu i polityki prywatności", () => {
    expect(bookingLegalNotice(true, VERSIONED)).toEqual({
      terms: { key: "terms", href: "/terms", title: LEGAL_DOCUMENTS.terms.title },
      privacy: { key: "privacy", href: "/privacy", title: LEGAL_DOCUMENTS.privacy.title },
    });
  });

  it("flaga wyłączona → null", () => {
    expect(bookingLegalNotice(false, VERSIONED)).toBeNull();
  });

  it("polityka bez wersji (strona 404) → null, bez odnośnika do niej", () => {
    const broken: LegalDocuments = { ...VERSIONED, privacy: { ...VERSIONED.privacy, version: null } };
    expect(bookingLegalNotice(true, broken)).toBeNull();
  });
});

describe("jedno źródło prawdy z modułem serwera", () => {
  it("kod błędu 400 jest tym samym napisem", () => {
    expect(LEGAL_ACCEPTANCE_REQUIRED_CODE).toBe(SERVER_CODE);
    expect(LEGAL_ACCEPTANCE_REQUIRED_CODE).toBe("LEGAL_ACCEPTANCE_REQUIRED");
  });

  it("źródła akceptacji formularza = źródła przyjmowane przez trasę", () => {
    expectTypeOf<LegalAcceptanceFormSource>().toEqualTypeOf<FormLegalAcceptanceSource>();
  });
});
