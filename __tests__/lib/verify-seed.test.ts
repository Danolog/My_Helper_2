// @vitest-environment node
/**
 * Kontrola wyniku seeda (`scripts/verify-seed-checks.ts`, `scripts/verify-seed.ts`, #193 P5b) — bez bazy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEED_SERVER_PROBE_SQL } from "../../scripts/seed-host-guard";
import { SEED_PLANS } from "../../scripts/seed-plans";
import {
  checkSeedRows,
  EXPECTED_SEED_USERS,
  runVerifySeed,
  SEED_SALON_IDS,
  VERIFY_SEED_ACCOUNTS_SQL,
  VERIFY_SEED_PLANS_SQL,
  VERIFY_SEED_SUBSCRIPTIONS_SQL,
  VERIFY_SEED_USERS_SQL,
  type SeedRows,
  type SeedSubscriptionRow,
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
    plans: SEED_PLANS.map((p) => ({ slug: p.slug, name: p.name, price_monthly: p.priceMonthly, is_active: true, features_json: [...p.featuresJson] })),
    subscriptions: [
      subRow(SEED_SALON_IDS.test, { status: "active" }),
      subRow(SEED_SALON_IDS.trialExpired, { status: "trialing", trial_ends_at: PAST }),
    ],
  };
}

/** Chwila kontroli podawana z zewnątrz i daty fikcyjne względem niej. */
const NOW = new Date("2020-06-01T12:00:00.000Z");
const PAST = new Date("2020-01-01T00:00:00.000Z");
const FUTURE = new Date("2020-07-01T00:00:00.000Z");

function subRow(salonId: string, over: Partial<SeedSubscriptionRow>): SeedSubscriptionRow {
  return {
    salon_id: salonId,
    status: "active",
    plan_slug: "basic",
    trial_ends_at: null,
    current_period_start: null,
    current_period_end: null,
    created_at: PAST,
    ...over,
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
    ["trzeci plan w tabeli", (r) => ({ ...r, plans: [...r.plans, { slug: "enterprise", name: "E", price_monthly: "1", is_active: true, features_json: [] }] }), /planów w tabeli 3, oczekiwane dokładnie 2/],
    ["brak planu pro", (r) => ({ ...r, plans: r.plans.filter((p) => p.slug !== "pro") }), /plan pro: brak/],
    ["pusta tabela planów", (r) => ({ ...r, plans: [] }), /planów w tabeli 0/],
    ["plan nieaktywny", (r) => ({ ...r, plans: r.plans.map((p) => ({ ...p, is_active: false })) }), /nieaktywny/],
    ["zła cena", (r) => ({ ...r, plans: r.plans.map((p) => (p.slug === "basic" ? { ...p, price_monthly: "59.00" } : p)) }), /plan basic: cena niezgodna/],
    ["zła nazwa", (r) => ({ ...r, plans: r.plans.map((p) => (p.slug === "pro" ? { ...p, name: "Premium" } : p)) }), /plan pro: nazwa niezgodna/],
    // Przy ON CONFLICT DO NOTHING ponowny seed nie wyrównuje listy funkcji — wykrywa to tylko ta kontrola.
    ["brak funkcji", (r) => ({ ...r, plans: r.plans.map((p) => (p.slug === "basic" ? { ...p, features_json: (p.features_json as string[]).slice(0, -1) } : p)) }), /plan basic: funkcje niezgodne/],
    ["funkcja dodatkowa", (r) => ({ ...r, plans: r.plans.map((p) => (p.slug === "pro" ? { ...p, features_json: [...(p.features_json as string[]), "funkcja-obca"] } : p)) }), /plan pro: funkcje niezgodne/],
    ["zmieniona kolejność funkcji", (r) => ({ ...r, plans: r.plans.map((p) => (p.slug === "pro" ? { ...p, features_json: [...(p.features_json as string[])].reverse() } : p)) }), /plan pro: funkcje niezgodne/],
    ["funkcje nie są tablicą", (r) => ({ ...r, plans: r.plans.map((p) => (p.slug === "basic" ? { ...p, features_json: null } : p)) }), /plan basic: funkcje niezgodne/],
  ];

  it("plany mają po co najmniej 2 różne funkcje (przypadek kolejności ma sens)", () => {
    for (const p of SEED_PLANS) expect(new Set(p.featuresJson).size).toBeGreaterThan(1);
  });

  it.each(cases)("%s → nie ok, z konkretnym problemem", (_label, mutate, problem) => {
    const result = checkSeedRows(mutate(goodRows()));
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toMatch(problem);
  });

  // Komunikaty: tylko nazwa kontroli i liczby — żadnych e-maili, identyfikatorów ani wartości z bazy.
  const LEAK_MARKERS = ["@", "test-owner", "test-client", "obcy-id-123", "Premium", "59.00", "enterprise", "google", "funkcja-obca", ...SEED_PLANS.flatMap((p) => p.featuresJson)];
  it.each(cases)("%s → komunikat bez wartości z bazy", (_label, mutate) => {
    const text = checkSeedRows(mutate(goodRows())).problems.join("\n");
    for (const marker of LEAK_MARKERS) expect(text).not.toContain(marker);
  });

  // Drugi właściciel (salon po okresie próbnym): etykieta inna niż pierwszego, bez e-maila i identyfikatora.
  const secondOwner = () => EXPECTED_SEED_USERS[2];
  const secondOwnerCases: Case[] = [
    ["brak drugiego właściciela", (r) => ({ ...r, users: r.users.filter((u) => u.email !== secondOwner().email) }), /użytkownik owner \(salon po okresie próbnym\): brak/],
    ["drugi właściciel niezweryfikowany", (r) => ({ ...r, users: r.users.map((u) => (u.email === secondOwner().email ? { ...u, email_verified: false } : u)) }), /użytkownik owner \(salon po okresie próbnym\): e-mail niezweryfikowany/],
    ["drugi właściciel bez konta credential", (r) => ({ ...r, accounts: r.accounts.filter((a) => a.user_id !== secondOwner().id) }), /użytkownik owner \(salon po okresie próbnym\): kont credential 0/],
  ];
  it.each(secondOwnerCases)("%s → problem z etykietą drugiego właściciela", (_label, mutate, problem) => {
    const result = checkSeedRows(mutate(goodRows()), NOW);
    expect(result.ok).toBe(false);
    const text = result.problems.join("\n");
    expect(text).toMatch(problem);
    expect(text).not.toMatch(/użytkownik owner:/);
    for (const marker of LEAK_MARKERS) expect(text).not.toContain(marker);
  });
});

