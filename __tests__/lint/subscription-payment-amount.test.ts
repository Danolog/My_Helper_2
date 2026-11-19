// @vitest-environment node
// Skan tekstu wszystkich plików `.ts` i `.tsx` w katalogu `src` (z podkatalogami).
// Plik zapisujący wpis płatności = jego tekst zawiera `insert(subscriptionPayments)`
// (dopuszczalne białe znaki wewnątrz nawiasu). Sprawdzane:
// - skan znajduje co najmniej jeden taki plik,
// - każdy taki plik (a) nie zawiera tekstu `priceMonthly`,
//   (b) zawiera tekst `stripeAmountToColumns(`, (c) nie zawiera tekstu `currency: "PLN"`.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const PAYMENT_INSERT = /insert\(\s*subscriptionPayments\s*\)/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const writers: [string, string][] = walk(path.join(ROOT, "src"))
  .map((abs): [string, string] => [path.relative(ROOT, abs).split(path.sep).join("/"), fs.readFileSync(abs, "utf8")])
  .filter(([, text]) => PAYMENT_INSERT.test(text));

describe("pliki src zawierające insert(subscriptionPayments)", () => {
  it("skan src: co najmniej jeden plik .ts/.tsx zawiera insert(subscriptionPayments)", () => {
    expect(writers.length).toBeGreaterThan(0);
  });

  it.each(writers)("%s: nie zawiera tekstu priceMonthly", (file, text) => {
    expect(text.includes("priceMonthly"), `${file} zawiera tekst priceMonthly`).toBe(false);
  });

  it.each(writers)("%s: zawiera tekst stripeAmountToColumns(", (file, text) => {
    expect(text.includes("stripeAmountToColumns("), `${file} nie zawiera tekstu stripeAmountToColumns(`).toBe(true);
  });

  it.each(writers)('%s: nie zawiera tekstu currency: "PLN"', (file, text) => {
    expect(text.includes('currency: "PLN"'), `${file} zawiera tekst currency: "PLN"`).toBe(false);
  });
});
