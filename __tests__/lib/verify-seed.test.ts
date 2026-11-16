// @vitest-environment node
/**
 * Kontrola wyniku seeda (`scripts/verify-seed-checks.ts`, `scripts/verify-seed.ts`, #193 P5b) — bez bazy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEED_PLANS } from "../../scripts/seed-plans";
import {
  checkSeedRows,
  EXPECTED_SEED_USERS,
  VERIFY_SEED_ACCOUNTS_SQL,
  VERIFY_SEED_PLANS_SQL,
  VERIFY_SEED_USERS_SQL,
  type SeedRows,
} from "../../scripts/verify-seed-checks";

const ROOT = join(__dirname, "..", "..");
const code = (file: string) =>
  readFileSync(join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function goodRows(): SeedRows {
  return {
    users: EXPECTED_SEED_USERS.map((u) => ({ id: u.id, email: u.email, email_verified: true, role: u.role })),
    accounts: EXPECTED_SEED_USERS.map((u) => ({ user_id: u.id, provider_id: "credential", has_password: true })),
    plans: SEED_PLANS.map((p) => ({ slug: p.slug, name: p.name, price_monthly: p.priceMonthly, is_active: true })),
  };
}

describe("checkSeedRows", () => {
  it("poprawny seed → ok, bez problemów", () => {
    expect(checkSeedRows(goodRows())).toEqual({ ok: true, problems: [] });
  });

  it("cena jako numeric bez zer końcowych też zgodna", () => {
    const rows = goodRows();
    rows.plans = rows.plans.map((p) => ({ ...p, price_monthly: String(Number(p.price_monthly)) }));
    expect(checkSeedRows(rows).ok).toBe(true);
  });

  type Case = [string, (r: SeedRows) => SeedRows, RegExp];
  const cases: Case[] = [
    ["brak użytkownika owner", (r) => ({ ...r, users: r.users.filter((u) => u.email !== "owner@test.com") }), /użytkownik owner: brak/],
    ["e-mail niezweryfikowany", (r) => ({ ...r, users: r.users.map((u) => ({ ...u, email_verified: false })) }), /niezweryfikowany/],
    ["zła rola", (r) => ({ ...r, users: r.users.map((u) => (u.email === "client@test.com" ? { ...u, role: "owner" } : u)) }), /użytkownik client: rola niezgodna/],
    ["inne id użytkownika", (r) => ({ ...r, users: r.users.map((u) => (u.email === "owner@test.com" ? { ...u, id: "obcy-id-123" } : u)) }), /użytkownik owner: identyfikator niezgodny/],
    ["konto bez hasła", (r) => ({ ...r, accounts: r.accounts.map((a) => ({ ...a, has_password: false })) }), /bez hasła/],
    ["brak konta credential", (r) => ({ ...r, accounts: r.accounts.filter((a) => a.user_id !== EXPECTED_SEED_USERS[1].id) }), /użytkownik client: kont credential 0/],
    ["konto innego dostawcy zamiast credential", (r) => ({ ...r, accounts: r.accounts.map((a) => ({ ...a, provider_id: "google" })) }), /kont credential 0/],
    ["dwa konta credential", (r) => ({ ...r, accounts: [...r.accounts, r.accounts[0]!] }), /użytkownik owner: kont credential 2/],
    ["trzeci plan w tabeli", (r) => ({ ...r, plans: [...r.plans, { slug: "enterprise", name: "E", price_monthly: "1", is_active: true }] }), /planów w tabeli 3, oczekiwane dokładnie 2/],
    ["brak planu pro", (r) => ({ ...r, plans: r.plans.filter((p) => p.slug !== "pro") }), /plan pro: brak/],
    ["pusta tabela planów", (r) => ({ ...r, plans: [] }), /planów w tabeli 0/],
    ["plan nieaktywny", (r) => ({ ...r, plans: r.plans.map((p) => ({ ...p, is_active: false })) }), /nieaktywny/],
    ["zła cena", (r) => ({ ...r, plans: r.plans.map((p) => (p.slug === "basic" ? { ...p, price_monthly: "59.00" } : p)) }), /plan basic: cena niezgodna/],
    ["zła nazwa", (r) => ({ ...r, plans: r.plans.map((p) => (p.slug === "pro" ? { ...p, name: "Premium" } : p)) }), /plan pro: nazwa niezgodna/],
  ];

  it.each(cases)("%s → nie ok, z konkretnym problemem", (_label, mutate, problem) => {
    const result = checkSeedRows(mutate(goodRows()));
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toMatch(problem);
  });

  // Komunikaty: tylko nazwa kontroli i liczby — żadnych e-maili, identyfikatorów ani wartości z bazy.
  const LEAK_MARKERS = ["@", "test-owner", "test-client", "obcy-id-123", "Premium", "59.00", "enterprise", "google"];
  it.each(cases)("%s → komunikat bez wartości z bazy", (_label, mutate) => {
    const text = checkSeedRows(mutate(goodRows())).problems.join("\n");
    for (const marker of LEAK_MARKERS) expect(text).not.toContain(marker);
  });
});

describe("zapytania i zgodność ze seedem", () => {
  it("z tabeli account czytany tylko znacznik hasła, nie hasło", () => {
    expect(VERIFY_SEED_ACCOUNTS_SQL).toMatch(/\(password is not null\) as has_password/);
    expect(VERIFY_SEED_ACCOUNTS_SQL.replace("(password is not null) as has_password", "")).not.toMatch(/password/);
  });

  it("zapytania tylko do odczytu", () => {
    for (const q of [VERIFY_SEED_USERS_SQL, VERIFY_SEED_ACCOUNTS_SQL, VERIFY_SEED_PLANS_SQL]) {
      expect(q).toMatch(/^select /);
      expect(q).not.toMatch(/\b(insert|update|delete|truncate|drop|alter|grant)\b/i);
    }
  });

  it("plany czytane bez filtra — liczba dotyczy całej tabeli", () => {
    expect(VERIFY_SEED_PLANS_SQL).not.toMatch(/\bwhere\b/i);
  });

  it("oczekiwani użytkownicy to ci sami, których zakłada seed-test.ts", () => {
    const seed = code("scripts/seed-test.ts");
    for (const u of EXPECTED_SEED_USERS) {
      expect(seed).toContain(`"${u.id}"`);
      expect(seed).toContain(`email: "${u.email}"`);
      expect(seed).toContain(`role: "${u.role}"`);
    }
  });

  it("verify-seed.ts używa strażnika bazy seeda przed zapytaniami", () => {
    const src = code("scripts/verify-seed.ts");
    const guard = src.indexOf("checkSeedServerIdentity(");
    expect(src.indexOf("checkSeedTarget(")).toBeGreaterThan(-1);
    expect(src.indexOf("checkSeedClientOptions(")).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);
    for (const q of ["VERIFY_SEED_USERS_SQL)", "VERIFY_SEED_ACCOUNTS_SQL)", "VERIFY_SEED_PLANS_SQL)"]) {
      expect(src.indexOf(q)).toBeGreaterThan(guard);
    }
  });

  it("verify-seed.ts wypisuje tylko kody odmowy, nazwy kontroli i liczby", () => {
    const src = code("scripts/verify-seed.ts");
    // `reason` strażnika może zawierać host i nazwę bazy — wypisywany tylko `code`.
    expect(src).not.toMatch(/\.reason\b/);
    const printed = src.split("\n").filter((l) => /console\.(log|error|warn|info)\(/.test(l));
    expect(printed.length).toBeGreaterThan(0);
    for (const line of printed) {
      expect(line).not.toMatch(/connectionString|POSTGRES_URL\b(?! jest wymagany)/);
      expect(line.replace("err.name", "")).not.toMatch(/\.(email|slug|name|id|user_id|message|stack)\b/);
    }
  });
});
