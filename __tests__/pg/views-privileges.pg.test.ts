/**
 * #193 P0c-1 (pkt 5): zasady dla widoków w schemacie `public`.
 *
 * - każdy widok (relkind `v`) ma w `reloptions` `security_invoker=true`;
 * - widoków zmaterializowanych (relkind `m`) w `public` nie ma;
 * - na widokach rola żądań (`myhelper_app`) i rola logowania (`myhelper_app_login`, jeśli
 *   istnieje) nie mają INSERT/UPDATE/DELETE/TRUNCATE — ani wprost, ani przez PUBLIC albo
 *   członkostwo w roli (`has_table_privilege` liczy wszystkie drogi).
 * Wyjątki od dwóch pierwszych zasad wyłącznie z zamkniętej listy VIEW_EXCEPTIONS (dziś pusta).
 *
 * Sondy uwzględniają domyślne uprawnienia schematu i właściciela widoków. Test czyta katalog;
 * sondy (widoki, wiersze) powstają w transakcji, która jest wycofywana — test niczego trwale
 * nie zmienia i nie uruchamia `db:*` ani seeda.
 *
 * Sam ten plik (`pnpm test:pg -- <plik>` nie zawęża przebiegu — biegną wszystkie testy pg):
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm exec vitest run --config vitest.pg.config.ts __tests__/pg/views-privileges.pg.test.ts
 *
 * Wymaga bazy po `pnpm db:migrate` (rola `myhelper_app` i polityki z migracji 0005).
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { exceptionFormatViolations } from "./exception-list";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const suite = h ? describe : describe.skip;

/** Role, których dotyczy zasada; rola logowania — tylko gdy istnieje. */
const APP_ROLES = ["myhelper_app", "myhelper_app_login"];
const WRITE_PRIVS = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"];
const INVOKER = "security_invoker=true";
/**
 * Porównanie z `reloptions` jest dosłowne: `security_invoker = on`/`1`/`yes` zapisuje się w
 * katalogu inaczej i daje czerwony (fail-closed). Migracja widoku pisze dokładnie `= true`.
 */
const NO_INVOKER = `brak ${INVOKER} — w migracji widoku użyj dokładnie WITH (security_invoker = true); on/1/yes dają czerwony`;

/**
 * Wyjątek od wymogu `security_invoker` (widok) albo od zakazu (widok zmaterializowany).
 * `acceptedBy` — role z ACCEPT_ROLES (obie); `pr` — numer PR dodającego wyjątek.
 */
type ViewException = { name: string; kind: "v" | "m"; reason: string; acceptedBy: string[]; pr: number };

/**
 * ZAMKNIĘTA lista wyjątków (#193). Każda pozycja: nazwa, rodzaj, jednozdaniowe uzasadnienie,
 * akceptacja ról recenzji i przeglądu zgodności oraz numer PR. Dopisanie pozycji = recenzja i przegląd zgodności w tym PR.
 */
const VIEW_EXCEPTIONS: ViewException[] = [];

/** Klient albo transakcja postgres.js — wystarczy `unsafe` (wzór z `scripts/db-rls-guard.ts`). */
type QueryRunner = { unsafe: (query: string) => PromiseLike<readonly unknown[]> };

/** Stałe testu jako lista literałów SQL; tylko znaki [A-Za-z0-9_-] (bez danych z zewnątrz). */
const sqlList = (xs: readonly string[]) =>
  xs
    .map((x) => {
      if (!/^[A-Za-z0-9_-]+$/.test(x)) throw new Error(`nieoczekiwana stała SQL: ${x}`);
      return `'${x}'`;
    })
    .join(", ");

/** Istniejące role z APP_ROLES. */
async function appRoles(sql: QueryRunner): Promise<string[]> {
  const rows = (await sql.unsafe(`SELECT rolname FROM pg_roles WHERE rolname IN (${sqlList(APP_ROLES)}) ORDER BY rolname`)) as Array<{
    rolname: string;
  }>;
  return rows.map((r) => r.rolname);
}

