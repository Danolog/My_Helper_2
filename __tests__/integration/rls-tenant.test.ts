/**
 * Testy RLS (Row-Level Security) na REALNEJ, LOKALNEJ bazie pod WŁĄCZONYM RLS.
 *
 * NAPRAWA po review Ryana (docs/adr/ADR-001-ryan-review-rls.md, W1):
 * Poprzednia wersja POZOROWAŁA — wchodziła w rolę app RĘCZNIE w teście
 * (`set local role` pisany w teście), a nie przez kod produkcyjny. Dowodziła
 * polityki SQL, ale NIE ścieżki, którą faktycznie chodzi aplikacja. Owner-bypass
 * (webhook) „przechodził" trywialnie, bo owner zapisuje zawsze — test nie różnicował.
 *
 * Ta wersja dowodzi RLS przez PRODUKCYJNY wrapper `forSalon` (= `withSalonContext`,
 * który od naprawy W1 wykonuje `SET LOCAL ROLE myhelper_app` + kontekst salonu).
 * Klucz: testy izolacji NIE używają filtra aplikacyjnego `eq(salonId)` — pytają
 * bazę „na surowo" przez `forSalon(...).raw(tx => ...)`. Jeśli RLS jest martwy
 * (transakcja jechałaby ownerem, jak przed W1) — zwróciłyby cudze wiersze i test
 * BY PADŁ. Przechodzą TYLKO dlatego, że baza realnie odcina cudze wiersze rolą app.
 *
 * Dowody:
 *  1. Przez produkcyjny wrapper, BEZ filtra aplikacyjnego, kontekst A widzi tylko A.
 *  2. Przez produkcyjny wrapper, BEZ filtra, sięgnięcie po id salonu B -> 0 wierszy.
 *  3. Kontrola różnicująca: ta sama „surowa" lista pod rolą OWNER (ścieżka systemowa)
 *     widzi OBA salony — czyli izolacja z (1)/(2) pochodzi od RLS+roli app, nie od
 *     przypadku. Webhook (owner) zapisuje poprawnie; gdyby jechał rolą app bez
 *     kontekstu — zapis trafiłby na 0 wierszy / WITH CHECK by go odrzucił.
 *
 * Seed/cleanup pod rolą owner (surowy db) — omija RLS (powód, dla którego ENABLE,
 * nie FORCE). Guard host=localhost w setup-real-db.ts chroni przed prod.
 */
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
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
import { forSalon } from "@/lib/server/repository";

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

describe("RLS realnie odcina na ŚCIEŻCE ŻĄDANIA (produkcyjny wrapper forSalon, rola app)", () => {
  it("DOWÓD W1: przez wrapper, BEZ filtra aplikacyjnego, kontekst A widzi TYLKO klientów A", async () => {
    // `raw` daje transakcję z PRODUKCYJNYM SET LOCAL ROLE myhelper_app + kontekstem.
    // Pytanie SUROWE: select().from(clients) — ZERO `eq(salonId)`. Gdyby transakcja
    // jechała ownerem (stan sprzed W1), zwróciłaby klientów A I B (RLS martwy).
    // Przechodzi TYLKO dlatego, że baza (RLS rolą app) sama odcina wiersze B.
    const rows = await forSalon(A.salonId).raw((tx) => tx.select().from(clients));
    const ids = rows.map((c) => c.id);
    expect(ids).toContain(A.clientId);
    expect(ids).not.toContain(B.clientId);
  });

  it("DOWÓD W1: przez wrapper, BEZ filtra, sięgnięcie po klienta B z kontekstem A -> 0 wierszy", async () => {
    // Surowy select po id klienta B, ale tylko po id (bez salon_id). RLS odcina,
    // bo salon_id wiersza B != app.current_salon_id (A). Zero wierszy = baza chroni.
    const rows = await forSalon(A.salonId).raw((tx) =>
      tx.select().from(clients).where(eq(clients.id, B.clientId))
    );
    expect(rows.length).toBe(0);
  });

  it("KONTROLA RÓŻNICUJĄCA: ta sama surowa lista pod rolą OWNER widzi OBA salony", async () => {
    // Bez SET LOCAL ROLE — połączenie ownera (ścieżka systemowa). ENABLE-not-FORCE
    // => RLS nie obowiązuje. Owner widzi A i B. To dowodzi, że izolacja z poprzednich
    // dwóch testów NIE jest przypadkiem ani artefaktem danych — pochodzi od roli app.
    const all = await db.select().from(clients);
    const ids = all.map((c) => c.id);
    expect(ids).toContain(A.clientId);
    expect(ids).toContain(B.clientId);
  });

  it("ZDROWY ROZSĄDEK: rola myhelper_app istnieje i NIE ma BYPASSRLS", async () => {
    const r = await db.execute(
      sql`SELECT rolbypassrls FROM pg_roles WHERE rolname = ${APP_ROLE}`
    );
    const row = (r as unknown as Array<{ rolbypassrls: boolean }>)[0];
    expect(row).toBeDefined();
    expect(row?.rolbypassrls).toBe(false);
  });
});

describe("RLS — ścieżka systemowa (webhook Stripe) działa pod ownerem, ale RÓŻNICUJE od roli app", () => {
  it("invoice.paid pod rolą owner zapisuje płatność; ta sama operacja rolą app BEZ kontekstu pada", async () => {
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

    // (a) Ścieżka systemowa: zapis renowacji pod rolą OWNER (jak handleInvoicePaid —
    //     bez SET LOCAL ROLE; RLS omijane przez ENABLE-not-FORCE). Działa.
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
    const payments = await db
      .select()
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.subscriptionId, sub.id));
    expect(payments.length).toBe(1);
    expect(payments[0]?.status).toBe("succeeded");

    // (b) DOWÓD RÓŻNICUJĄCY: gdyby webhook (błędnie) jechał rolą app BEZ kontekstu
    //     salonu, ten sam INSERT zostałby odrzucony przez WITH CHECK polityki
    //     (salon_id != current_setting(NULL)). Owner-bypass to NIE „insert przechodzi
    //     zawsze" — to świadome ominięcie RLS, które rola app bez kontekstu NIE ma.
    //     Test poprzedni (sprzed W1) tego nie różnicował: rzucał, że webhook OK,
    //     ale identycznie przeszedłby nawet bez RLS. Tu pokazujemy kontrast.
    let appInsertRejected = false;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`set local role ${APP_ROLE}`));
        // BEZ set_config('app.current_salon_id', ...) — kontekst pusty.
        await tx.insert(subscriptionPayments).values({
          subscriptionId: sub.id,
          salonId: sub.salonId,
          amount: plan.priceMonthly,
          currency: "PLN",
          stripePaymentIntentId: `pi_rls_app_${randomUUID().slice(0, 12)}`,
          status: "succeeded",
          paidAt: new Date(),
        });
      });
    } catch {
      appInsertRejected = true;
    }
    expect(appInsertRejected).toBe(true);
    // Liczba płatności niezmieniona — wstawka rolą app bez kontekstu nie weszła.
    const after = await db
      .select()
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.subscriptionId, sub.id));
    expect(after.length).toBe(1);

    // Cleanup tego scenariusza (owner).
    await db.delete(subscriptionPayments).where(eq(subscriptionPayments.subscriptionId, sub.id));
    await db.delete(salonSubscriptions).where(eq(salonSubscriptions.id, sub.id));
    await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, plan.id));
  });
});
