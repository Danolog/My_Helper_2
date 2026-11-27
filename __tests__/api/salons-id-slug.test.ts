/**
 * PUT /api/salons/[id]/slug — zmiana krótkiego adresu salonu `/s/<slug>`.
 *
 * Kontrakt: 401 bez sesji, 400 zły id / zły slug / zły JSON, 404 brak salonu,
 * 403 nie właściciel, 409 SLUG_TAKEN (23505 na salons_slug_uq albo na kluczu
 * głównym rejestru salon_slug_history), 409 SLUG_CHANGE_LIMIT (5 wycofanych
 * adresów i nowy adres), 500 inny błąd, 200 z zapisanym slugiem.
 * Dostęp tylko przez forSalon(id z URL).
 *
 * Atrapa bazy trzyma w pamięci `salons` i rejestr adresów `salon_slug_history`
 * (bieżące i dawne adresy wszystkich salonów) i odtwarza to, na czym opiera się
 * trasa:
 * - RLS rejestru: w kontekście salonu widać i zmienia się tylko jego wiersze,
 *   INSERT cudzego wiersza → 42501;
 * - klucz główny rejestru (slug) obejmuje wiersze WSZYSTKICH salonów → 23505
 *   salon_slug_history_pkey; ON CONFLICT DO NOTHING pomija konflikt;
 * - salons_slug_uq → 23505;
 * - transakcja: błąd w dowolnym kroku przywraca stan sprzed transakcji.
 * Operatory drizzle to atrapy `{ type, args }`, kolumny napisami `tabela.kolumna`.
 */
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequest, createRouteParams, parseResponse } from "./helpers";

const SALON_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALON_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER_A = "user-owner-a";
const OTHER_USER = "user-other";

type SalonRow = { id: string; ownerId: string | null; slug: string | null };
type HistoryRow = { slug: string; salonId: string; retiredAt: Date | null };
type Row = Record<string, unknown>;
type Cond = { type: string; args: unknown[] };

const state = vi.hoisted(() => ({
  salons: [] as { id: string; ownerId: string | null; slug: string | null }[],
  history: [] as { slug: string; salonId: string; retiredAt: Date | null }[],
  /** Błąd rzucany przez UPDATE salons (null = zapis się udaje). */
  updateError: null as unknown,
  /** Błąd rzucany przez SELECT własności (null = odczyt się udaje). */
  selectError: null as unknown,
  forSalonIds: [] as string[],
  /** Każda operacja zapisu w kolejności: `<polecenie>:<tabela>`. */
  writes: [] as string[],
  /** Zatwierdzone transakcje (bez wycofanych). */
  commits: 0,
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ type: "eq", args }),
  and: (...args: unknown[]) => ({ type: "and", args }),
  isNull: (...args: unknown[]) => ({ type: "isNull", args }),
}));

vi.mock("@/lib/schema", () => {
  const table = (name: string) =>
    new Proxy({}, { get: (_t, col) => (col === "_table" ? name : typeof col === "symbol" ? undefined : `${name}.${String(col)}`) });
  return { salons: table("salons"), salonSlugHistory: table("salonSlugHistory") };
});

/** Wartość kolumny `tabela.kolumna` z wiersza. */
function col(row: Row, column: unknown): unknown {
  return row[String(column).split(".")[1]!];
}

function matches(row: Row, cond: Cond | undefined): boolean {
  if (!cond) return true;
  switch (cond.type) {
    case "eq":
      return col(row, cond.args[0]) === cond.args[1];
    case "isNull":
      return col(row, cond.args[0]) === null || col(row, cond.args[0]) === undefined;
    case "and":
      return (cond.args as Cond[]).every((c) => matches(row, c));
    default:
      throw new Error(`atrapa: nieznany warunek ${cond.type}`);
  }
}

function uniqueViolation(constraint: string) {
  return Object.assign(new Error("duplicate key"), { cause: { code: "23505", constraint_name: constraint } });
}