/**
 * Naruszenia zasad dla widoków w public (pusta lista = zasady spełnione), w kolejności:
 * - `widok (v): ${NO_INVOKER}` i `widok (m): widok zmaterializowany w public — zakaz`
 *   (poza VIEW_EXCEPTIONS);
 * - `widok (v): rola PRAWO` — prawo zapisu roli aplikacji na widoku.
 */
async function viewViolations(sql: QueryRunner, exceptions: readonly ViewException[] = VIEW_EXCEPTIONS): Promise<string[]> {
  const rels = (await sql.unsafe(`
    SELECT c.relname::text AS relname, c.relkind::text AS relkind, coalesce(c.reloptions, '{}'::text[]) AS reloptions
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    ORDER BY c.relname`)) as Array<{ relname: string; relkind: "v" | "m"; reloptions: string[] }>;
  const excepted = (name: string, kind: string) => exceptions.some((e) => e.name === name && e.kind === kind);
  const structural = rels.flatMap((r) => {
    if (excepted(r.relname, r.relkind)) return [];
    if (r.relkind === "m") return [`${r.relname} (m): widok zmaterializowany w public — zakaz`];
    return r.reloptions.includes(INVOKER) ? [] : [`${r.relname} (v): ${NO_INVOKER}`];
  });
  const writes = (await sql.unsafe(`
    SELECT c.relname::text AS relname, r.rolname::text AS rolname, p.priv
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (SELECT rolname FROM pg_roles WHERE rolname IN (${sqlList(APP_ROLES)})) r
    CROSS JOIN unnest(ARRAY[${sqlList(WRITE_PRIVS)}]::text[]) AS p(priv)
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
      AND has_table_privilege(r.rolname, c.oid, p.priv)
    ORDER BY c.relname, r.rolname, p.priv`)) as Array<{ relname: string; rolname: string; priv: string }>;
  return [...structural, ...writes.map((x) => `${x.relname} (v): ${x.rolname} ${x.priv}`)];
}

class Rollback extends Error {}

/** Polecenia po kolei w jednej transakcji, potem `read` w tej samej transakcji, potem wycofanie. */
async function inRolledBackTx<T>(ddl: string, read: (tx: QueryRunner) => Promise<T>): Promise<T> {
  let result: { v: T } | undefined;
  await h!.observer
    .begin(async (tx) => {
      // Po jednym poleceniu (protokół rozszerzony nie przyjmuje kilku naraz). Podział po każdym
      // średniku: sonda ze średnikiem w literale SQL rozjedzie się błędem składni, nie cicho.
      for (const stmt of ddl.split(";").map((s) => s.trim()).filter(Boolean)) await tx.unsafe(stmt);
      result = { v: await read(tx) };
      throw new Rollback();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Rollback)) throw e;
    });
  if (!result) throw new Error("sonda nie zwróciła wyniku");
  return result.v;
}

const PROBE = "p0c1_view_probe";
const PROBE_INV = "p0c1_view_probe_inv";
/** Rola logowania dochodzi w P6 — sondy porównują naruszenia bez niej. */
const noLogin = (v: string[]) => v.filter((x) => !x.includes("myhelper_app_login"));

