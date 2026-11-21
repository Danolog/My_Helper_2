/**
 * #193: `/api/temporary-access` na PRAWDZIWYM Postgresie — salony A i B.
 *
 * Tabela temporary_access nie ma salon_id (RLS jej nie chroni): granty przez
 * wyjścia systemowe z warunkiem granted_by = właściciel salonu z sesji;
 * pracownik salonu w POST przez `forSalon(salon z sesji).raw` (rola bez
 * BYPASSRLS + `app.current_salon_id`). Bramka `requireSalonStaff` prawdziwa
 * (kontekst salonu z bazy), zmockowana tylko sesja Better Auth.
 *
 * Dowody:
 * - właściciel B nie widzi grantów salonu A (GET, także ?userId=);
 * - właściciel B nie cofnie grantu A (DELETE → 404), grant A zostaje;
 * - właściciel B nie nada dostępu pracownikowi A (POST → 404), brak nowego grantu;
 * - kontrola fałszywej zieleni: A widzi swój grant, przedłuża go (200, ten sam id),
 *   nadaje nowy (201), cofa (200);
 * - `PUT /api/employees/[id]/link-account` z email null (odpięcie konta) kasuje
 *   granty tego konta nadane w salonie wołającego (`revokeSalonGrantsForUser`
 *   na prawdziwej bazie); grant tego konta z salonu B zostaje.
 *
 * Dane: użytkownicy `it-t3-tmpacc-…`; granty kaskadą z użytkowników, reszta
 * kaskadą z salonów w `afterAll`.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/<baza> pnpm test:pg -- __tests__/pg/temporary-access-route.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate` (RLS i rola `myhelper_app`).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as linkAccount from "@/app/api/employees/[id]/link-account/route";
import * as route from "@/app/api/temporary-access/route";
import { employees, salons, temporaryAccess, user } from "@/lib/schema";
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
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({ user: { id: ctl.userId }, session: { id: `s-${ctl.userId}`, userId: ctl.userId } }),
    },
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
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-tmpacc-a-${RUN}`;
const OWNER_B = `it-t3-tmpacc-b-${RUN}`;
const STAFF_A = `it-t3-tmpacc-staffa-${RUN}`;
const USERS = [OWNER_A, OWNER_B, STAFF_A];

const ids = { salonA: "", salonB: "", empA: "", grantA: "" };

const BASE = "http://localhost/api/temporary-access";
const inOneHour = () => new Date(Date.now() + 60 * 60 * 1000);

function as(owner: "A" | "B") {
  ctl.salonId = owner === "A" ? ids.salonA : ids.salonB;
  ctl.userId = owner === "A" ? OWNER_A : OWNER_B;
}

async function call(res: Promise<Response>) {
  const r = await res;
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

const get = (query = "") => call(route.GET(new Request(`${BASE}${query}`)));
const del = (grantId: string) => call(route.DELETE(new Request(`${BASE}?grantId=${grantId}`, { method: "DELETE" })));
const post = (body: Record<string, unknown>) =>
  call(
    route.POST(
      new Request(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    )
  );

async function grantsOf(userId: string) {
  return h!.db
    .select({ id: temporaryAccess.id, grantedBy: temporaryAccess.grantedBy, featureName: temporaryAccess.featureName, expiresAt: temporaryAccess.expiresAt })
    .from(temporaryAccess)
    .where(eq(temporaryAccess.userId, userId));
}

async function insertGrant(grantedBy: string, featureName: string) {
  const [g] = await h!.db
    .insert(temporaryAccess)
    .values({ userId: STAFF_A, featureName, grantedBy, expiresAt: inOneHour() })
    .returning();
  return g!;
}

const suite = h ? describe : describe.skip;

suite("/api/temporary-access: salony A i B, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values(
      USERS.map((id) => ({ id, name: `IT T3 tmpacc ${id}`, email: `${id}@example.invalid`, emailVerified: true }))
    );
    const [a] = await db.insert(salons).values({ name: `IT T3 tmpacc A ${RUN}`, ownerId: OWNER_A }).returning();
    const [b] = await db.insert(salons).values({ name: `IT T3 tmpacc B ${RUN}`, ownerId: OWNER_B }).returning();
    ids.salonA = a!.id;
    ids.salonB = b!.id;
    const [ea] = await db
      .insert(employees)
      .values({ salonId: ids.salonA, firstName: "Ala", lastName: "A", userId: STAFF_A })
      .returning();
    ids.empA = ea!.id;
    ids.grantA = (await insertGrant(OWNER_A, "reports")).id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      for (const id of [ids.salonA, ids.salonB]) if (id) await h.db.delete(salons).where(eq(salons.id, id));
      await h.db.delete(user).where(inArray(user.id, USERS));
    } finally {
      await h.end();
    }
  });

  it("B nie widzi grantów salonu A (GET i GET ?userId=)", async () => {
    as("B");
    let res = await get();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.data as Array<{ id: string }>).map((g) => g.id)).not.toContain(ids.grantA);
    expect(res.body.count).toBe(0);

    res = await get(`?userId=${STAFF_A}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("B nie cofnie grantu A: 404, grant A zostaje", async () => {
    as("B");
    const res = await del(ids.grantA);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe("Nie znaleziono uprawnienia");
    expect((await grantsOf(STAFF_A)).map((g) => g.id)).toContain(ids.grantA);
  });

  it("B nie nada dostępu pracownikowi A: 404, brak grantu od B", async () => {
    as("B");
    const res = await post({ userId: STAFF_A, featureName: "reports", durationMinutes: 60 });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe("Uzytkownik nie jest pracownikiem tego salonu");
    expect((await grantsOf(STAFF_A)).filter((g) => g.grantedBy === OWNER_B)).toEqual([]);
  });

  it("kontrola fałszywej zieleni: A widzi, przedłuża (200), nadaje nowy (201), cofa (200)", async () => {
    as("A");
    let res = await get(`?userId=${STAFF_A}`);
    expect(res.status).toBe(200);
    expect((res.body.data as Array<{ id: string }>).map((g) => g.id)).toEqual([ids.grantA]);

    const [before] = (await grantsOf(STAFF_A)).filter((g) => g.id === ids.grantA);
    res = await post({ userId: STAFF_A, featureName: "reports", durationMinutes: 120 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.message).toBe("Czasowy dostep zostal zaktualizowany");
    expect((res.body.data as { id: string }).id).toBe(ids.grantA);
    const [after] = (await grantsOf(STAFF_A)).filter((g) => g.id === ids.grantA);
    expect(after!.expiresAt.getTime()).toBeGreaterThan(before!.expiresAt.getTime());
    expect((await grantsOf(STAFF_A)).filter((g) => g.featureName === "reports")).toHaveLength(1);

    res = await post({ userId: STAFF_A, featureName: "finance", durationMinutes: 60 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const newId = (res.body.data as { id: string; grantedBy: string }).id;
    expect((res.body.data as { grantedBy: string }).grantedBy).toBe(OWNER_A);

    res = await del(newId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await grantsOf(STAFF_A)).map((g) => g.id)).not.toContain(newId);
    expect((await grantsOf(STAFF_A)).map((g) => g.id)).toContain(ids.grantA);
  });

  it("odpięcie konta pracownika (link-account, email null) kasuje granty tego konta w salonie A; grant z salonu B zostaje", async () => {
    const extraA = await insertGrant(OWNER_A, "settings");
    const fromB = await insertGrant(OWNER_B, "reports");

    as("A");
    const { status, body } = await parseResponse(
      await linkAccount.PUT(
        createMockRequest(`http://localhost/api/employees/${ids.empA}/link-account`, {
          method: "PUT",
          body: { email: null },
        }),
        createRouteParams(ids.empA)
      )
    );
    expect(status, JSON.stringify(body)).toBe(200);

    const [emp] = await h!.db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, ids.empA));
    expect(emp!.userId).toBeNull();
    const left = await grantsOf(STAFF_A);
    expect(left.filter((g) => g.grantedBy === OWNER_A)).toEqual([]);
    expect(left.map((g) => g.id)).not.toContain(ids.grantA);
    expect(left.map((g) => g.id)).not.toContain(extraA.id);
    expect(left.map((g) => g.id)).toEqual([fromB.id]);

    // Grant z salonu B usuwamy jawnie (sprzątanie testu).
    await h!.db
      .delete(temporaryAccess)
      .where(and(eq(temporaryAccess.id, fromB.id), eq(temporaryAccess.grantedBy, OWNER_B)));
  });
});
