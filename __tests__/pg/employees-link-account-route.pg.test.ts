/**
 * #193: `PUT /api/employees/[id]/link-account` na PRAWDZIWYM Postgresie — salony A i B.
 *
 * Trasa: pracownik przez `forSalon(salon z sesji).findOne/updateOwned` (rola bez
 * BYPASSRLS + `app.current_salon_id`), konto i reguły obejmujące wszystkie salony
 * przez wyjście systemowe `findAccountForEmployeeLink` (pula systemowa).
 *
 * Dowody:
 * - konto podpięte pod pracownika salonu B: właściciel A nie podepnie go u siebie (409),
 *   oba powiązania bez zmian;
 * - konto właściciela salonu B: właściciel A nie podepnie go jako pracownika (409);
 * - właściciel B nie podepnie konta do pracownika salonu A (404), pracownik A bez zmian;
 * - kontrola fałszywej zieleni: właściciel A podpina wolne konto u siebie (200), ponownie
 *   to samo konto (200, `exceptEmployeeId`), odpina (200, userId null).
 *
 * Sesja (`requireAuth`, `getUserSalonId`) zmockowana; baza prawdziwa. Granty czasowe
 * (`revokeSalonGrantsForUser`) tu atrapa — kasowanie grantów przy odpięciu konta na
 * prawdziwej bazie sprawdza `temporary-access-route.pg.test.ts`.
 * Dane: użytkownicy `it-t3-emplink-…`; reszta kaskadą z salonów i użytkowników w `afterAll`.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/<baza> pnpm test:pg -- __tests__/pg/employees-link-account-route.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate` (RLS i rola `myhelper_app`).
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as route from "@/app/api/employees/[id]/link-account/route";
import { employees, salons, user } from "@/lib/schema";
import { findAccountForEmployeeLink } from "@/lib/server/system";
import { createMockRequest, createRouteParams, parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ salonId: "", userId: "" }));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
// Pula systemowa jawnie na tę samą bazę (wygrywa z bezpiecznikiem z __tests__/setup.ts).
vi.mock("@/lib/server/system/db-system", () => ({
  get dbSystem() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: async () => ({ user: { id: ctl.userId } }),
  isAuthError: () => false,
  requireCronSecret: async () => null,
}));
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: async () => ctl.salonId,
}));
vi.mock("@/lib/temporary-access", () => ({
  revokeSalonGrantsForUser: async () => 0,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-emplink-a-${RUN}`;
const OWNER_B = `it-t3-emplink-b-${RUN}`;
const STAFF_B = `it-t3-emplink-staffb-${RUN}`;
const FREE = `it-t3-emplink-free-${RUN}`;
const emailOf = (id: string) => `${id}@example.invalid`;

const ids = { salonA: "", salonB: "", empA: "", empB: "" };

const putReq = (employeeId: string, email: string | null) =>
  createMockRequest(`http://localhost/api/employees/${employeeId}/link-account`, {
    method: "PUT",
    body: { email },
  });

async function linkedUserOf(employeeId: string) {
  const [row] = await h!.db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employeeId));
  return row?.userId ?? null;
}

function as(owner: "A" | "B") {
  ctl.salonId = owner === "A" ? ids.salonA : ids.salonB;
  ctl.userId = owner === "A" ? OWNER_A : OWNER_B;
}

const suite = h ? describe : describe.skip;

suite("PUT /api/employees/[id]/link-account: salony A i B, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values(
      [OWNER_A, OWNER_B, STAFF_B, FREE].map((id) => ({
        id,
        name: `IT T3 emplink ${id}`,
        email: emailOf(id),
        emailVerified: true,
      }))
    );
    const [a] = await db.insert(salons).values({ name: `IT T3 emplink A ${RUN}`, ownerId: OWNER_A }).returning();
    const [b] = await db.insert(salons).values({ name: `IT T3 emplink B ${RUN}`, ownerId: OWNER_B }).returning();
    ids.salonA = a!.id;
    ids.salonB = b!.id;
    const [ea] = await db
      .insert(employees)
      .values({ salonId: ids.salonA, firstName: "Ala", lastName: "A" })
      .returning();
    const [eb] = await db
      .insert(employees)
      .values({ salonId: ids.salonB, firstName: "Ola", lastName: "B", userId: STAFF_B })
      .returning();
    ids.empA = ea!.id;
    ids.empB = eb!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      for (const id of [ids.salonA, ids.salonB]) if (id) await h.db.delete(salons).where(eq(salons.id, id));
      await h.db.delete(user).where(inArray(user.id, [OWNER_A, OWNER_B, STAFF_B, FREE]));
    } finally {
      await h.end();
    }
  });

  it("wyjście systemowe: flagi dla kont z bazy; exceptEmployeeId wyłącza własnego pracownika", async () => {
    expect(await findAccountForEmployeeLink(emailOf(STAFF_B), ids.empA)).toEqual({
      id: STAFF_B,
      emailVerified: true,
      linkedElsewhere: true,
      ownsSalon: false,
    });
    expect(await findAccountForEmployeeLink(emailOf(STAFF_B), ids.empB)).toMatchObject({ linkedElsewhere: false });
    expect(await findAccountForEmployeeLink(emailOf(OWNER_B), ids.empA)).toMatchObject({
      id: OWNER_B,
      linkedElsewhere: false,
      ownsSalon: true,
    });
    expect(await findAccountForEmployeeLink(`it-t3-emplink-none-${RUN}@example.invalid`, ids.empA)).toBeNull();
  });

  it("A podpina konto pracownika salonu B: 409, oba powiązania bez zmian", async () => {
    as("A");
    const { status, body } = await parseResponse(
      await route.PUT(putReq(ids.empA, emailOf(STAFF_B)), createRouteParams(ids.empA))
    );
    expect(status, JSON.stringify(body)).toBe(409);
    expect(body.error).toBe("To konto jest juz przypisane do innego pracownika");
    expect(await linkedUserOf(ids.empA)).toBeNull();
    expect(await linkedUserOf(ids.empB)).toBe(STAFF_B);
  });

  it("A podpina konto właściciela salonu B: 409, pracownik A bez konta", async () => {
    as("A");
    const { status, body } = await parseResponse(
      await route.PUT(putReq(ids.empA, emailOf(OWNER_B)), createRouteParams(ids.empA))
    );
    expect(status, JSON.stringify(body)).toBe(409);
    expect(body.error).toBe("Wlasciciel salonu nie moze byc pracownikiem innego salonu");
    expect(await linkedUserOf(ids.empA)).toBeNull();
  });

  it("B podpina wolne konto do pracownika salonu A: 404, pracownik A bez konta", async () => {
    as("B");
    const { status, body } = await parseResponse(
      await route.PUT(putReq(ids.empA, emailOf(FREE)), createRouteParams(ids.empA))
    );
    expect(status, JSON.stringify(body)).toBe(404);
    expect(body.error).toBe("Nie znaleziono pracownika");
    expect(await linkedUserOf(ids.empA)).toBeNull();
  });

  it("B odpina konto pracownika salonu A (email null): 404", async () => {
    as("B");
    const { status } = await parseResponse(await route.PUT(putReq(ids.empA, null), createRouteParams(ids.empA)));
    expect(status).toBe(404);
  });

  it("kontrola fałszywej zieleni: A podpina wolne konto (200), ponownie (200), odpina (200)", async () => {
    as("A");
    let res = await parseResponse(await route.PUT(putReq(ids.empA, emailOf(FREE)), createRouteParams(ids.empA)));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await linkedUserOf(ids.empA)).toBe(FREE);

    res = await parseResponse(await route.PUT(putReq(ids.empA, emailOf(FREE)), createRouteParams(ids.empA)));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await linkedUserOf(ids.empA)).toBe(FREE);

    res = await parseResponse(await route.PUT(putReq(ids.empA, null), createRouteParams(ids.empA)));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await linkedUserOf(ids.empA)).toBeNull();
    expect(await linkedUserOf(ids.empB)).toBe(STAFF_B);
  });
});
