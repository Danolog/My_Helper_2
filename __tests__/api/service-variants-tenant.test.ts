/**
 * /api/services/[id]/variants i [variantId] — #104.
 *
 * - Zły UUID w segmencie => 400 (wcześniej 500 z Postgresa, 22P02 w logu CI).
 * - GET listy: salon z sesji przez requireSalonStaff (właściciel, recepcja,
 *   pracownik). Dawne getUserSalonId() znało tylko właściciela, więc
 *   personel dostawał 404 w dialogach wizyty.
 * - POST/PUT/DELETE: tylko właściciel (personel 403).
 * - Cudzy serwis => 404 (findOne zawężony do salonu z sesji).
 * - Izolacja zapisu (#125): service_variants nie ma salon_id ani RLS, więc
 *   jedyne bariery to serviceBelongsToSalon i filtr service_id w PUT/DELETE.
 *   Testy sprawdzają, że cudzy serviceId nie dochodzi do zapisu, a cudzy
 *   variantId pod własną usługą jest odcięty filtrem service_id.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DELETE, PUT } from "@/app/api/services/[id]/variants/[variantId]/route";
import { GET, POST } from "@/app/api/services/[id]/variants/route";
import { SALON_A } from "./salon-staff-harness";

const m = await vi.hoisted(async () =>
  (await import("./salon-staff-harness")).createSalonStaffMocks()
);

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: m.dbSystem }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: m.hasTemporaryAccess }));

const SERVICE = "11111111-1111-4111-8111-111111111111";
const VARIANT = "22222222-2222-4222-8222-222222222222";

const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
const url = (id: string, variantId?: string) =>
  `http://localhost/api/services/${id}/variants${variantId ? `/${variantId}` : ""}`;

function list(id = SERVICE) {
  return GET(new Request(url(id)), ctx({ id }));
}
function create(id = SERVICE) {
  return POST(
    new Request(url(id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Długie włosy", priceModifier: 20, durationModifier: 15 }),
    }),
    ctx({ id })
  );
}
function update(id = SERVICE, variantId = VARIANT) {
  return PUT(
    new Request(url(id, variantId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Krótkie" }),
    }),
    ctx({ id, variantId })
  );
}
function remove(id = SERVICE, variantId = VARIANT) {
  return DELETE(new Request(url(id, variantId), { method: "DELETE" }), ctx({ id, variantId }));
}

describe("GET /api/services/[id]/variants (#104)", () => {
  beforeEach(() => m.reset());

  it("właściciel: 200, warianty serwisu z własnego salonu, RLS tylko A", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SERVICE, salonId: SALON_A }], [{ id: VARIANT, serviceId: SERVICE }]);
    const res = await list();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([expect.objectContaining({ id: VARIANT })]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it.each(["receptionist", "employee"] as const)("%s własnego salonu: 200", async (role) => {
    m.asStaffOf(SALON_A, role);
    m.txRows.push([{ id: SERVICE, salonId: SALON_A }], []);
    const res = await list();
    expect(res.status).toBe(200);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("serwis spoza salonu z sesji => 404, bez listy wariantów", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([], [{ id: "variant-b" }]);
    const res = await list();
    expect(res.status).toBe(404);
    expect(m.txRows).toHaveLength(1);
  });

  it("konto bez salonu (portal klienta) => 404, bez zapytań", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    const res = await list();
    expect(res.status).toBe(404);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it.each(["abc", "null", "1"])("zły UUID %s => 400, bez zapytań", async (id) => {
    m.asOwnerOf(SALON_A);
    const res = await list(id);
    expect(res.status).toBe(400);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("bez sesji => 401", async () => {
    m.getSession.mockResolvedValue(null);
    expect((await list()).status).toBe(401);
  });
});

describe("zapis wariantów — tylko właściciel (#104)", () => {
  beforeEach(() => m.reset());

  const writes = [
    ["POST", () => create()],
    ["PUT", () => update()],
    ["DELETE", () => remove()],
  ] as const;

  it.each(writes)("%s: personel => 403, bez zapytań", async (_name, call) => {
    for (const role of ["receptionist", "employee"] as const) {
      m.reset();
      m.asStaffOf(SALON_A, role);
      const res = await call();
      expect(res.status).toBe(403);
      expect(m.rlsSalonIds()).toEqual([]);
      expect(m.insertedValues).toEqual([]);
    }
  });

  it("POST właściciela: 201 we własnym salonie", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SERVICE, salonId: SALON_A }], [{ id: VARIANT, serviceId: SERVICE }]);
    const res = await create();
    expect(res.status).toBe(201);
    expect(m.insertedValues).toEqual([expect.objectContaining({ serviceId: SERVICE })]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("PUT właściciela: 200", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SERVICE, salonId: SALON_A }], [{ id: VARIANT, name: "Krótkie" }]);
    expect((await update()).status).toBe(200);
  });

  it.each([
    ["POST", () => create("abc")],
    ["PUT (id)", () => update("abc")],
    ["PUT (variantId)", () => update(SERVICE, "abc")],
    ["DELETE (id)", () => remove("abc")],
    ["DELETE (variantId)", () => remove(SERVICE, "abc")],
  ] as const)("%s: zły UUID => 400, bez zapytań", async (_name, call) => {
    m.asOwnerOf(SALON_A);
    const res = await call();
    expect(res.status).toBe(400);
    expect(m.rlsSalonIds()).toEqual([]);
  });
});

describe("izolacja salonów przy zapisie wariantów (#125)", () => {
  beforeEach(() => m.reset());

  /** Usługa i wariant salonu B — właściciel A zna tylko ich identyfikatory. */
  const SERVICE_B = "33333333-3333-4333-8333-333333333333";
  const VARIANT_B = "44444444-4444-4444-8444-444444444444";

  const dialect = new PgDialect();
  const whereOf = (w: unknown) => dialect.sqlToQuery(w as Parameters<PgDialect["sqlToQuery"]>[0]);

  it.each([
    ["POST", () => create(SERVICE_B)],
    ["PUT", () => update(SERVICE_B, VARIANT_B)],
    ["DELETE", () => remove(SERVICE_B, VARIANT_B)],
  ] as const)(
    "%s na usłudze salonu B => 404, bez insert/update/delete",
    async (_name, call) => {
      m.asOwnerOf(SALON_A);
      // findOne(services, SERVICE_B) w kontekście salonu A: brak wiersza.
      // Kolejne wyniki udają „zapis się udał” — gdyby trasa przeszła dalej,
      // dostałaby wiersz i odpowiedziała 2xx.
      m.txRows.push([], [{ id: VARIANT_B, serviceId: SERVICE_B }]);
      const res = await call();
      expect(res.status).toBe(404);
      expect(m.insertedValues).toEqual([]);
      expect(m.writes).toEqual([]);
      expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
    }
  );

  it.each([
    ["PUT", "update", () => update(SERVICE, VARIANT_B)],
    ["DELETE", "delete", () => remove(SERVICE, VARIANT_B)],
  ] as const)(
    "%s wariantu salonu B pod własną usługą => 404, WHERE: id wariantu AND service_id własnej usługi",
    async (_name, op, call) => {
      m.asOwnerOf(SALON_A);
      // Usługa jest salonu A; wariant B należy do SERVICE_B, więc filtr
      // service_id = SERVICE w bazie daje 0 wierszy.
      m.txRows.push([{ id: SERVICE, salonId: SALON_A }], []);
      const res = await call();
      expect(res.status).toBe(404);
      expect(m.writes).toHaveLength(1);
      const [write] = m.writes;
      expect(write?.op).toBe(op);
      const q = whereOf(write?.where);
      // Dokładny tekst: spójnik `and` (nie `or`) i przypisanie parametrów do
      // kolumn — id wariantu = $1, service_id własnej usługi = $2 (audyt bezpieczeństwa, Y1–Y3).
      expect(q.sql).toBe('("service_variants"."id" = $1 and "service_variants"."service_id" = $2)');
      expect(q.params).toEqual([VARIANT_B, SERVICE]);
      expect(m.insertedValues).toEqual([]);
    }
  );
});
