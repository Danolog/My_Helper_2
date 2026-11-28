/**
 * `getUserSalonId` (`@/lib/get-user-salon`) na PRAWDZIWYM Postgresie.
 *
 * Salon z `getUserSalonId` to wyłącznie salon, którego konto jest właścicielem
 * (`salons.owner_id`). Konto podpięte pod aktywny rekord pracownika dostaje null,
 * także przy roli recepcji.
 *
 * Dowody:
 * - konto z aktywnym rekordem pracownika (rola `employee`) → null;
 * - konto z aktywnym rekordem pracownika (rola `receptionist`) → null;
 * - kontrola fałszywej zieleni: właściciel tego samego salonu → id salonu.
 *
 * Sesja Better Auth zmockowana (id konta z `ctl.userId`); baza prawdziwa.
 * Dane: użytkownicy `it-gus-staff-…`; pracownicy kaskadą z salonu w `afterAll`.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/<baza> pnpm test:pg -- __tests__/pg/get-user-salon-staff.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate`.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getUserSalonId } from "@/lib/get-user-salon";
import { employees, salons, user } from "@/lib/schema";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ userId: "" }));

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
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const OWNER = `it-gus-staff-owner-${RUN}`;
const STAFF = `it-gus-staff-emp-${RUN}`;
const RECEPTION = `it-gus-staff-rec-${RUN}`;
const USERS = [OWNER, STAFF, RECEPTION];

const ids = { salon: "" };

const suite = h ? describe : describe.skip;

suite("getUserSalonId: konto pracownika bez salonu, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values(
      USERS.map((id) => ({ id, name: `IT gus staff ${id}`, email: `${id}.konto.invalid`, emailVerified: true }))
    );
    const [s] = await db.insert(salons).values({ name: `IT gus staff ${RUN}`, ownerId: OWNER }).returning();
    ids.salon = s!.id;
    await db.insert(employees).values([
      { salonId: ids.salon, firstName: "Ala", lastName: "Pracownik", userId: STAFF, role: "employee", isActive: true },
      { salonId: ids.salon, firstName: "Ola", lastName: "Recepcja", userId: RECEPTION, role: "receptionist", isActive: true },
    ]);
  });

  afterAll(async () => {
    if (!h) return;
    try {
      if (ids.salon) await h.db.delete(salons).where(eq(salons.id, ids.salon));
      await h.db.delete(user).where(inArray(user.id, USERS));
    } finally {
      await h.end();
    }
  });

  it("konto z aktywnym rekordem pracownika (rola employee) → null", async () => {
    const [row] = await h!.db.select({ isActive: employees.isActive }).from(employees).where(eq(employees.userId, STAFF));
    expect(row?.isActive).toBe(true);
    ctl.userId = STAFF;
    expect(await getUserSalonId()).toBeNull();
  });

  it("konto z aktywnym rekordem pracownika (rola receptionist) → null", async () => {
    ctl.userId = RECEPTION;
    expect(await getUserSalonId()).toBeNull();
  });

  it("kontrola: właściciel tego salonu → id salonu", async () => {
    ctl.userId = OWNER;
    expect(await getUserSalonId()).toBe(ids.salon);
  });
});
