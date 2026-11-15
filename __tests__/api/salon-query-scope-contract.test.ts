/**
 * Kontrakt (#94): konto salonu A z `?salonId=B` => 403/404 i zero zapytań
 * w kontekście RLS jakiegokolwiek salonu — na KAŻDYM handlerze, który
 * niezmiennik (`salon-query-scope-invariant.test.ts`) uznał za strzeżony
 * regułą ogólną. Lista nie jest ręczna: nowa trasa z `get("salonId")` +
 * `requireSalonStaff`/`requireReportSalon` trafia tu sama.
 *
 * Prawdziwe requireSalonStaff/requireReportSalon/forSalon; mockowane tylko
 * krawędzie (sesja, db, next/headers) — `salon-staff-harness.ts`.
 */
import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { guardedBySessionSalon, handlersReadingSalonIdQuery } from "./salon-query-scope";
import { SALON_A, SALON_B } from "./salon-staff-harness";

const m = await vi.hoisted(async () =>
  (await import("./salon-staff-harness")).createSalonStaffMocks()
);

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: m.hasTemporaryAccess }));

const guarded = handlersReadingSalonIdQuery().filter((h) => guardedBySessionSalon(h.body));

type Handler = (request: Request, context?: unknown) => Promise<Response>;

async function load(file: string, method: string): Promise<Handler> {
  const path = file.replace(/^src\//, "@/").replace(/\.ts$/, "");
  const mod = (await import(/* @vite-ignore */ path)) as Record<string, Handler>;
  const handler = mod[method];
  if (!handler) throw new Error(`${file}: brak eksportu ${method}`);
  return handler;
}

function call(handler: Handler, file: string, method: string, salonId: string) {
  const route = file.replace(/^src\/app/, "").replace(/\/route\.ts$/, "");
  const url = `http://localhost${route}?salonId=${salonId}&startDate=2026-01-01&endDate=2026-01-31`;
  // NextRequest, bo część tras czyta request.nextUrl (np. /api/payments).
  return handler(new NextRequest(url, { method }), { params: Promise.resolve({}) });
}

describe("kontrakt: konto salonu A z salonId=B => 403/404, bez zapytań (#94)", () => {
  beforeEach(() => m.reset());

  it("obejmuje trasy z #73 i #94 oraz raporty", () => {
    const files = guarded.map((h) => h.file);
    expect(files).toContain("src/app/api/services/route.ts");
    expect(files).toContain("src/app/api/service-categories/route.ts");
    expect(files.some((f) => f.startsWith("src/app/api/reports/"))).toBe(true);
  });

  it.each(guarded.map((h) => [`${h.method} ${h.file}`, h.file, h.method] as const))(
    "%s: właściciel A, salonId=B => 403/404",
    async (_name, file, method) => {
      const handler = await load(file, method);
      m.asOwnerOf(SALON_A);
      m.txRows.push([{ id: "row-b", salonId: SALON_B }]);

      const res = await call(handler, file, method, SALON_B);

      expect([403, 404]).toContain(res.status);
      expect(m.rlsSalonIds()).toEqual([]);
      expect(m.txRows).toHaveLength(1);
    }
  );

  it.each(guarded.map((h) => [`${h.method} ${h.file}`, h.file, h.method] as const))(
    "%s: konto bez salonu (portal klienta), salonId=B => 404",
    async (_name, file, method) => {
      const handler = await load(file, method);
      m.signIn("client-1");
      m.ctxRows.push([], []);

      const res = await call(handler, file, method, SALON_B);

      // #101: raporty też przez requireSalonStaff — jeden kod dla wszystkich.
      expect(res.status).toBe(404);
      expect(m.rlsSalonIds()).toEqual([]);
    }
  );
});