describe("lista wyjątków widoków: format (#193 P0c-1)", () => {
  /** Pozycja kompletna; przypadki niżej psują w niej po jednym polu. */
  const OK: ViewException = { name: "x_view", kind: "v", reason: "Katalog publiczny: tylko kolumny publiczne, wyłącznie SELECT.", acceptedBy: ["CTO", "CRCO"], pr: 1 };
  /** Pozycja bez pola `pr` (np. z JSON albo po rzutowaniu typu). */
  const noPr = Object.fromEntries(Object.entries(OK).filter(([k]) => k !== "pr")) as unknown as ViewException;

  it("VIEW_EXCEPTIONS: każda pozycja z nazwą, jednozdaniowym uzasadnieniem, obiema rolami akceptującymi w acceptedBy i numerem PR", () => {
    expect(exceptionFormatViolations(VIEW_EXCEPTIONS)).toEqual([]);
  });

  it.each([
    ["bez uzasadnienia", { ...OK, reason: "" }, /brak jednozdaniowego uzasadnienia/],
    ["uzasadnienie z dwóch zdań", { ...OK, reason: "Tylko kolumny publiczne. Wyłącznie SELECT." }, /brak jednozdaniowego uzasadnienia/],
    ["bez akceptacji roli CRCO", { ...OK, acceptedBy: ["CTO"] }, /brak akceptacji roli CRCO/],
    ["bez akceptacji roli CTO (widok zmaterializowany)", { ...OK, kind: "m", acceptedBy: ["CRCO"] }, /brak akceptacji roli CTO/],
    ["akceptacja spoza ról", { ...OK, acceptedBy: ["CTO", "CRCO", "QA"] }, /akceptacja spoza ról \(CTO, CRCO\): QA/],
    ["bez numeru PR", noPr, /brak numeru PR dodającego wyjątek/],
    ["numer PR 0", { ...OK, pr: 0 }, /brak numeru PR dodającego wyjątek/],
    ["numer PR niecałkowity", { ...OK, pr: 1.5 }, /brak numeru PR dodającego wyjątek/],
  ] as Array<[string, ViewException, RegExp]>)("pozycja %s → naruszenie formatu", (_n, e, re) => {
    expect(exceptionFormatViolations([e]).join("\n")).toMatch(re);
  });

  it("pozycja kompletna → bez naruszeń formatu", () => {
    expect(exceptionFormatViolations([OK])).toEqual([]);
  });
});

