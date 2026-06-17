/**
 * Testy RLS (Row-Level Security) na REALNEJ, LOKALNEJ bazie pod WŁĄCZONYM RLS.
 *
 * Dwa dowody wymagane przez ADR-001 (sekcja 4 i 5.4):
 *
 *  1. NEGATYWNY RLS bez warstwy aplikacji — zapytanie pod rolą `myhelper_app`
 *     (bez BYPASSRLS) BEZ ustawionego `app.current_salon_id` zwraca ZERO wierszy.
 *     To dowód „głębszej tamy": baza sama chroni, niezależnie od kodu trasy.
 *     A z ustawionym kontekstem własnego salonu — widzi tylko swoje wiersze.
 *
 *  2. WEBHOOK pod RLS — ścieżka systemowa (Stripe invoice.paid) działa pod rolą
 *     owner (omija RLS przez ENABLE-not-FORCE), więc renowacja subskrypcji zapisuje
 *     wiersz płatności POPRAWNIE (nie zero wierszy). Dowód, że największe ryzyko
 *     wdrożenia RLS (ciche zero na ścieżce bez kontekstu) jest zaadresowane.
 *
 * Seed/cleanup pod rolą owner (surowy db) — omija RLS (to powód, dla którego
 * ENABLE, nie FORCE). Guard host=localhost w setup-real-db.ts chroni przed prod.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { forSalon } from "@/lib/server/repository";
import {
  user,
  account,
  session as sessionTable,
  salons,
  clients,
  salonSubscriptions,
  subscriptionPayments,
  subscriptionPlans,
} from "@/lib/schema";

const APP_ROLE = process.env.MYHELPER_APP_DB_ROLE ?? "myhelper_app";

async function seedSalon(label: string) {
  const u = (
    await db
      .insert(user)
      .values({
        id: randomUUID(),
        name: `Owner ${label}`,
        email: `rls-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@test.local`,
        emailVerified: true,
        role: "owner",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
  )[0]!;

  const salon = (
    await db.insert(salons).values({ name: `Salon ${label}`, ownerId: u.id }).returning()
  )[0]!;

  const client = (
    await db
      .insert(clients)
      .values({ salonId: salon.id, firstName: "Klient", lastName: label })
      .returning()
  )[0]!;

  return { userId: u.id, salonId: salon.id, clientId: client.id };
}

let A: Awaited<ReturnType<typeof seedSalon>>;
let B: Awaited<ReturnType<typeof seedSalon>>;
const userIds: string[] = [];

beforeAll(async () => {
  A = await seedSalon("RLS-A");
  B = await seedSalon("RLS-B");
  userIds.push(A.userId, B.userId);
});

afterAll(async () => {
  // Cleanup pod rolą owner (omija RLS) — kasacja usera kaskaduje na salon/klientów.
  for (const id of userIds) {
    await db.delete(sessionTable).where(eq(sessionTable.userId, id));
    await db.delete(account).where(eq(account.userId, id));
    await db.delete(user).where(eq(user.id, id));
  }
});

describe("RLS — druga tama w bazie (rola myhelper_app bez BYPASSRLS)", () => {
  it("BEZ kontekstu salonu pod rolą app zwraca ZERO wierszy (dowód głębszej tamy)", async () => {
    // Symulujemy zapytanie aplikacji BEZ ustawionego app.current_salon_id:
    // tylko SET LOCAL ROLE myhelper_app, bez set_config. Polityka tenant_isolation
    // porównuje salon_id z NULL -> brak dopasowań -> 0 wierszy.
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local role ${APP_ROLE}`));
      return tx.select().from(clients);
    });
    expect(rows.length).toBe(0);
  });

  it("Z kontekstem salonu A widzi TYLKO klientów A, nigdy B", async () => {
    const ownA = await forSalon(A.salonId).listOwned(clients);
    const ids = ownA.map((c) => c.id);
    expect(ids).toContain(A.clientId);
    expect(ids).not.toContain(B.clientId);
    // Bezpośrednie sięgnięcie po klienta B z kontekstem A -> null (RLS odcina).
    const foreign = await forSalon(A.salonId).findOne(clients, B.clientId);
    expect(foreign).toBeNull();
  });

  it("Owner (seed/migrator) OMIJA RLS — widzi wiersze obu salonów", async () => {
    // Bez SET LOCAL ROLE — połączenie ownera. ENABLE-not-FORCE => polityki nie obowiązują.
    const all = await db.select().from(clients);
    const ids = all.map((c) => c.id);
    expect(ids).toContain(A.clientId);
    expect(ids).toContain(B.clientId);
  });
});

describe("RLS — ścieżka systemowa (webhook Stripe) działa mimo RLS (ADR sekcja 4)", () => {
  it("invoice.paid pod rolą owner zapisuje płatność renowacji (nie zero wierszy)", async () => {
    // Webhook Stripe NIE ma sesji salonu — działa pod rolą owner (omija RLS),
    // wyznaczając salon z subskrypcji. Tu odtwarzamy realny zapis handlera
    // handleInvoicePaid: insert subscriptionPayments scoped do salonu z subskrypcji.
    const plan = (
      await db
        .insert(subscriptionPlans)
        .values({
          name: `RLS Test Plan ${randomUUID().slice(0, 6)}`,
          slug: `rls-plan-${randomUUID().slice(0, 8)}`,
          priceMonthly: "199.00",
        })
        .returning()
    )[0]!;

    const stripeSubId = `sub_rls_${randomUUID().slice(0, 12)}`;
    const sub = (
      await db
        .insert(salonSubscriptions)
        .values({
          salonId: A.salonId,
          planId: plan.id,
          status: "active",
          stripeSubscriptionId: stripeSubId,
        })
        .returning()
    )[0]!;

    // Zapis renowacji — jak w handleInvoicePaid (transakcja pod rolą owner = bez
    // SET LOCAL ROLE; RLS omijane przez ENABLE-not-FORCE, mimo polityki na tabeli).
    await db.transaction(async (tx) => {
      await tx
        .update(salonSubscriptions)
        .set({ status: "active" })
        .where(eq(salonSubscriptions.id, sub.id));
      await tx.insert(subscriptionPayments).values({
        subscriptionId: sub.id,
        salonId: sub.salonId,
        amount: plan.priceMonthly,
        currency: "PLN",
        stripePaymentIntentId: `pi_rls_${randomUUID().slice(0, 12)}`,
        status: "succeeded",
        paidAt: new Date(),
      });
    });

    // Dowód: płatność faktycznie wylądowała (rola systemowa NIE dostała 0 wierszy).
    const payments = await db
      .select()
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.subscriptionId, sub.id));
    expect(payments.length).toBe(1);
    expect(payments[0]?.status).toBe("succeeded");

    // Cleanup tego scenariusza (owner).
    await db.delete(subscriptionPayments).where(eq(subscriptionPayments.subscriptionId, sub.id));
    await db.delete(salonSubscriptions).where(eq(salonSubscriptions.id, sub.id));
    await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, plan.id));
  });
});