describe("checkSeedRows — subskrypcje salonów seeda (dostęp liczony resolveSalonAccess w podanej chwili)", () => {
  const forSalon = (r: SeedRows, salonId: string, rows: SeedSubscriptionRow[]): SeedRows => ({
    ...r,
    subscriptions: [...r.subscriptions.filter((s) => s.salon_id !== salonId), ...rows],
  });
  const T = SEED_SALON_IDS.test;
  const E = SEED_SALON_IDS.trialExpired;

  it("poprawny seed z wierszami subskrypcji → ok w podanej chwili", () => {
    expect(checkSeedRows(goodRows(), NOW)).toEqual({ ok: true, problems: [] });
  });

  it("granica: koniec okresu próbnego równy chwili kontroli → expired (termin wyłączny) → ok", () => {
    const rows = forSalon(goodRows(), E, [subRow(E, { status: "trialing", trial_ends_at: new Date(NOW.getTime()) })]);
    expect(checkSeedRows(rows, NOW)).toEqual({ ok: true, problems: [] });
  });

  type SubCase = [string, (r: SeedRows) => SeedRows, RegExp];
  const subCases: SubCase[] = [
    ["salon testowy: brak wiersza", (r) => forSalon(r, T, []), /subskrypcja salonu testowego: wierszy 0, oczekiwany 1/],
    ["salon testowy: dwa wiersze", (r) => forSalon(r, T, [subRow(T, {}), subRow(T, {})]), /subskrypcja salonu testowego: wierszy 2, oczekiwany 1/],
    ["salon testowy: trialing po terminie", (r) => forSalon(r, T, [subRow(T, { status: "trialing", trial_ends_at: PAST })]), /subskrypcja salonu testowego: dostęp read_only, oczekiwany full/],
    ["salon testowy: canceled", (r) => forSalon(r, T, [subRow(T, { status: "canceled" })]), /subskrypcja salonu testowego: dostęp read_only, oczekiwany full/],
    ["salon testowy: active z planem pro", (r) => forSalon(r, T, [subRow(T, { plan_slug: "pro" })]), /subskrypcja salonu testowego: plan niezgodny/],
    ["salon po okresie próbnym: brak wiersza", (r) => forSalon(r, E, []), /subskrypcja salonu po okresie próbnym: wierszy 0, oczekiwany 1/],
    ["salon po okresie próbnym: trialing z terminem w przyszłości", (r) => forSalon(r, E, [subRow(E, { status: "trialing", trial_ends_at: FUTURE })]), /subskrypcja salonu po okresie próbnym: dostęp full, oczekiwany read_only/],
    ["salon po okresie próbnym: active", (r) => forSalon(r, E, [subRow(E, { status: "active" })]), /subskrypcja salonu po okresie próbnym: dostęp full, oczekiwany read_only/],
  ];

  it.each(subCases)("%s → nie ok, z konkretnym problemem", (_label, mutate, problem) => {
    const result = checkSeedRows(mutate(goodRows()), NOW);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toMatch(problem);
  });

  // Komunikaty: bez identyfikatorów salonów, adresów e-mail i dat.
  const SUB_LEAK_MARKERS = [SEED_SALON_IDS.test, SEED_SALON_IDS.trialExpired, "@", "2020", "T00:00", "T12:00"];
  it.each(subCases)("%s → komunikat bez identyfikatorów, adresów i dat", (_label, mutate) => {
    const text = checkSeedRows(mutate(goodRows()), NOW).problems.join("\n");
    expect(text.length).toBeGreaterThan(0);
    for (const marker of SUB_LEAK_MARKERS) expect(text).not.toContain(marker);
  });
});

