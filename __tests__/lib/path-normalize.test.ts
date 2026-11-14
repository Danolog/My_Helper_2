/**
 * Postać ścieżki żądania przed decyzjami w proxy (`src/lib/path-normalize.ts`).
 *
 * Router Next i nasza bramka nie mogą różnie czytać tej samej ścieżki. Dlatego:
 * - ścieżka DWUZNACZNA (zakodowany separator, zakodowana kropka, podwójne
 *   kodowanie, błędne kodowanie procentowe) jest odrzucana z góry,
 * - wzorce rejestru sprawdza się na dwóch postaciach kanonicznych: dosłownej
 *   (bez dekodowania) i zdekodowanej.
 */
import { describe, it, expect } from "vitest";
import {
  decodedCanonicalPath,
  isAmbiguousPath,
  literalCanonicalPath,
} from "@/lib/path-normalize";

describe("isAmbiguousPath — odmowa z góry", () => {
  it.each([
    // zakodowany ukośnik i odwrócony ukośnik, dowolna wielkość liter
    "/api%2finvoices",
    "/api%2Finvoices",
    "/api/x/..%2finvoices",
    "/api%5cinvoices",
    "/api%5Cinvoices",
    // dosłowny odwrócony ukośnik
    "/api\\invoices",
    // zakodowana kropka
    "/api/x/%2e%2e/invoices",
    "/api/x/%2E%2E/invoices",
    "/api/%2e/invoices",
    "/api/x/.%2e/invoices",
    // podwójne kodowanie
    "/api%252finvoices",
    "/api/x/%252e%252e/invoices",
    "/api/%2569nvoices",
    "/api/%25252finvoices",
    // bajt zerowy
    "/api/invoices%00",
    // błędne kodowanie procentowe
    "/api/%zz",
    "/api/invoices%",
    "/api/invoices%2",
    "/api/%C5",
    "/api/%E0%A4%A",
  ])("%s → dwuznaczna", (path) => {
    expect(isAmbiguousPath(path)).toBe(true);
  });

  it.each([
    "/",
    "/api/invoices",
    "//api//invoices/",
    "/api/x/../invoices",
    "/api/./invoices",
    "/API/Invoices",
    // litera zakodowana procentowo to nie struktura
    "/api/%69nvoices",
    "/%61pi/invoices",
    // polskie znaki, spacja, inne znaki zakodowane poprawnie
    "/salons/%C5%82ukasz",
    "/dashboard/clients/Jan%20Kowalski",
    "/salons/%C5%BB%C3%B3%C5%82ty-salon",
    "/a%2Db/c%40d",
    // dosłowny znak procentu (zakodowany raz)
    "/search/100%25",
    "/_next/static/chunks/app/dashboard/clients/%5Bid%5D/page.js",
  ])("%s → jednoznaczna", (path) => {
    expect(isAmbiguousPath(path)).toBe(false);
  });
});

describe("literalCanonicalPath — bez dekodowania", () => {
  it.each<[string, string]>([
    ["/api/invoices", "/api/invoices"],
    ["/api/invoices/", "/api/invoices"],
    ["//api//invoices///abc", "/api/invoices/abc"],
    ["/api/./invoices", "/api/invoices"],
    ["/api/x/../invoices", "/api/invoices"],
    ["/../../api/invoices", "/api/invoices"],
    ["/api/invoices/..", "/api"],
    ["/api\\invoices", "/api/invoices"],
    ["/API/Invoices", "/api/invoices"],
    // nic zakodowanego nie staje się strukturą ani literą
    ["/api/%69nvoices", "/api/%69nvoices"],
    ["/api%2Finvoices", "/api%2finvoices"],
    ["/api/x/%2e%2e/invoices", "/api/x/%2e%2e/invoices"],
    ["/api/x/..%2finvoices", "/api/x/..%2finvoices"],
    ["/api/%zz", "/api/%zz"],
    ["", "/"],
  ])("%s → %s", (raw, expected) => {
    expect(literalCanonicalPath(raw)).toBe(expected);
  });
});

describe("decodedCanonicalPath — po zdekodowaniu", () => {
  it.each<[string, string]>([
    ["/api/invoices", "/api/invoices"],
    ["/api/invoices/", "/api/invoices"],
    ["//api/invoices", "/api/invoices"],
    ["/api//invoices///abc", "/api/invoices/abc"],
    ["/api/./invoices", "/api/invoices"],
    ["/api/x/../invoices", "/api/invoices"],
    ["/api/x/y/../../invoices/abc", "/api/invoices/abc"],
    ["/../../api/invoices", "/api/invoices"],
    ["/api/invoices/..", "/api"],
    ["/api/%69nvoices", "/api/invoices"],
    ["/%61pi/invoices", "/api/invoices"],
    ["/api/x/%2e%2e/invoices", "/api/invoices"],
    ["/api/x/%2E%2E/invoices", "/api/invoices"],
    ["/api/x/..%2finvoices", "/api/invoices"],
    ["/api%2Finvoices", "/api/invoices"],
    ["/api%5Cinvoices", "/api/invoices"],
    ["/api\\invoices", "/api/invoices"],
    ["/API/Invoices", "/api/invoices"],
    // błędne kodowanie w jednym miejscu nie wyłącza dekodowania reszty
    ["/api/%69nvoices/%zz", "/api/invoices/%zz"],
    ["/api/%69nvoices/%E0%A4%A", "/api/invoices/%e0%a4%a"],
    ["/api/%zz", "/api/%zz"],
    ["/salons/%C5%82ukasz", "/salons/łukasz"],
    ["", "/"],
  ])("%s → %s", (raw, expected) => {
    expect(decodedCanonicalPath(raw)).toBe(expected);
  });

  it("obie postaci są idempotentne dla ścieżek kanonicznych", () => {
    for (const path of ["/api/invoices", "/api/clients/x1/loyalty/redeem", "/dashboard", "/"]) {
      expect(literalCanonicalPath(path)).toBe(path);
      expect(decodedCanonicalPath(path)).toBe(path);
      expect(decodedCanonicalPath(decodedCanonicalPath(path))).toBe(path);
    }
  });
});