suite("widoki w public: security_invoker, bez widoków zmaterializowanych, tylko SELECT (#193 P0c-1)", () => {
  afterAll(async () => {
    await h?.end();
  });

  // Sondy uwzględniają domyślne uprawnienia schematu: nowy widok może dostać prawa z automatu,
  // więc sondy z jawnym grantem i sondy kontrolne zaczynają od REVOKE ALL (#193).
  const VIEW = `CREATE VIEW public.${PROBE} AS SELECT 1 AS x`;
  const VIEW_INV = `CREATE VIEW public.${PROBE} WITH (security_invoker = true) AS SELECT 1 AS x`;
  const REVOKE = `REVOKE ALL ON public.${PROBE} FROM myhelper_app, PUBLIC`;
  const SELECT_ONLY = `GRANT SELECT ON public.${PROBE} TO myhelper_app`;
  const check = (ddl: string) => inRolledBackTx(ddl, (tx) => viewViolations(tx)).then(noLogin);

  it("rola myhelper_app istnieje (zasada nie przechodzi pusto przez literówkę w nazwie roli)", async () => {
    expect(await appRoles(h!.observer)).toContain("myhelper_app");
  });

  it("baza po db:migrate: widoki w public z security_invoker, bez widoków zmaterializowanych, bez zapisu dla ról aplikacji", async () => {
    expect(await viewViolations(h!.observer)).toEqual([]);
  });

  it("sonda: CREATE VIEW, REVOKE ALL, GRANT SELECT (bez security_invoker) → naruszenie: brak security_invoker", async () => {
    expect(await check(`${VIEW}; ${REVOKE}; ${SELECT_ONLY}`)).toEqual([`${PROBE} (v): ${NO_INVOKER}`]);
  });

  it("sonda kontrolna: CREATE VIEW WITH (security_invoker = true), REVOKE ALL, GRANT SELECT → bez naruszeń", async () => {
    expect(await check(`${VIEW_INV}; ${REVOKE}; ${SELECT_ONLY}`)).toEqual([]);
  });

  it("sonda: goły CREATE VIEW bez grantów → brak security_invoker i zapis z domyślnych uprawnień schematu", async () => {
    expect(await check(VIEW)).toEqual([
      `${PROBE} (v): ${NO_INVOKER}`,
      `${PROBE} (v): myhelper_app DELETE`,
      `${PROBE} (v): myhelper_app INSERT`,
      `${PROBE} (v): myhelper_app UPDATE`,
    ]);
  });

  it.each([
    ["REVOKE ALL, potem GRANT INSERT dla myhelper_app", `${VIEW_INV}; ${REVOKE}; GRANT INSERT ON public.${PROBE} TO myhelper_app`, [`${PROBE} (v): myhelper_app INSERT`]],
    ["REVOKE ALL, potem GRANT UPDATE dla PUBLIC (droga pośrednia)", `${VIEW_INV}; ${REVOKE}; GRANT UPDATE ON public.${PROBE} TO PUBLIC`, [`${PROBE} (v): myhelper_app UPDATE`]],
  ])("sonda (widok z security_invoker): %s → dokładnie jawne naruszenie", async (_n, ddl, expected) => {
    expect(await check(ddl)).toEqual(expected);
  });

  it("sonda: CREATE MATERIALIZED VIEW → naruszenie: zakaz widoków zmaterializowanych", async () => {
    expect(await check(`CREATE MATERIALIZED VIEW public.${PROBE} AS SELECT 1 AS x`)).toEqual([`${PROBE} (m): widok zmaterializowany w public — zakaz`]);
  });

  it("wyjątek z listy zwalnia z wymogu security_invoker i zakazu (zapis na widoku nadal sprawdzany)", async () => {
    const exc: ViewException[] = [
      { name: PROBE, kind: "v", reason: "Sonda testu: wyjątek zwalnia z wymogu opcji widoku.", acceptedBy: ["CTO", "CRCO"], pr: 230 },
    ];
    expect(noLogin(await inRolledBackTx(`${VIEW}; ${REVOKE}; GRANT INSERT ON public.${PROBE} TO myhelper_app`, (tx) => viewViolations(tx, exc)))).toEqual([
      `${PROBE} (v): myhelper_app INSERT`,
    ]);
  });

  it("sonda zachowania: rola żądań w kontekście salonu A — widok bez security_invoker zwraca wiersz salonu B, z security_invoker nie", async () => {
    const run = randomUUID().slice(0, 8);
    const [ua, ub] = [`it-p0c1-a-${run}`, `it-p0c1-b-${run}`];
    const [sa, sb] = [randomUUID(), randomUUID()];
    const ddl = [
      `INSERT INTO "user" (id, name, email) VALUES ('${ua}', 'IT P0c1 A', '${ua}@example.invalid'), ('${ub}', 'IT P0c1 B', '${ub}@example.invalid')`,
      `INSERT INTO salons (id, name, owner_id) VALUES ('${sa}', 'IT P0c1 A ${run}', '${ua}'), ('${sb}', 'IT P0c1 B ${run}', '${ub}')`,
      `CREATE VIEW public.${PROBE} AS SELECT id::text AS id FROM salons WHERE id IN ('${sa}', '${sb}')`,
      `CREATE VIEW public.${PROBE_INV} WITH (security_invoker = true) AS SELECT id::text AS id FROM salons WHERE id IN ('${sa}', '${sb}')`,
      `GRANT SELECT ON public.${PROBE}, public.${PROBE_INV} TO myhelper_app`,
      "SET LOCAL ROLE myhelper_app",
      `SELECT set_config('app.current_salon_id', '${sa}', true)`,
    ].join("; ");
    const seen = await inRolledBackTx(ddl, async (tx) => {
      const ids = async (v: string) => ((await tx.unsafe(`SELECT id FROM public.${v} ORDER BY id`)) as Array<{ id: string }>).map((r) => r.id);
      return { owner: await ids(PROBE), invoker: await ids(PROBE_INV) };
    });
    expect(seen.owner.sort()).toEqual([sa, sb].sort());
    expect(seen.invoker).toEqual([sa]);
  });

  it("po wycofaniu sond widoków i wierszy nie ma (test nie zostawia śladu)", async () => {
    const rows = await h!.observer.unsafe(`SELECT 1 FROM pg_class WHERE relname IN (${sqlList([PROBE, PROBE_INV])})`);
    expect(rows).toHaveLength(0);
    const users = await h!.observer.unsafe(`SELECT 1 FROM "user" WHERE id LIKE 'it-p0c1-%'`);
    expect(users).toHaveLength(0);
  });
});