describe("zapytania i zgodność ze seedem", () => {
  it("z tabeli account czytany tylko znacznik hasła, nie hasło", () => {
    expect(VERIFY_SEED_ACCOUNTS_SQL).toMatch(/\(password is not null\) as has_password/);
    expect(VERIFY_SEED_ACCOUNTS_SQL.replace("(password is not null) as has_password", "")).not.toMatch(/password/);
  });

  it("zapytania tylko do odczytu", () => {
    for (const q of [VERIFY_SEED_USERS_SQL, VERIFY_SEED_ACCOUNTS_SQL, VERIFY_SEED_PLANS_SQL, VERIFY_SEED_SUBSCRIPTIONS_SQL]) {
      expect(q).toMatch(/^select /);
      expect(q).not.toMatch(/\b(insert|update|delete|truncate|drop|alter|grant)\b/i);
    }
  });

  it("plany czytane bez filtra — liczba dotyczy całej tabeli", () => {
    expect(VERIFY_SEED_PLANS_SQL).not.toMatch(/\bwhere\b/i);
  });

  it("zapytanie o plany czyta listę funkcji", () => {
    expect(VERIFY_SEED_PLANS_SQL).toMatch(/\bfeatures_json\b/);
  });

  it("oczekiwani użytkownicy to ci sami, których zakłada seed-test.ts", () => {
    const seed = code("scripts/seed-test.ts");
    for (const u of EXPECTED_SEED_USERS) {
      expect(seed).toContain(`"${u.id}"`);
      expect(seed).toContain(`email: "${u.email}"`);
      expect(seed).toContain(`role: "${u.role}"`);
    }
  });

  it("zapytanie o subskrypcje filtruje po obu identyfikatorach salonów seeda i czyta kolumny dostępu", () => {
    const where = VERIFY_SEED_SUBSCRIPTIONS_SQL.slice(VERIFY_SEED_SUBSCRIPTIONS_SQL.search(/\bwhere\b/i));
    expect(where).toMatch(/^where /);
    expect(where).toContain(`'${SEED_SALON_IDS.test}'`);
    expect(where).toContain(`'${SEED_SALON_IDS.trialExpired}'`);
    expect(where).not.toMatch(/\bor\b/i);
    for (const col of ["status", "slug", "trial_ends_at", "current_period_start", "current_period_end", "created_at"]) {
      expect(VERIFY_SEED_SUBSCRIPTIONS_SQL).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it("salony, statusy subskrypcji i usuwanie wierszy subskrypcji zgodne z seed-test.ts", () => {
    const seed = code("scripts/seed-test.ts");
    expect(seed).toContain(`const SALON_ID = "${SEED_SALON_IDS.test}";`);
    expect(seed).toContain(`const TRIAL_EXPIRED_SALON_ID = "${SEED_SALON_IDS.trialExpired}";`);
    expect(seed).toMatch(/salonId: SALON_ID,\s*status: "active",/);
    expect(seed).toMatch(/salonId: TRIAL_EXPIRED_SALON_ID,\s*status: "trialing",/);
    // Każde usuwanie w seedzie dotyczy wyłącznie wierszy subskrypcji dwóch salonów seeda.
    const deletes = seed.match(/\.delete\(/g) ?? [];
    const scoped =
      seed.match(/\.delete\(salonSubscriptions\)\s*\.where\(\s*and\(\s*inArray\(salonSubscriptions\.salonId, \[SALON_ID, TRIAL_EXPIRED_SALON_ID\]\),/g) ?? [];
    expect(deletes.length).toBeGreaterThan(0);
    expect(scoped.length).toBe(deletes.length);
  });

  it("verify-seed.ts tylko podpina klienta, wyjście i kod wyjścia — logika w runVerifySeed", () => {
    const src = code("scripts/verify-seed.ts");
    expect(src).toMatch(/runVerifySeed\(/);
    expect(src).not.toMatch(/\.unsafe\(|\$\{/);
  });
});

/** Klient postgres zastąpiony atrapą o tym samym kształcie: zapisuje zapytania, odpowiada wierszami. */
function fakeDb(opts: {
  host?: string[];
  path?: string | false;
  probe?: unknown[];
  rows?: SeedRows;
  failOn?: string;
} = {}) {
  const queries: string[] = [];
  let ended = 0;
  const rows = opts.rows ?? goodRows();
  const client = {
    options: { host: opts.host ?? ["localhost"], path: opts.path ?? false },
    unsafe: async (q: string): Promise<readonly unknown[]> => {
      queries.push(q);
      if (q === opts.failOn) throw new Error(`connect ECONNREFUSED ${SECRET_URL} owner@test.com`);
      if (q === SEED_SERVER_PROBE_SQL) return opts.probe ?? [{ database: "pos_dev", neon_settings: 0 }];
      if (q === VERIFY_SEED_USERS_SQL) return rows.users;
      if (q === VERIFY_SEED_ACCOUNTS_SQL) return rows.accounts;
      if (q === VERIFY_SEED_PLANS_SQL) return rows.plans;
      if (q === VERIFY_SEED_SUBSCRIPTIONS_SQL) return rows.subscriptions;
      throw new Error("nieoczekiwane zapytanie");
    },
    end: async () => {
      ended++;
    },
  };
  return { client, queries, ended: () => ended };
}

const SECRET_URL = "postgres://tajny-uzytkownik:tajne-haslo@localhost:5432/pos_dev";
const REMOTE_URL = "postgres://tajny-uzytkownik:tajne-haslo@zdalny-host.example.net:5432/pos_dev";
const DATA_QUERIES = [VERIFY_SEED_USERS_SQL, VERIFY_SEED_ACCOUNTS_SQL, VERIFY_SEED_PLANS_SQL, VERIFY_SEED_SUBSCRIPTIONS_SQL];

async function run(env: { POSTGRES_URL?: string; VERCEL_ENV?: string }, db: ReturnType<typeof fakeDb>) {
  const out: string[] = [];
  let connects = 0;
  const code = await runVerifySeed({
    env,
    connect: () => {
      connects++;
      return db.client;
    },
    log: (line) => out.push(`log ${line}`),
    error: (line) => out.push(`err ${line}`),
  });
  return { code, out, connects };
}

describe("runVerifySeed — odmowa strażnika przerywa przed zapytaniami o dane", () => {
  it("etap 1 (napis URL spoza listy hostów): kod 1, klient nie powstaje", async () => {
    const db = fakeDb();
    const r = await run({ POSTGRES_URL: REMOTE_URL }, db);
    expect(r).toMatchObject({ code: 1, connects: 0 });
    expect(db.queries).toEqual([]);
    expect(r.out).toEqual(["err [verify-seed] Odmowa: host_not_allowed"]);
  });

  it("etap 1 (brak POSTGRES_URL): kod 1, klient nie powstaje", async () => {
    const db = fakeDb();
    const r = await run({}, db);
    expect(r).toMatchObject({ code: 1, connects: 0 });
    expect(r.out).toEqual(["err [verify-seed] Odmowa: missing_url"]);
  });

  it("etap 2 (host wyliczony przez klienta spoza listy): kod 1, zero zapytań, klient zamknięty", async () => {
    const db = fakeDb({ host: ["zdalny-host.example.net"] });
    const r = await run({ POSTGRES_URL: SECRET_URL }, db);
    expect(r.code).toBe(1);
    expect(db.queries).toEqual([]);
    expect(db.ended()).toBeGreaterThan(0);
    expect(r.out).toEqual(["err [verify-seed] Odmowa: host_not_allowed"]);
  });

  it("etap 3 (serwer to inna baza — tunel): kod 1, tylko sonda, bez zapytań o dane", async () => {
    const db = fakeDb({ probe: [{ database: "pos_reset_test", neon_settings: 0 }] });
    const r = await run({ POSTGRES_URL: SECRET_URL }, db);
    expect(r.code).toBe(1);
    expect(db.queries).toEqual([SEED_SERVER_PROBE_SQL]);
    expect(db.ended()).toBeGreaterThan(0);
    expect(r.out).toEqual(["err [verify-seed] Odmowa: database_not_allowed"]);
  });

  it("etap 3 (serwer Neon): kod 1, tylko sonda", async () => {
    const db = fakeDb({ probe: [{ database: "pos_dev", neon_settings: 3 }] });
    const r = await run({ POSTGRES_URL: SECRET_URL }, db);
    expect(r.code).toBe(1);
    expect(db.queries).toEqual([SEED_SERVER_PROBE_SQL]);
    expect(r.out).toEqual(["err [verify-seed] Odmowa: neon"]);
  });
});

describe("runVerifySeed — przebieg i wyjście", () => {
  it("poprawny seed: kod 0, sonda przed zapytaniami o dane, jedna linia z liczbami", async () => {
    const db = fakeDb();
    const r = await run({ POSTGRES_URL: SECRET_URL }, db);
    expect(r.code).toBe(0);
    expect(db.queries).toEqual([SEED_SERVER_PROBE_SQL, ...DATA_QUERIES]);
    expect(db.ended()).toBeGreaterThan(0);
    expect(r.out).toEqual(["log [verify-seed] OK: użytkownicy testowi 3, konta credential 3, plany 2, subskrypcje 2"]);
  });

  it("chwila kontroli z deps.now: trial salonu po okresie próbnym jeszcze trwa → kod 1", async () => {
    const rows = goodRows();
    rows.subscriptions = rows.subscriptions.map((s) =>
      s.salon_id === SEED_SALON_IDS.trialExpired ? { ...s, trial_ends_at: FUTURE } : s,
    );
    const out: string[] = [];
    const code = await runVerifySeed({
      env: { POSTGRES_URL: SECRET_URL },
      connect: () => fakeDb({ rows }).client,
      now: () => NOW,
      log: (line) => out.push(`log ${line}`),
      error: (line) => out.push(`err ${line}`),
    });
    expect(code).toBe(1);
    expect(out).toContain("err [verify-seed] subskrypcja salonu po okresie próbnym: dostęp full, oczekiwany read_only");
  });

  it("niezgodność subskrypcji: kod 1, problem w osobnej linii", async () => {
    const rows = goodRows();
    rows.subscriptions = rows.subscriptions.filter((s) => s.salon_id !== SEED_SALON_IDS.test);
    const db = fakeDb({ rows });
    const r = await run({ POSTGRES_URL: SECRET_URL }, db);
    expect(r.code).toBe(1);
    expect(db.queries).toEqual([SEED_SERVER_PROBE_SQL, ...DATA_QUERIES]);
    expect(r.out).toEqual(["err [verify-seed] subskrypcja salonu testowego: wierszy 0, oczekiwany 1"]);
  });

  it("niezgodność: kod 1, każdy problem w osobnej linii", async () => {
    const rows = goodRows();
    rows.plans = rows.plans.filter((p) => p.slug !== "pro");
    const db = fakeDb({ rows });
    const r = await run({ POSTGRES_URL: SECRET_URL }, db);
    expect(r.code).toBe(1);
    expect(r.out).toEqual([
      "err [verify-seed] planów w tabeli 1, oczekiwane dokładnie 2",
      "err [verify-seed] plan pro: brak",
    ]);
  });

  it("błąd zapytania: kod 1, tylko nazwa klasy błędu, klient zamknięty", async () => {
    const db = fakeDb({ failOn: VERIFY_SEED_ACCOUNTS_SQL });
    const r = await run({ POSTGRES_URL: SECRET_URL }, db);
    expect(r.code).toBe(1);
    expect(db.ended()).toBeGreaterThan(0);
    expect(r.out).toEqual(["err [verify-seed] Błąd: Error"]);
  });

  it("błąd sondy: kod 1, tylko nazwa klasy błędu, bez zapytań o dane", async () => {
    const db = fakeDb({ failOn: SEED_SERVER_PROBE_SQL });
    const r = await run({ POSTGRES_URL: SECRET_URL }, db);
    expect(r.code).toBe(1);
    expect(db.queries).toEqual([SEED_SERVER_PROBE_SQL]);
    expect(r.out).toEqual(["err [verify-seed] Błąd: Error"]);
  });

  // Całe przechwycone wyjście (nie linie źródła): bez adresu bazy, hosta, nazwy bazy,
  // użytkownika/hasła z URL, e-maili, identyfikatorów i wartości z bazy.
  const OUTPUT_LEAKS = [
    "@", "tajne-haslo", "tajny-uzytkownik", "zdalny-host", "pos_reset_test", "pos_dev", "localhost",
    "test-owner", "test-client", "ECONNREFUSED", "funkcja-obca", "59.00",
    SEED_SALON_IDS.test, SEED_SALON_IDS.trialExpired, "2020",
  ];
  const scenarios: Array<[string, () => Promise<{ out: string[] }>]> = [
    ["etap 1", () => run({ POSTGRES_URL: REMOTE_URL }, fakeDb())],
    ["etap 2", () => run({ POSTGRES_URL: SECRET_URL }, fakeDb({ host: ["zdalny-host.example.net"] }))],
    ["etap 3", () => run({ POSTGRES_URL: SECRET_URL }, fakeDb({ probe: [{ database: "pos_reset_test", neon_settings: 0 }] }))],
    ["sukces", () => run({ POSTGRES_URL: SECRET_URL }, fakeDb())],
    ["błąd zapytania", () => run({ POSTGRES_URL: SECRET_URL }, fakeDb({ failOn: VERIFY_SEED_USERS_SQL }))],
    ["niezgodne wiersze", () => {
      const rows = goodRows();
      rows.users = rows.users.map((u) => ({ ...u, id: "obcy-id-123", role: "admin" }));
      rows.plans = rows.plans.map((p) => ({ ...p, price_monthly: "59.00", features_json: ["funkcja-obca"] }));
      rows.subscriptions = rows.subscriptions.map((s) => ({ ...s, status: "canceled" }));
      return run({ POSTGRES_URL: SECRET_URL }, fakeDb({ rows }));
    }],
  ];
  it.each(scenarios)("%s: wyjście bez danych z bazy i z adresu bazy", async (_label, scenario) => {
    const { out } = await scenario();
    expect(out.length).toBeGreaterThan(0);
    const text = out.join("\n");
    for (const marker of OUTPUT_LEAKS) expect(text).not.toContain(marker);
  });
});
