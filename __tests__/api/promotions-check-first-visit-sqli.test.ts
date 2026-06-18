/**
 * PR-0 · Siatka bezpieczeństwa — regresja SQL injection na check-first-visit.
 *
 * Cel: dowieść, że surowe podzapytanie w
 *   src/app/api/promotions/check-first-visit/route.ts (~linia 102)
 *     sql`${appointments.bookedByUserId} IN (SELECT id FROM "user" WHERE email = ${email})`
 * trzyma `email` jako PARAMETR (placeholder), a nie wkleja go do tekstu SQL.
 * Dzięki temu wstrzyknięcie `x' OR '1'='1` NIE ucieka z parametryzacji — apostrofy
 * z payloadu nigdy nie trafiają do łańcucha zapytania, więc semantyka WHERE się
 * nie zmienia (atakujący nie „odblokuje" cudzych rekordów ani `OR 1=1`).
 *
 * Strategia (realny kontrakt drizzle, nie atrapa parametryzacji):
 *   - drizzle-orm (`sql`, `and`, `eq`) NIE jest mockowany — to on buduje zapytanie,
 *     więc testujemy jego prawdziwe zachowanie parametryzacji.
 *   - mockujemy tylko `@/lib/db`: chainowy budowniczy przechwytuje argument `where(...)`
 *     z zapytania portal-count (to, które niesie wstrzykiwany `email`).
 *   - rozkładamy drzewo `SQL.queryChunks` na: (a) fragmenty tekstu SQL (StringChunk)
 *     i (b) parametry (wartości). Payload musi siedzieć w (b), nigdy w (a).
 *
 * Test ma być zielony na ZASTANYM kodzie i zaświecić na czerwono, gdyby ktoś
 * (lub bump drizzle 0.44 -> 0.45, PR-2 planu) zamienił `${email}` na konkatenację.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest } from "./helpers";

// -------------------------------------------------------
// Mocks — tylko granice spoza testowanej parametryzacji.
// -------------------------------------------------------

// Schema: column refs jako proxy zwracający "tabela.kolumna" (jak gallery-id.test.ts).
vi.mock("@/lib/schema", () => {
  const createTable = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, prop) => (prop === "_table" ? name : `${name}.${String(prop)}`),
      }
    );
  return {
    promotions: createTable("promotions"),
    appointments: createTable("appointments"),
    clients: createTable("clients"),
    services: createTable("services"),
  };
});

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// db: każdy select zwraca chain; chain.where(...) zapisuje swój argument do
// `capturedWheres`, a chain rozwiązuje się (await) do z góry zadanego wyniku.
const capturedWheres: unknown[] = [];

function chainMock(result: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "from", "leftJoin", "innerJoin", "limit", "orderBy", "groupBy"];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn((arg: unknown) => {
    capturedWheres.push(arg);
    return chain;
  });
  chain.then = (resolve: (v: unknown[]) => unknown) => resolve(result);
  return chain;
}

// Kolejka wyników kolejnych wywołań db.select() (FIFO).
let selectQueue: unknown[][] = [];
const mockSelect = vi.fn(() => chainMock(selectQueue.shift() ?? []));

vi.mock("@/lib/db", () => ({
  db: { select: (...args: unknown[]) => mockSelect(...(args as [])) },
}));

import { GET } from "@/app/api/promotions/check-first-visit/route";

const SALON_ID = "11111111-1111-1111-1111-111111111111";
const INJECTION = "x' OR '1'='1";

// -------------------------------------------------------
// Rekurencyjne rozłożenie drzewa drizzle SQL na tekst i parametry.
// StringChunk -> fragment tekstu SQL; zagnieżdżony SQL -> schodzimy w queryChunks;
// wszystko inne (string/number/...) -> traktujemy jak parametr.
// -------------------------------------------------------
type SqlLike = { queryChunks?: unknown[] };

function isSqlNode(x: unknown): x is SqlLike {
  return typeof x === "object" && x !== null && Array.isArray((x as SqlLike).queryChunks);
}

function flatten(node: unknown, sqlText: string[], params: unknown[]): void {
  if (isSqlNode(node)) {
    for (const chunk of node.queryChunks as unknown[]) flatten(chunk, sqlText, params);
    return;
  }
  // StringChunk: ma pole `value` będące tablicą fragmentów tekstu SQL.
  if (
    typeof node === "object" &&
    node !== null &&
    Array.isArray((node as { value?: unknown }).value)
  ) {
    sqlText.push(((node as { value: unknown[] }).value as unknown[]).join(""));
    return;
  }
  // Param o polu .value (np. opakowany parametr) — wartość to parametr.
  if (typeof node === "object" && node !== null && "value" in (node as object)) {
    params.push((node as { value: unknown }).value);
    return;
  }
  // Goła wartość (string/number) interleaved przez `sql` -> parametr.
  params.push(node);
}

// =======================================================
describe("SQLi · /api/promotions/check-first-visit — email parametryzowany", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedWheres.length = 0;
    selectQueue = [];
  });

  it("payload `x' OR '1'='1` ląduje jako PARAMETR, nie w tekście SQL podzapytania", async () => {
    // 1. promotions: jedna aktywna first_visit promocja, bez ograniczeń dat.
    selectQueue.push([
      { id: "promo-1", name: "Pierwsza wizyta", value: "20", startDate: null, endDate: null },
    ]);
    // 2. clients by email: brak rekordu -> pomijamy pętlę per-klient.
    selectQueue.push([]);
    // 3. portal-count (zapytanie z wstrzykiwanym email): zwraca 0 wizyt.
    selectQueue.push([{ count: 0 }]);

    const url = `http://localhost:3000/api/promotions/check-first-visit?salonId=${SALON_ID}&email=${encodeURIComponent(
      INJECTION
    )}`;
    const res = await GET(createMockRequest(url));

    // Handler nie wybucha i nie zmienia semantyki — klient bez wizyt jest eligible.
    expect(res.status).toBe(200);

    // Ostatni przechwycony where() to ten z portal-count (niesie ${email}).
    expect(capturedWheres.length).toBeGreaterThanOrEqual(2);
    const portalWhere = capturedWheres[capturedWheres.length - 1];

    const sqlText: string[] = [];
    const params: unknown[] = [];
    flatten(portalWhere, sqlText, params);

    const joinedSql = sqlText.join(" ");

    // (a) Payload jest PARAMETREM — drizzle przekaże go bind-em, nie tekstem.
    expect(params).toContain(INJECTION);

    // (b) Payload NIGDY nie pojawia się w tekście SQL (gdyby był sklejony, byłby tu).
    expect(joinedSql).not.toContain(INJECTION);
    expect(joinedSql).not.toContain("OR '1'='1");

    // (c) Apostrof z payloadu nie wycieka do tekstu SQL (sanity na ucieczkę z literału).
    expect(joinedSql).not.toContain("'1'='1");

    // (d) Szkielet podzapytania jest stały i nie zawiera danych użytkownika.
    expect(joinedSql).toContain("SELECT id FROM");
    expect(joinedSql).toContain("WHERE email =");
  });

  it("zwykły, niezłośliwy email też jest parametrem (parametryzacja niezależna od treści)", async () => {
    selectQueue.push([
      { id: "promo-1", name: "Pierwsza wizyta", value: "20", startDate: null, endDate: null },
    ]);
    selectQueue.push([]);
    selectQueue.push([{ count: 0 }]);

    const normalEmail = "jan@example.com";
    const url = `http://localhost:3000/api/promotions/check-first-visit?salonId=${SALON_ID}&email=${encodeURIComponent(
      normalEmail
    )}`;
    const res = await GET(createMockRequest(url));
    expect(res.status).toBe(200);

    const portalWhere = capturedWheres[capturedWheres.length - 1];
    const sqlText: string[] = [];
    const params: unknown[] = [];
    flatten(portalWhere, sqlText, params);

    expect(params).toContain(normalEmail);
    // Adres nie został wklejony do tekstu zapytania.
    expect(sqlText.join(" ")).not.toContain(normalEmail);
  });

  it("brak wymaganych parametrów (email) -> kontrolowane 200 z eligible=false, bez zapytania SQL", async () => {
    const url = `http://localhost:3000/api/promotions/check-first-visit?salonId=${SALON_ID}`;
    const res = await GET(createMockRequest(url));
    const body = (await res.json()) as { success: boolean; data: { eligible: boolean } };

    expect(res.status).toBe(200);
    expect(body.data.eligible).toBe(false);
    // Walidacja wejścia ucina ścieżkę zanim cokolwiek poleci do bazy.
    expect(mockSelect).not.toHaveBeenCalled();
  });
});
