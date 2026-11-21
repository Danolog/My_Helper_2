/**
 * #193: `DELETE /api/clients/[id]` na PRAWDZIWYM Postgresie — salony A i B.
 *
 * Trasa: własność klienta przez `forSalon(salon z sesji).findOne` (rola bez
 * BYPASSRLS + `app.current_salon_id`), hash hasła przez wyjście systemowe
 * `findCredentialPasswordHash` (pula systemowa, tabela `account`), usunięcie
 * przez `forSalon(...).deleteOwned`.
 *
 * Dowody:
 * - właściciel B z POPRAWNYM hasłem nie usunie klienta salonu A: 404, klient A zostaje;
 * - własny klient, złe hasło: 403, klient zostaje;
 * - kontrola fałszywej zieleni: własny klient, poprawne hasło → 200, wiersz znika;
 * - wyjście systemowe czyta hash konta `credential` wskazanego użytkownika (nie cudzego).
 *
 * Sesja (`auth.api.getSession`, `getSalonContext`) zmockowana; baza prawdziwa,
 * hash hasła prawdziwy (`better-auth/crypto`).
 * Dane: użytkownicy `it-t3-clidel-…`; reszta kaskadą z salonów i użytkowników w `afterAll`.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/<baza> pnpm test:pg -- __tests__/pg/clients-delete-route.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate` (RLS i rola `myhelper_app`).
 */
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as route from "@/app/api/clients/[id]/route";
import { account, clients, salons, user } from "@/lib/schema";
import { findCredentialPasswordHash } from "@/lib/server/system";
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
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: ctl.userId } }) } },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: async () => ({ salonId: ctl.salonId, role: "owner", employeeId: null, userId: ctl.userId }),
  hasFeatureAccess: async () => false,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-clidel-a-${RUN}`;
const OWNER_B = `it-t3-clidel-b-${RUN}`;
const PASSWORD_A = `IT-haslo-A-${RUN}`;
const PASSWORD_B = `IT-haslo-B-${RUN}`;

const ids = { salonA: "", salonB: "", clientA: "", clientB: "", clientB2: "" };

const deleteReq = (clientId: string, password: string) =>
  createMockRequest(`http://localhost/api/clients/${clientId}`, { method: "DELETE", body: { password } });

async function clientExists(id: string) {
  const rows = await h!.db.select({ id: clients.id }).from(clients).where(eq(clients.id, id));
  return rows.length === 1;
}

const suite = h ? describe : describe.skip;

suite("DELETE /api/clients/[id]: salony A i B, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_A, name: "IT T3 clidel A", email: `${OWNER_A}@example.invalid` },
      { id: OWNER_B, name: "IT T3 clidel B", email: `${OWNER_B}@example.invalid` },
    ]);
    const now = new Date();
    await db.insert(account).values([
      {
        id: `${OWNER_A}-acc`,
        accountId: OWNER_A,
        providerId: "credential",
        userId: OWNER_A,
        password: await hashPassword(PASSWORD_A),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `${OWNER_B}-acc`,
        accountId: OWNER_B,
        providerId: "credential",
        userId: OWNER_B,
        password: await hashPassword(PASSWORD_B),
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const [a] = await db.insert(salons).values({ name: `IT T3 clidel A ${RUN}`, ownerId: OWNER_A }).returning();
    const [b] = await db.insert(salons).values({ name: `IT T3 clidel B ${RUN}`, ownerId: OWNER_B }).returning();
    ids.salonA = a!.id;
    ids.salonB = b!.id;
    const [ca] = await db.insert(clients).values({ salonId: ids.salonA, firstName: "Ala", lastName: "A" }).returning();
    const [cb] = await db.insert(clients).values({ salonId: ids.salonB, firstName: "Ola", lastName: "B" }).returning();
    const [cb2] = await db.insert(clients).values({ salonId: ids.salonB, firstName: "Ela", lastName: "B2" }).returning();
    ids.clientA = ca!.id;
    ids.clientB = cb!.id;
    ids.clientB2 = cb2!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      for (const id of [ids.salonA, ids.salonB]) if (id) await h.db.delete(salons).where(eq(salons.id, id));
      await h.db.delete(user).where(inArray(user.id, [OWNER_A, OWNER_B]));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    ctl.salonId = ids.salonB;
    ctl.userId = OWNER_B;
  });

  it("wyjście systemowe: hash konta credential wskazanego użytkownika; nieznany użytkownik → null", async () => {
    const hashB = await findCredentialPasswordHash(OWNER_B);
    const hashA = await findCredentialPasswordHash(OWNER_A);
    expect(hashB).toEqual(expect.any(String));
    expect(hashA).toEqual(expect.any(String));
    expect(hashB).not.toBe(hashA);
    expect(await findCredentialPasswordHash(`it-t3-clidel-none-${RUN}`)).toBeNull();
  });

  it("B z poprawnym hasłem B, klient salonu A: 404, klient A zostaje", async () => {
    const { status, body } = await parseResponse(
      await route.DELETE(deleteReq(ids.clientA, PASSWORD_B), createRouteParams(ids.clientA))
    );
    expect(status, JSON.stringify(body)).toBe(404);
    expect(body.error).toBe("Client not found");
    expect(await clientExists(ids.clientA)).toBe(true);
  });

  it("B z hasłem właściciela A, klient salonu A: 404 (bez sprawdzania hasła), klient A zostaje", async () => {
    const { status, body } = await parseResponse(
      await route.DELETE(deleteReq(ids.clientA, PASSWORD_A), createRouteParams(ids.clientA))
    );
    expect(status, JSON.stringify(body)).toBe(404);
    expect(await clientExists(ids.clientA)).toBe(true);
  });

  it("B, własny klient, złe hasło (hasło A): 403, klient zostaje", async () => {
    const { status, body } = await parseResponse(
      await route.DELETE(deleteReq(ids.clientB2, PASSWORD_A), createRouteParams(ids.clientB2))
    );
    expect(status, JSON.stringify(body)).toBe(403);
    expect(body.error).toBe("Nieprawidlowe haslo");
    expect(await clientExists(ids.clientB2)).toBe(true);
  });

  it("kontrola fałszywej zieleni: B, własny klient, poprawne hasło → 200, wiersz znika; klient A zostaje", async () => {
    const { status, body } = await parseResponse<{ data: { id: string } }>(
      await route.DELETE(deleteReq(ids.clientB, PASSWORD_B), createRouteParams(ids.clientB))
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.data.id).toBe(ids.clientB);
    expect(await clientExists(ids.clientB)).toBe(false);
    expect(await clientExists(ids.clientA)).toBe(true);
  });
});
