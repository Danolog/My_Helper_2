/**
 * POST `/api/appointments/[id]/complete` i GET/POST `/api/appointments/[id]/invoice`
 * pod rolą aplikacji (#193) na PRAWDZIWYM Postgresie:
 * - właściciel A domyka wizytę A → 200; `treatment_history`, `appointment_materials`
 *   i `employee_commissions` (polityki pośrednie) zapisane i widoczne tylko w kontekście A,
 *   stan produktu A zmniejszony;
 * - sesja salonu B domyka wizytę A → 404, zero zapisów, stan produktu bez zmian;
 * - usługa A podpięta do produktu salonu B (dane niespójne, wstawione rolą migracji)
 *   → domknięcie 200, produkt B niewidoczny: stan B bez zmian, bez wpisu materiału;
 * - właściciel A wystawia paragon → 200, faktura z `salon_id` A, sprzedawca = salon A,
 *   kwota = usługa + materiały A; GET A → hasInvoice true, GET B → hasInvoice false;
 * - sesja salonu B wystawia paragon na wizytę A → 404, zero faktur;
 * - materiał wizyty A wskazujący produkt salonu B → cena produktu B poza kwotą.
 *
 * Trasy wołane bezpośrednio; atrapa sesji (`auth.api.getSession`), nagłówków i loggera;
 * `@/lib/db` wskazuje bazę testową. Kontekst salonu i `forSalon` prawdziwe.
 *
 * Dane: konta `it-t3-a3-…` (właściciele A i B), salony A i B, pracownik, klient,
 * usługa i produkty, wizyty z terminami w 2096. Salony usuwane w `afterAll` (kaskada).
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as completeRoute from "@/app/api/appointments/[id]/complete/route";
import * as invoiceRoute from "@/app/api/appointments/[id]/invoice/route";
import {
  appointmentMaterials,
  appointments,
  clients,
  employeeCommissions,
  employees,
  invoices,
  products,
  serviceProducts,
  services,
  salons,
  treatmentHistory,
  user,
} from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { createMockRequest, createRouteParams, parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ userId: "" }));
const mocks = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        ctl.userId ? { user: { id: ctl.userId, email: `${ctl.userId}@example.invalid`, name: "IT" }, session: { id: `s-${ctl.userId}`, userId: ctl.userId } } : null,
    },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.error, info: vi.fn(), warn: mocks.warn, debug: vi.fn() },
}));

const suite = h ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-a3-a-${RUN}`;
const OWNER_B = `it-t3-a3-b-${RUN}`;
const SALON_A_NAME = `IT T3 a3 A ${RUN}`;
const ids = { salonA: "", salonB: "", empA: "", clientA: "", serviceA: "", productA: "", productB: "" };
let slot = 0;

/** Wizyta salonu A (rola migracji); każda w osobnym terminie. */
async function appointment(status = "scheduled", serviceId: string | null = ids.serviceA): Promise<string> {
  const start = new Date(Date.UTC(2096, 2, 1, 8) + slot++ * 3_600_000);
  const [a] = await h!.db
    .insert(appointments)
    .values({
      salonId: ids.salonA,
      employeeId: ids.empA,
      clientId: ids.clientA,
      serviceId,
      startTime: start,
      endTime: new Date(start.getTime() + 1_800_000),
      status,
    })
    .returning({ id: appointments.id });
  return a!.id;
}

/** Osobna usługa salonu A (żeby powiązania produktów nie mieszały się między testami). */
async function serviceA(name: string): Promise<string> {
  const [s] = await h!.db
    .insert(services)
    .values({ salonId: ids.salonA, name, basePrice: "200.00", baseDuration: 30 })
    .returning({ id: services.id });
  return s!.id;
}

async function productQty(id: string) {
  const [p] = await h!.db.select({ quantity: products.quantity }).from(products).where(eq(products.id, id));
  return p!.quantity;
}

async function statusOf(appt: string) {
  const [a] = await h!.db.select({ status: appointments.status }).from(appointments).where(eq(appointments.id, appt));
  return a!.status;
}

/** Kwota i metoda płatności są wymagane przy zakończeniu wizyty. */
const complete = (id: string, body: Record<string, unknown> = {}) =>
  completeRoute.POST(
    createMockRequest(`http://localhost/api/appointments/${id}/complete`, {
      method: "POST",
      body: { paidAmount: "200.00", paymentMethod: "cash", ...body },
    }),
    createRouteParams(id)
  );

const issue = (id: string, body: Record<string, unknown>) =>
  invoiceRoute.POST(
    createMockRequest(`http://localhost/api/appointments/${id}/invoice`, { method: "POST", body }) as never,
    createRouteParams(id)
  );

