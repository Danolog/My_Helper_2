/**
 * Dane strukturalne (JSON-LD) w layoucie głównym `src/app/layout.tsx`.
 *
 * Test czyta tekst źródła layoutu i wycina z niego literał obiektu przypisany
 * do `const jsonLd` (od `const jsonLd = {` do pierwszego `};` na początku
 * linii). Sprawdza, że literał nie podaje ofert ani cen (klucz `offers`,
 * `Offer`, `lowPrice`, `highPrice`, `price`, `PLN`, cyfry), że zostają w nim
 * `"@type": "WebApplication"` i `name: "MyHelper"`, że w pliku są napisy
 * `type="application/ld+json"` i `JSON.stringify(jsonLd)` i że w całym
 * pliku nie ma `AggregateOffer`, `lowPrice` ani `highPrice`.
 *
 * Czego NIE sprawdza: nie renderuje layoutu, nie sprawdza HTML wysyłanego
 * przez serwer — czyta wyłącznie tekst źródła.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const LAYOUT_PATH = "src/app/layout.tsx";
const source = readFileSync(join(process.cwd(), LAYOUT_PATH), "utf8");

// Literał od `const jsonLd = {` do pierwszego `};` na początku linii
// (działa przy końcach linii LF i CRLF). Gdy stałej nie ma — pusty napis.
const JSON_LD_LITERAL = /const jsonLd = \{[\s\S]*?\r?\n\};/;
const jsonLdLiteral = source.match(JSON_LD_LITERAL)?.[0] ?? "";

describe("JSON-LD w src/app/layout.tsx", () => {
  it("w źródle jest niepusty literał obiektu przypisany do const jsonLd", () => {
    expect(jsonLdLiteral).not.toBe("");
    expect(jsonLdLiteral.length).toBeGreaterThan("const jsonLd = {\n};".length);
  });

  it("literał jsonLd nie ma klucza offers", () => {
    expect(jsonLdLiteral).not.toMatch(/\boffers\b/);
  });

  it("literał jsonLd nie zawiera napisów Offer, lowPrice, highPrice, price (ten bez rozróżniania wielkości liter) ani PLN", () => {
    expect(jsonLdLiteral).not.toContain("Offer");
    expect(jsonLdLiteral).not.toContain("lowPrice");
    expect(jsonLdLiteral).not.toContain("highPrice");
    expect(jsonLdLiteral).not.toMatch(/price/i);
    expect(jsonLdLiteral).not.toContain("PLN");
  });

  it("literał jsonLd nie zawiera żadnej cyfry", () => {
    expect(jsonLdLiteral).not.toMatch(/\d/);
  });

  it('literał jsonLd zawiera "@type": "WebApplication" i name: "MyHelper"', () => {
    expect(jsonLdLiteral).toContain('"@type": "WebApplication"');
    expect(jsonLdLiteral).toContain('name: "MyHelper"');
  });

  it('źródło zawiera napisy type="application/ld+json" i JSON.stringify(jsonLd)', () => {
    expect(source).toContain('type="application/ld+json"');
    expect(source).toContain("JSON.stringify(jsonLd)");
  });

  it("cały plik nie zawiera AggregateOffer, lowPrice ani highPrice", () => {
    expect(source).not.toContain("AggregateOffer");
    expect(source).not.toContain("lowPrice");
    expect(source).not.toContain("highPrice");
  });
});