/** Atrapa `tx` w kontekście RLS salonu `ctx`. */
function makeTx(ctx: string) {
  const rows = (table: string): Row[] =>
    table === "salons"
      ? state.salons.filter((s: SalonRow) => s.id === ctx)
      : state.history.filter((h: HistoryRow) => h.salonId === ctx);

  return {
    select: (cols: Record<string, unknown>) => ({
      from: (t: { _table: string }) => ({
        where: (w: Cond) => {
          const run = () => {
            if (state.selectError) return Promise.reject(state.selectError);
            return Promise.resolve(
              rows(t._table)
                .filter((r) => matches(r, w))
                .map((r) => Object.fromEntries(Object.entries(cols).map(([k, c]) => [k, col(r, c)])))
            );
          };
          return { for: () => run(), then: (res: (v: Row[]) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej) };
        },
      }),
    }),
    update: (t: { _table: string }) => ({
      set: (values: Row) => ({
        where: (w: Cond) => {
          state.writes.push(`update:${t._table}`);
          if (t._table === "salons") {
            if (state.updateError) return Promise.reject(state.updateError);
            const slug = values.slug as string;
            if (state.salons.some((s: SalonRow) => s.id !== ctx && s.slug === slug)) {
              return Promise.reject(uniqueViolation("salons_slug_uq"));
            }
          }
          for (const r of rows(t._table).filter((x) => matches(x, w))) Object.assign(r, values);
          return Promise.resolve([]);
        },
      }),
    }),
    insert: (t: { _table: string }) => ({
      values: (v: HistoryRow) => {
        const insert = (onConflictDoNothing: boolean) => {
          state.writes.push(`insert:${t._table}${onConflictDoNothing ? ":do-nothing" : ""}`);
          if (v.salonId !== ctx) {
            return Promise.reject(Object.assign(new Error("new row violates row-level security policy"), { code: "42501" }));
          }
          if (state.history.some((h: HistoryRow) => h.slug === v.slug)) {
            return onConflictDoNothing ? Promise.resolve([]) : Promise.reject(uniqueViolation("salon_slug_history_pkey"));
          }
          state.history.push({ slug: v.slug, salonId: v.salonId, retiredAt: v.retiredAt ?? null });
          return Promise.resolve([]);
        };
        return {
          onConflictDoNothing: () => insert(true),
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => insert(false).then(res, rej),
        };
      },
    }),
    delete: (t: { _table: string }) => ({
      where: (w: Cond) => {
        state.writes.push(`delete:${t._table}`);
        const gone = new Set(rows(t._table).filter((r) => matches(r, w)));
        state.history = state.history.filter((h: HistoryRow) => !gone.has(h));
        return Promise.resolve([]);
      },
    }),
  };
}

vi.mock("@/lib/server/repository", () => ({
  forSalon: (salonId: string) => {
    state.forSalonIds.push(salonId);
    return {
      raw: async (fn: (tx: unknown) => Promise<unknown>) => {
        // Transakcja: kopia stanu przed, przywrócenie po błędzie.
        const salonsBefore = state.salons.map((s: SalonRow) => ({ ...s }));
        const historyBefore = state.history.map((h: HistoryRow) => ({ ...h }));
        try {
          const result = await fn(makeTx(salonId));
          state.commits++;
          return result;
        } catch (error) {
          state.salons = salonsBefore;
          state.history = historyBefore;
          throw error;
        }
      },
    };
  },
}));

const mockRequireAuth = vi.fn();
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (r: unknown) => r instanceof NextResponse,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PUT } from "@/app/api/salons/[id]/slug/route";
import { SALON_SLUG_MAX_CHANGES } from "@/lib/salon-slug";

function put(id: string, body: unknown) {
  return PUT(
    createMockRequest(`http://localhost:3000/api/salons/${id}/slug`, { method: "PUT", body }),
    createRouteParams(id)
  ).then(parseResponse);
}

function signInAs(userId: string) {
  mockRequireAuth.mockResolvedValue({ session: { user: { id: userId } }, user: { id: userId } });
}