const check = (id: string) =>
  invoiceRoute.GET(createMockRequest(`http://localhost/api/appointments/${id}/invoice`) as never, createRouteParams(id));

suite("complete i invoice wizyty pod rolą aplikacji — prawdziwy Postgres (#193)", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_A, name: "IT T3 a3 A", email: `${OWNER_A}@example.invalid` },
      { id: OWNER_B, name: "IT T3 a3 B", email: `${OWNER_B}@example.invalid` },
    ]);
    const [a] = await db.insert(salons).values({ name: SALON_A_NAME, ownerId: OWNER_A }).returning({ id: salons.id });
    const [b] = await db.insert(salons).values({ name: `IT T3 a3 B ${RUN}`, ownerId: OWNER_B }).returning({ id: salons.id });
    ids.salonA = a!.id;
    ids.salonB = b!.id;
    const [e] = await db
      .insert(employees)
      .values({ salonId: ids.salonA, firstName: "IT", lastName: "Pracownik", commissionRate: "40" })
      .returning({ id: employees.id });
    ids.empA = e!.id;
    const [c] = await db
      .insert(clients)
      .values({ salonId: ids.salonA, firstName: "IT", lastName: "Klient", phone: "+48000600731" })
      .returning({ id: clients.id });
    ids.clientA = c!.id;
    ids.serviceA = await serviceA("IT a3 usługa");
    const [pa] = await db
      .insert(products)
      .values({ salonId: ids.salonA, name: "IT a3 produkt A", quantity: "10", pricePerUnit: "5.00" })
      .returning({ id: products.id });
    const [pb] = await db
      .insert(products)
      .values({ salonId: ids.salonB, name: "IT a3 produkt B", quantity: "10", pricePerUnit: "100.00" })
      .returning({ id: products.id });
    ids.productA = pa!.id;
    ids.productB = pb!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      for (const s of [ids.salonA, ids.salonB]) if (s) await h.db.delete(salons).where(eq(salons.id, s));
      await h.db.delete(user).where(inArray(user.id, [OWNER_A, OWNER_B]));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    ctl.userId = "";
    mocks.error.mockClear();
    mocks.warn.mockClear();
  });

  describe("POST complete", () => {
    it("właściciel A → 200; zapisy w tabelach pośrednich widoczne tylko w kontekście A, stan produktu A zmniejszony", async () => {
      const svc = await serviceA("IT a3 usługa z produktem A");
      await h!.db.insert(serviceProducts).values({ serviceId: svc, productId: ids.productA, defaultQuantity: "2" });
      const appt = await appointment("scheduled", svc);
      const qtyBefore = Number(await productQty(ids.productA));
      ctl.userId = OWNER_A;

      const res = await parseResponse<{
        success: boolean;
        data: { appointment: { status: string }; commission: { amount: string } | null; stockDeductions: { productId: string }[] };
      }>(await complete(appt, { notes: "it-a3 notatka" }));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.appointment.status).toBe("completed");
      expect(res.body.data.commission).toMatchObject({ amount: "80.00" });
      expect(res.body.data.stockDeductions.map((d) => d.productId)).toEqual([ids.productA]);
      expect(await statusOf(appt)).toBe("completed");
      expect(Number(await productQty(ids.productA))).toBe(qtyBefore - 2);

      // Celowo bez filtra wizyty po salonie: niewidoczność w B daje sama polityka pośrednia.
      const read = (salonId: string) =>
        forSalon(salonId).raw(async (tx) => ({
          treatment: await tx.select({ id: treatmentHistory.id }).from(treatmentHistory).where(eq(treatmentHistory.appointmentId, appt)),
          materials: await tx.select({ id: appointmentMaterials.id }).from(appointmentMaterials).where(eq(appointmentMaterials.appointmentId, appt)),
          commissions: await tx.select({ id: employeeCommissions.id }).from(employeeCommissions).where(eq(employeeCommissions.appointmentId, appt)),
        }));
      const inA = await read(ids.salonA);
      const inB = await read(ids.salonB);
      expect([inA.treatment.length, inA.materials.length, inA.commissions.length]).toEqual([1, 1, 1]);
      expect([inB.treatment.length, inB.materials.length, inB.commissions.length]).toEqual([0, 0, 0]);
      expect(mocks.error).not.toHaveBeenCalled();
    });

    it("sesja salonu B na wizycie A → 404, wizyta i stan produktu bez zmian, zero zapisów", async () => {
      const svc = await serviceA("IT a3 usługa B-próba");
      await h!.db.insert(serviceProducts).values({ serviceId: svc, productId: ids.productA, defaultQuantity: "1" });
      const appt = await appointment("scheduled", svc);
      const qtyBefore = await productQty(ids.productA);
      ctl.userId = OWNER_B;

      const res = await parseResponse(await complete(appt, { notes: "it-a3 salon B" }));

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        success: false,
        code: "APPOINTMENT_NOT_FOUND",
        error: "Nie znaleziono tej wizyty albo nie jest już przypisana do Ciebie. Odśwież kalendarz.",
      });
      expect(await statusOf(appt)).toBe("scheduled");
      expect(await productQty(ids.productA)).toBe(qtyBefore);
      const db = h!.db;
      expect(await db.select().from(treatmentHistory).where(eq(treatmentHistory.appointmentId, appt))).toHaveLength(0);
      expect(await db.select().from(appointmentMaterials).where(eq(appointmentMaterials.appointmentId, appt))).toHaveLength(0);
      expect(await db.select().from(employeeCommissions).where(eq(employeeCommissions.appointmentId, appt))).toHaveLength(0);
    });

    it("usługa A podpięta do produktu salonu B → 200, produkt B niewidoczny: stan B bez zmian, bez wpisu materiału", async () => {
      const svc = await serviceA("IT a3 usługa z produktem B");
      // Dane niespójne między salonami (rola migracji omija RLS).
      await h!.db.insert(serviceProducts).values({ serviceId: svc, productId: ids.productB, defaultQuantity: "3" });
      const appt = await appointment("scheduled", svc);
      const qtyB = await productQty(ids.productB);
      ctl.userId = OWNER_A;

      const res = await parseResponse<{ data: { stockDeductions: unknown[] } }>(await complete(appt));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.stockDeductions).toEqual([]);
      expect(await productQty(ids.productB)).toBe(qtyB);
      expect(
        await h!.db.select().from(appointmentMaterials).where(eq(appointmentMaterials.appointmentId, appt))
      ).toHaveLength(0);
    });
  });

  describe("invoice", () => {
    it("właściciel A: paragon → 200, faktura salonu A, sprzedawca A, kwota = usługa + materiał A; GET A true, GET B false", async () => {
      const appt = await appointment("completed");
      await h!.db.insert(appointmentMaterials).values({ appointmentId: appt, productId: ids.productA, quantityUsed: "2" });
      ctl.userId = OWNER_A;

      const res = await parseResponse<{
        data: { id: string; salonId: string; amount: string; appointmentId: string };
        invoiceData: { seller: { name: string }; summary: { totalAmount: string } };
      }>(await issue(appt, { type: "paragon", clientName: "IT Klient" }));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ salonId: ids.salonA, appointmentId: appt, amount: "210.00" });
      expect(res.body.invoiceData.seller.name).toBe(SALON_A_NAME);
      expect(res.body.invoiceData.summary.totalAmount).toBe("210.00");

      const own = await parseResponse<{ hasInvoice: boolean; data: { id: string } | null }>(await check(appt));
      expect(own.status).toBe(200);
      expect(own.body.hasInvoice).toBe(true);
      expect(own.body.data!.id).toBe(res.body.data.id);

      ctl.userId = OWNER_B;
      const foreign = await parseResponse(await check(appt));
      expect(foreign.status).toBe(200);
      expect(foreign.body).toEqual({ success: true, data: null, hasInvoice: false });
      expect(mocks.error).not.toHaveBeenCalled();
    });

    it("sesja salonu B: paragon na wizytę A → 404, zero faktur", async () => {
      const appt = await appointment("completed");
      ctl.userId = OWNER_B;

      const res = await parseResponse(await issue(appt, { type: "paragon", clientName: "IT B" }));

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, error: "Wizyta nie zostala znaleziona" });
      expect(await h!.db.select().from(invoices).where(eq(invoices.appointmentId, appt))).toHaveLength(0);
    });

    it("materiał wizyty A wskazujący produkt salonu B → cena produktu B poza kwotą", async () => {
      const appt = await appointment("completed");
      // Dane niespójne między salonami (rola migracji omija RLS).
      await h!.db.insert(appointmentMaterials).values([
        { appointmentId: appt, productId: ids.productA, quantityUsed: "1" },
        { appointmentId: appt, productId: ids.productB, quantityUsed: "1" },
      ]);
      ctl.userId = OWNER_A;

      const res = await parseResponse<{ data: { amount: string } }>(
        await issue(appt, { type: "paragon", clientName: "IT Klient" })
      );

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.amount).toBe("205.00");
    });
  });
});
