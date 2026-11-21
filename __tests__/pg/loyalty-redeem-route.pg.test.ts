/**
 * #193: `/api/clients/[id]/loyalty/redeem` na PRAWDZIWYM Postgresie — salony A i B.
 *
 * Trasa czyta ustawienia `salons` (polityka `tenant_self`), saldo `loyalty_points`
 * (polityka po `salon_id`) i dopisuje `loyalty_transactions` (polityka pośrednia
 * przez `loyalty_points`) — wszystko przez `forSalon(salonId)` z salonem z sesji
 * (rola bez BYPASSRLS + `app.current_salon_id`).
 *
 * Dowody:
 * - własny salon: odczyt salda i umorzenie jak dotąd (saldo, wpis transakcji);
 * - klient salonu B z sesją salonu A: saldo 0 na odczycie, 400 na umorzeniu,
 *   saldo i transakcje B bez zmian;
 * - nagroda zdefiniowana tylko w salonie B: 404 w salonie A;
 * - druga tama: wpis `loyalty_transactions` do konta punktów B w kontekście A
 *   odrzuca baza (42501), mimo że zapytanie nie ma filtra salonu.
 *
 * Sesja (`requireAuth`, `getUserSalonId`) zmockowana; baza prawdziwa.
 * Dane: użytkownicy `it-t3-loyalty-…`; reszta kaskadą z salonów w `afterAll`.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/<baza> pnpm test:pg -- __tests__/pg/loyalty-redeem-route.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate` (RLS i rola `myhelper_app`).
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as redeem from "@/app/api/clients/[id]/loyalty/redeem/route";
import { clients, loyaltyPoints, loyaltyTransactions, salons, user } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { createMockRequest, createRouteParams, parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ salonId: "" }));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: async () => ({ user: { id: "it-t3-loyalty-caller" } }),
  isAuthError: (r: unknown) => r instanceof Response,
}));
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: async () => ctl.salonId,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-loyalty-a-${RUN}`;
const OWNER_B = `it-t3-loyalty-b-${RUN}`;
const TIER_A = { id: randomUUID(), name: "IT rabat A", pointsRequired: 100, rewardType: "discount", rewardValue: 10 };
const TIER_B = { id: randomUUID(), name: "IT rabat B", pointsRequired: 50, rewardType: "discount", rewardValue: 5 };

const ids = { salonA: "", salonB: "", clientA: "", clientB: "", loyaltyA: "", loyaltyB: "" };

// Body jak z panelu: { rewardTierId, salonId } (salonId trasa ignoruje — salon z sesji).
const postReq = (clientId: string, rewardTierId: string) =>
  createMockRequest(`http://localhost/api/clients/${clientId}/loyalty/redeem`, {
    method: "POST",
    body: { rewardTierId, salonId: ctl.salonId },
  });
const getReq = (clientId: string) => createMockRequest(`http://localhost/api/clients/${clientId}/loyalty/redeem`);

async function pointsOf(loyaltyId: string) {
  const [row] = await h!.db.select({ points: loyaltyPoints.points }).from(loyaltyPoints).where(eq(loyaltyPoints.id, loyaltyId));
  return row?.points;
}
async function transactionsOf(loyaltyId: string) {
  return h!.db.select().from(loyaltyTransactions).where(eq(loyaltyTransactions.loyaltyId, loyaltyId));
}

const suite = h ? describe : describe.skip;

suite("loyalty/redeem: salony A i B, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_A, name: "IT T3 loyalty A", email: `${OWNER_A}@example.invalid` },
      { id: OWNER_B, name: "IT T3 loyalty B", email: `${OWNER_B}@example.invalid` },
    ]);
    const [a] = await db
      .insert(salons)
      .values({
        name: `IT T3 loyalty A ${RUN}`,
        ownerId: OWNER_A,
        settingsJson: { loyalty: { enabled: true, rewardTiers: [TIER_A] } },
      })
      .returning();
    const [b] = await db
      .insert(salons)
      .values({
        name: `IT T3 loyalty B ${RUN}`,
        ownerId: OWNER_B,
        settingsJson: { loyalty: { enabled: true, rewardTiers: [TIER_A, TIER_B] } },
      })
      .returning();
    ids.salonA = a!.id;
    ids.salonB = b!.id;
    const [ca] = await db.insert(clients).values({ salonId: ids.salonA, firstName: "Ala", lastName: "A" }).returning();
    const [cb] = await db.insert(clients).values({ salonId: ids.salonB, firstName: "Ola", lastName: "B" }).returning();
    ids.clientA = ca!.id;
    ids.clientB = cb!.id;
    const [la] = await db.insert(loyaltyPoints).values({ salonId: ids.salonA, clientId: ids.clientA, points: 250 }).returning();
    const [lb] = await db.insert(loyaltyPoints).values({ salonId: ids.salonB, clientId: ids.clientB, points: 300 }).returning();
    ids.loyaltyA = la!.id;
    ids.loyaltyB = lb!.id;
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
    ctl.salonId = ids.salonA;
  });

  it("GET A, klient A: saldo i nagrody salonu A", async () => {
    const { status, body } = await parseResponse<{ data: { enabled: boolean; points: number; allRewards: Array<{ id: string }> } }>(
      await redeem.GET(getReq(ids.clientA), createRouteParams(ids.clientA))
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.data.enabled).toBe(true);
    expect(body.data.points).toBe(250);
    expect(body.data.allRewards.map((r) => r.id)).toEqual([TIER_A.id]);
  });

  it("GET A, klient B: saldo B niewidoczne (0 punktów)", async () => {
    const { status, body } = await parseResponse<{ data: { points: number; availableRewards: unknown[] } }>(
      await redeem.GET(getReq(ids.clientB), createRouteParams(ids.clientB))
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.data.points).toBe(0);
    expect(body.data.availableRewards).toEqual([]);
  });

  it("POST A, klient B: 400 (dostępne 0); saldo i transakcje B bez zmian", async () => {
    const { status, body } = await parseResponse(await redeem.POST(postReq(ids.clientB, TIER_A.id), createRouteParams(ids.clientB)));
    expect(status, JSON.stringify(body)).toBe(400);
    expect(body.error).toBe("Niewystarczajaca liczba punktow. Wymagane: 100, dostepne: 0");
    expect(await pointsOf(ids.loyaltyB)).toBe(300);
    expect(await transactionsOf(ids.loyaltyB)).toEqual([]);
  });

  it("POST A, nagroda zdefiniowana tylko w B: 404, saldo A bez zmian", async () => {
    const { status, body } = await parseResponse(await redeem.POST(postReq(ids.clientA, TIER_B.id), createRouteParams(ids.clientA)));
    expect(status, JSON.stringify(body)).toBe(404);
    expect(body.error).toBe("Nie znaleziono nagrody o podanym ID");
    expect(await pointsOf(ids.loyaltyA)).toBe(250);
  });

  it("POST A, klient A: 200, saldo 150, jeden wpis -100 w A; B bez zmian", async () => {
    const { status, body } = await parseResponse<{
      data: { redemption: { transactionId: string; pointsSpent: number }; balance: unknown };
    }>(await redeem.POST(postReq(ids.clientA, TIER_A.id), createRouteParams(ids.clientA)));
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.data.balance).toEqual({ previousPoints: 250, currentPoints: 150 });
    expect(body.data.redemption.pointsSpent).toBe(100);
    expect(await pointsOf(ids.loyaltyA)).toBe(150);
    const txA = await transactionsOf(ids.loyaltyA);
    expect(txA).toHaveLength(1);
    expect(txA[0]!.id).toBe(body.data.redemption.transactionId);
    expect(txA[0]!.pointsChange).toBe(-100);
    expect(await pointsOf(ids.loyaltyB)).toBe(300);
    expect(await transactionsOf(ids.loyaltyB)).toEqual([]);
  });

  it("POST B, klient B: kontrola fałszywej zieleni — własny salon umarza", async () => {
    ctl.salonId = ids.salonB;
    const { status, body } = await parseResponse<{ data: { balance: unknown } }>(
      await redeem.POST(postReq(ids.clientB, TIER_B.id), createRouteParams(ids.clientB))
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.data.balance).toEqual({ previousPoints: 300, currentPoints: 250 });
    expect(await transactionsOf(ids.loyaltyB)).toHaveLength(1);
  });

  it("druga tama: wpis do konta punktów B w kontekście A odrzuca polityka RLS (42501)", async () => {
    const before = (await transactionsOf(ids.loyaltyB)).length;
    const attempt = forSalon(ids.salonA).raw((tx) =>
      tx.insert(loyaltyTransactions).values({ loyaltyId: ids.loyaltyB, pointsChange: -1, reason: "IT cross-salon" })
    );
    const err = (await attempt.then(
      () => null,
      (e: unknown) => e
    )) as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
    expect(err, "wpis do cudzego konta punktów przeszedł").not.toBeNull();
    // Drizzle może opakować błąd sterownika (`cause`); liczy się kod i komunikat polityki RLS.
    const pgErr = err!.cause ?? err!;
    expect(pgErr.code).toBe("42501");
    expect(pgErr.message).toMatch(/row-level security/i);
    expect(await transactionsOf(ids.loyaltyB)).toHaveLength(before);
  });
});