const salonA = () => state.salons.find((s: SalonRow) => s.id === SALON_A)!;
const historyOf = (salonId: string) =>
  state.history
    .filter((h: HistoryRow) => h.salonId === salonId)
    .map((h: HistoryRow) => ({ slug: h.slug, current: h.retiredAt === null }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

beforeEach(() => {
  vi.clearAllMocks();
  state.salons = [
    { id: SALON_A, ownerId: OWNER_A, slug: "salon-a" },
    { id: SALON_B, ownerId: OTHER_USER, slug: "salon-b" },
  ];
  state.history = [
    { slug: "salon-a", salonId: SALON_A, retiredAt: null },
    { slug: "salon-b", salonId: SALON_B, retiredAt: null },
  ];
  state.updateError = null;
  state.selectError = null;
  state.forSalonIds = [];
  state.writes = [];
  state.commits = 0;
  signInAs(OWNER_A);
});

describe("PUT /api/salons/[id]/slug", () => {
  it("200: właściciel zmienia adres; stary adres zostaje w rejestrze jako dawny, nowy jako bieżący", async () => {
    const { status, body } = await put(SALON_A, { slug: "salon-ada" });

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, data: { slug: "salon-ada" } });
    expect(salonA().slug).toBe("salon-ada");
    expect(historyOf(SALON_A)).toEqual([
      { slug: "salon-a", current: false },
      { slug: "salon-ada", current: true },
    ]);
    expect(state.forSalonIds.every((id) => id === SALON_A)).toBe(true);
  });

  it("200: rejestr i salons zmieniane w JEDNEJ transakcji salonu, w kolejności: dawny, odzyskanie, bieżący, salons", async () => {
    await put(SALON_A, { slug: "salon-ada" });

    // Pierwsza transakcja: odczyt własności (bez zapisów); druga: zmiana adresu.
    expect(state.commits).toBe(2);
    expect(state.writes).toEqual([
      "update:salonSlugHistory",
      "insert:salonSlugHistory:do-nothing",
      "delete:salonSlugHistory",
      "insert:salonSlugHistory",
      "update:salons",
    ]);
  });

  it("200: salon bez wiersza w rejestrze (np. z seeda) — stary adres i tak trafia do rejestru jako dawny", async () => {
    state.history = state.history.filter((h: HistoryRow) => h.salonId !== SALON_A);

    const { status } = await put(SALON_A, { slug: "salon-ada" });

    expect(status).toBe(200);
    expect(historyOf(SALON_A)).toEqual([
      { slug: "salon-a", current: false },
      { slug: "salon-ada", current: true },
    ]);
  });

  it("200: spacje na brzegach i wielkie litery poprawione przed zapisem", async () => {
    const { status, body } = await put(SALON_A, { slug: "  Salon-ADA  " });

    expect(status).toBe(200);
    expect(body.data).toEqual({ slug: "salon-ada" });
    expect(salonA().slug).toBe("salon-ada");
  });

  it("200: ten sam slug co obecny — bez zmian w rejestrze", async () => {
    const { status } = await put(SALON_A, { slug: "salon-a" });

    expect(status).toBe(200);
    expect(state.writes).toEqual(["update:salons"]);
    expect(historyOf(SALON_A)).toEqual([{ slug: "salon-a", current: true }]);
  });

  describe("przejęcie dawnego adresu", () => {
    it("409 SLUG_TAKEN: salon A zajmuje dawny adres salonu B — bez zmian w bazie", async () => {
      // B zmienił adres z `stary-b` na `salon-b`; `stary-b` jest dawnym adresem B.
      state.history.push({ slug: "stary-b", salonId: SALON_B, retiredAt: new Date("2026-11-01") });
      const historyBefore = JSON.stringify(state.history);

      const { status, body } = await put(SALON_A, { slug: "stary-b" });

      expect(status).toBe(409);
      expect(body.code).toBe("SLUG_TAKEN");
      expect(body.error).toContain("zajęty");
      expect(salonA().slug).toBe("salon-a");
      expect(JSON.stringify(state.history)).toBe(historyBefore);
    });

    it("409 SLUG_TAKEN: adres bieżący innego salonu (konflikt klucza rejestru)", async () => {
      const { status, body } = await put(SALON_A, { slug: "salon-b" });

      expect(status).toBe(409);
      expect(body.code).toBe("SLUG_TAKEN");
      expect(salonA().slug).toBe("salon-a");
      expect(historyOf(SALON_A)).toEqual([{ slug: "salon-a", current: true }]);
    });

    it("409 SLUG_TAKEN: adres bieżący salonu spoza rejestru (konflikt salons_slug_uq)", async () => {
      state.history = state.history.filter((h: HistoryRow) => h.salonId !== SALON_B);

      const { status, body } = await put(SALON_A, { slug: "salon-b" });

      expect(status).toBe(409);
      expect(body.code).toBe("SLUG_TAKEN");
      expect(salonA().slug).toBe("salon-a");
      expect(historyOf(SALON_A)).toEqual([{ slug: "salon-a", current: true }]);
    });

    it("cudzy wiersz rejestru nie jest usuwany przy próbie przejęcia (odzyskanie tylko własnych)", async () => {
      state.history.push({ slug: "stary-b", salonId: SALON_B, retiredAt: new Date("2026-11-01") });

      await put(SALON_A, { slug: "stary-b" });

      expect(historyOf(SALON_B)).toEqual([
        { slug: "salon-b", current: true },
        { slug: "stary-b", current: false },
      ]);
    });
  });

  it("200: odzyskanie własnego dawnego adresu — wraca jako bieżący, porzucony staje się dawnym", async () => {
    await put(SALON_A, { slug: "salon-ada" });
    expect(historyOf(SALON_A)).toEqual([
      { slug: "salon-a", current: false },
      { slug: "salon-ada", current: true },
    ]);

    const { status } = await put(SALON_A, { slug: "salon-a" });

    expect(status).toBe(200);
    expect(salonA().slug).toBe("salon-a");
    expect(historyOf(SALON_A)).toEqual([
      { slug: "salon-a", current: true },
      { slug: "salon-ada", current: false },
    ]);
  });

  describe("limit zmian adresu", () => {
    /** Salon A z `count` wycofanymi adresami (`dawny-1`…) obok bieżącego `salon-a`. */
    function retireAddresses(count: number) {
      for (let i = 1; i <= count; i++) {
        state.history.push({ slug: `dawny-${i}`, salonId: SALON_A, retiredAt: new Date("2026-11-01") });
      }
    }

    it("409 SLUG_CHANGE_LIMIT: 5 wycofanych adresów i nowy adres — niczego nie zapisuje", async () => {
      retireAddresses(SALON_SLUG_MAX_CHANGES);
      const historyBefore = JSON.stringify(state.history);

      const { status, body } = await put(SALON_A, { slug: "salon-ada" });

      expect(status).toBe(409);
      expect(body.code).toBe("SLUG_CHANGE_LIMIT");
      expect(body.error).toBe(
        "Osiągnięto limit zmian adresu. Napisz do nas, jeśli potrzebujesz kolejnej zmiany."
      );
      expect(state.writes).toEqual([]);
      expect(salonA().slug).toBe("salon-a");
      expect(JSON.stringify(state.history)).toBe(historyBefore);
    });

    it("200: 5 wycofanych adresów i odzyskanie własnego adresu przechodzi", async () => {
      retireAddresses(SALON_SLUG_MAX_CHANGES);

      const { status, body } = await put(SALON_A, { slug: "dawny-3" });

      expect(status).toBe(200);
      expect(body).toEqual({ success: true, data: { slug: "dawny-3" } });
      expect(salonA().slug).toBe("dawny-3");
    });

    it("200: 4 wycofane adresy i nowy adres przechodzi", async () => {
      retireAddresses(SALON_SLUG_MAX_CHANGES - 1);

      const { status, body } = await put(SALON_A, { slug: "salon-ada" });

      expect(status).toBe(200);
      expect(body).toEqual({ success: true, data: { slug: "salon-ada" } });
      expect(salonA().slug).toBe("salon-ada");
    });

    it("200: ten sam adres co obecny nie podlega limitowi", async () => {
      retireAddresses(SALON_SLUG_MAX_CHANGES);

      const { status } = await put(SALON_A, { slug: "salon-a" });

      expect(status).toBe(200);
    });

    it("limit liczy tylko własne wycofane adresy salonu", async () => {
      for (let i = 1; i <= SALON_SLUG_MAX_CHANGES; i++) {
        state.history.push({ slug: `cudzy-${i}`, salonId: SALON_B, retiredAt: new Date("2026-11-01") });
      }

      const { status } = await put(SALON_A, { slug: "salon-ada" });

      expect(status).toBe(200);
    });
  });

  it("401: bez sesji — bez zapytań", async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }));

    const { status } = await put(SALON_A, { slug: "salon-ada" });

    expect(status).toBe(401);
    expect(state.forSalonIds).toEqual([]);
  });

  it("400: id salonu nie jest UUID — bez zapytań", async () => {
    const { status } = await put("not-a-uuid", { slug: "salon-ada" });

    expect(status).toBe(400);
    expect(state.forSalonIds).toEqual([]);
  });

  it.each([
    ["za krótki", "ab"],
    ["za długi", "x".repeat(51)],
    ["podkreślnik", "salon_ada"],
    ["polskie znaki", "sałon-ada"],
    ["myślnik na końcu", "salon-"],
    ["podwójny myślnik", "salon--ada"],
    ["słowo zastrzeżone", "admin"],
    ["słowo zastrzeżone (dashboard)", "dashboard"],
  ])("400: %s (%s) — bez zapisu, komunikat w details.slug", async (_name, slug) => {
    const { status, body } = await put(SALON_A, { slug });

    expect(status).toBe(400);
    expect((body.details as Record<string, string>).slug).toBeTruthy();
    expect(state.writes).toEqual([]);
  });

  it.each([
    ["brak pola", {}],
    ["nie napis", { slug: 123 }],
    ["null", { slug: null }],
  ])("400: %s — bez zapisu", async (_name, payload) => {
    const { status } = await put(SALON_A, payload);
    expect(status).toBe(400);
    expect(state.writes).toEqual([]);
  });

  it("400: treść nie jest JSON-em", async () => {
    const request = new Request(`http://localhost:3000/api/salons/${SALON_A}/slug`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{nie-json",
    });
    const { status } = await PUT(request, createRouteParams(SALON_A)).then(parseResponse);
    expect(status).toBe(400);
    expect(state.writes).toEqual([]);
  });

  it("403: zalogowany, ale nie właściciel salonu — bez zapisu", async () => {
    signInAs(OTHER_USER);

    const { status } = await put(SALON_A, { slug: "przejety-adres" });

    expect(status).toBe(403);
    expect(state.writes).toEqual([]);
  });

  it("403: salon bez właściciela — bez zapisu", async () => {
    salonA().ownerId = null;

    const { status } = await put(SALON_A, { slug: "salon-ada" });

    expect(status).toBe(403);
    expect(state.writes).toEqual([]);
  });

  it("404: salon nie istnieje", async () => {
    state.salons = state.salons.filter((s: SalonRow) => s.id !== SALON_A);

    const { status } = await put(SALON_A, { slug: "salon-ada" });

    expect(status).toBe(404);
    expect(state.writes).toEqual([]);
  });

  it("409 SLUG_TAKEN: konflikt salons_slug_uq opakowany przez Drizzle — rejestr wycofany", async () => {
    state.updateError = Object.assign(new Error("db"), {
      cause: { code: "23505", constraint_name: "salons_slug_uq" },
    });

    const { status, body } = await put(SALON_A, { slug: "salon-ada" });

    expect(status).toBe(409);
    expect(body.code).toBe("SLUG_TAKEN");
    expect(historyOf(SALON_A)).toEqual([{ slug: "salon-a", current: true }]);
  });

  it("500: inny konflikt unikalności nie udaje zajętego adresu; rejestr wycofany", async () => {
    state.updateError = Object.assign(new Error("db"), { code: "23505", constraint_name: "salons_owner_id_uq" });

    const { status } = await put(SALON_A, { slug: "salon-ada" });

    expect(status).toBe(500);
    expect(historyOf(SALON_A)).toEqual([{ slug: "salon-a", current: true }]);
  });

  it("500: błąd bazy przy odczycie własności, bez szczegółów błędu w odpowiedzi", async () => {
    state.selectError = new Error("connection refused 10.0.0.5");

    const { status, body } = await put(SALON_A, { slug: "salon-ada" });

    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
  });
});
