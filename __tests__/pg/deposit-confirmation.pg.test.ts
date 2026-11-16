/**
 * `confirmDepositPayment()` na PRAWDZIWYM Postgresie (#83 cz. 1; luka z werdyktu
 * Ethana na #80: ścieżkę „zadatek opłacony” testujemy tu, nie przez otwarcie
 * `/api/deposits/confirm` na production).
 *
 * - Przejście statusu: pending → succeeded (paidAt, payment_intent), wizyta
 *   scheduled → confirmed + depositPaid; stany końcowe (failed/refunded) nigdy
 *   nie wracają do succeeded; brak rekordu → not_found.
 * - Idempotencja: to samo zdarzenie dwa razy (po kolei) i 5× równolegle — jedno
 *   potwierdzenie, jeden SMS, paidAt bez zmian.
 * - Wyścig z cronem `cleanup-pending-deposits` (prawdziwa trasa): kolejność
 *   wymuszona blokadą wiersza trzymaną przez test i dowiedziona przez
 *   `pg_blocking_pids`, nie przez `sleep`. Oba porządki. Kontrakt (1) z #98:
 *   cron przed webhookiem `paid` → płatność failed → succeeded → refunded
 *   (zwrot TEJ płatności), wizyta zostaje `cancelled`, wynik `inactiveAppointment`.
 * - Bariera cron ‖ ręczne potwierdzenie przez salon: test trzyma `FOR UPDATE`
 *   na wizycie, cron czeka (`pg_blocking_pids`), test ustawia `confirmed` i
 *   zatwierdza — UPDATE crona z `status = 'scheduled'` nie nadpisuje wizyty.
 *
 * Cron jest międzysalonowy: przed jego wywołaniem test sprawdza, że w bazie nie
 * ma martwych rezerwacji SPOZA salonu testu (inaczej cron by je anulował) — jeśli
 * są, test pada zamiast cokolwiek zmieniać.
 *
 * Dane: użytkownik `it-t3-dep-…` (prefiks z notatki sprzątania w pg-harness.ts),
 * salon, pracownik, usługa; wizyty i płatności kaskadą z salonu w `afterAll`.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg`.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, ne } from "drizzle-orm";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { GET as cleanupCron } from "@/app/api/cron/cleanup-pending-deposits/route";
import { confirmDepositPayment } from "@/lib/deposit-confirmation";
import { appointments, depositPayments, employees, salons, services, user } from "@/lib/schema";
import type { Sql } from "postgres";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
const { smsMock } = vi.hoisted(() => ({ smsMock: vi.fn() }));
vi.mock("@/lib/sms", () => ({ sendPaymentConfirmationSms: (...a: unknown[]) => smsMock(...a) }));
// Zwrot (#70/#98) idzie przez prawdziwy refund.ts na tej bazie; Stripe podmieniony.
const { refundsCreate } = vi.hoisted(() => ({ refundsCreate: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ refunds: { create: (...a: unknown[]) => refundsCreate(...a) } }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const USER_ID = `it-t3-dep-${RUN}`;
const CRON_SECRET = `it-cron-${randomUUID()}`;
let salonId = "";
let employeeId = "";
let serviceId = "";
let slot = 0;

/** Wizyta z zadatkiem `pending`. `ageMinutes` > 45 = martwa dla crona. */
async function booking(opts: { ageMinutes?: number; paymentStatus?: string; paymentIntent?: string } = {}) {
  const db = h!.db;
  // Każda wizyta w osobnym, dalekim terminie — bez kolizji z czymkolwiek.
  const start = new Date(Date.UTC(2099, 0, 1, 8) + slot++ * 3_600_000);
  const [appt] = await db
    .insert(appointments)
    .values({
      salonId,
      employeeId,
      serviceId,
      startTime: start,
      endTime: new Date(start.getTime() + 1_800_000),
      status: "scheduled",
      depositPaid: false,
      guestName: "IT Gość",
      guestPhone: "+48500600700",
    })
    .returning();
  const createdAt = new Date(Date.now() - (opts.ageMinutes ?? 0) * 60_000);
  const [payment] = await db
    .insert(depositPayments)
    .values({
      appointmentId: appt!.id,
      salonId,
      amount: "50.00",
      paymentMethod: "stripe",
      status: opts.paymentStatus ?? "pending",
      stripePaymentIntentId: opts.paymentIntent ?? `cs_it_${randomUUID().slice(0, 8)}`,
      createdAt,
    })
    .returning();
  return { appointmentId: appt!.id, paymentId: payment!.id };
}

async function state(b: { appointmentId: string; paymentId: string }) {
  const db = h!.db;
  const [p] = await db.select().from(depositPayments).where(eq(depositPayments.id, b.paymentId));
  const [a] = await db.select().from(appointments).where(eq(appointments.id, b.appointmentId));
  return { payment: p!, appointment: a! };
}

/** Martwe rezerwacje (kryteria crona) SPOZA salonu testu. Musi być 0, zanim wywołamy cron. */
async function foreignStaleCount() {
  const cutoff = new Date(Date.now() - 45 * 60_000);
  const rows = await h!.db
    .select({ id: depositPayments.id })
    .from(depositPayments)
    .innerJoin(appointments, eq(depositPayments.appointmentId, appointments.id))
    .where(
      and(
        inArray(depositPayments.status, ["pending", "failed"]),
        lt(depositPayments.createdAt, cutoff),
        eq(appointments.status, "scheduled"),
        eq(appointments.depositPaid, false),
        ne(depositPayments.salonId, salonId)
      )
    );
  return rows.length;
}

async function runCron() {
  expect(await foreignStaleCount(), "pos_dev ma martwe rezerwacje spoza testu — cron by je anulował").toBe(0);
  return cleanupCron(
    new Request("http://localhost/api/cron/cleanup-pending-deposits", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })
  );
}

/**
 * Transakcja testu trzymająca `FOR UPDATE` na wierszu `table` (pula observer).
 * `release(beforeCommit?)` — opcjonalny zapis w TEJ transakcji przed COMMIT
 * (np. ręczne potwierdzenie wizyty przez salon).
 * `waiters(n)` czeka, aż n połączeń stoi w łańcuchu blokad zaczynającym się od
 * tej transakcji. Drugi czekający na ten sam wiersz jest blokowany przez
 * PIERWSZEGO czekającego (blokada krotki), nie bezpośrednio przez nas — stąd
 * rekurencja po `pg_blocking_pids`.
 */
type BeforeCommit = (sql: Sql) => Promise<unknown>;
async function holdRow(table: "deposit_payments" | "appointments", id: string) {
  let release!: (beforeCommit?: BeforeCommit) => void;
  const releaseP = new Promise<BeforeCommit | undefined>((r) => (release = r));
  let pid!: number;
  let held!: () => void;
  const heldP = new Promise<void>((r) => (held = r));
  const done = h!.observer.begin(async (txSql) => {
    // TransactionSql w typach postgres.js gubi sygnaturę wywołania (Omit) — w runtime jest wywoływalna.
    const sql = txSql as unknown as Sql;
    const [me] = await sql<{ pid: number }[]>`select pg_backend_pid() as pid`;
    pid = me!.pid;
    await sql`select id from ${sql(table)} where id = ${id} for update`;
    held();
    const beforeCommit = await releaseP;
    if (beforeCommit) await beforeCommit(sql);
  });
  await heldP;
  async function waiters(n: number, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const [r] = await h!.observer<{ n: number }[]>`
        with recursive chain(pid) as (
          select a.pid from pg_stat_activity a where ${pid} = any(pg_blocking_pids(a.pid))
          union
          select a.pid from pg_stat_activity a join chain c on c.pid = any(pg_blocking_pids(a.pid))
        )
        select count(*)::int as n from chain`;
      if ((r?.n ?? 0) >= n) return true;
      await new Promise((res) => setTimeout(res, 10));
    }
    return false;
  }
  return { release, done, waiters };
}
const holdPaymentRow = (paymentId: string) => holdRow("deposit_payments", paymentId);

const suite = h ? describe : describe.skip;

suite("confirmDepositPayment — prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values({ id: USER_ID, name: "IT T3 dep", email: `${USER_ID}@example.invalid` });
    const [salon] = await db.insert(salons).values({ name: `IT T3 dep ${RUN}`, ownerId: USER_ID }).returning();
    salonId = salon!.id;
    const [emp] = await db
      .insert(employees)
      .values({ salonId, firstName: "IT", lastName: "Pracownik" })
      .returning();
    employeeId = emp!.id;
    const [svc] = await db
      .insert(services)
      .values({ salonId, name: "IT Usługa", basePrice: "100.00", baseDuration: 30, depositRequired: true })
      .returning();
    serviceId = svc!.id;
  });

  afterAll(async () => {
    if (!h) return;
    // Kaskada z salonu: pracownik, usługa, wizyty, płatności.
    try {
      if (salonId) await h.db.delete(salons).where(eq(salons.id, salonId));
      await h.db.delete(user).where(eq(user.id, USER_ID));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    smsMock.mockReset();
    smsMock.mockResolvedValue({ success: true });
    refundsCreate.mockReset();
    refundsCreate.mockResolvedValue({ id: "re_it_1" });
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ------------------------------------------------------------ przejście statusu

  it("pending → succeeded: paidAt i payment_intent zapisane, wizyta confirmed + depositPaid, jeden SMS", async () => {
    const b = await booking();
    const before = Date.now();
    const res = await confirmDepositPayment(b.paymentId, { paymentIntentId: "pi_it_123" });
    expect(res).toMatchObject({ success: true, alreadyConfirmed: false, smsSent: true });

    const { payment, appointment } = await state(b);
    expect(payment.status).toBe("succeeded");
    expect(payment.stripePaymentIntentId).toBe("pi_it_123");
    expect(payment.paidAt!.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect(appointment.status).toBe("confirmed");
    expect(appointment.depositPaid).toBe(true);
    expect(smsMock).toHaveBeenCalledTimes(1);
    expect(smsMock.mock.calls[0]![0]).toMatchObject({ clientPhone: "+48500600700", amount: 50, salonId, salonName: `IT T3 dep ${RUN}` });
  });

  it("bez paymentIntentId istniejący identyfikator zostaje", async () => {
    const b = await booking({ paymentIntent: "cs_it_keep" });
    await confirmDepositPayment(b.paymentId);
    expect((await state(b)).payment.stripePaymentIntentId).toBe("cs_it_keep");
  });

  it("błąd SMS nie cofa potwierdzenia", async () => {
    smsMock.mockRejectedValue(new Error("sms down"));
    const b = await booking();
    const res = await confirmDepositPayment(b.paymentId);
    expect(res).toMatchObject({ success: true, alreadyConfirmed: false, smsSent: false });
    expect((await state(b)).appointment.status).toBe("confirmed");
  });

  it.each(["failed", "refunded"])("stan końcowy %s nigdy nie wraca do succeeded (not_pending), wizyta bez zmian", async (status) => {
    const b = await booking({ paymentStatus: status });
    const res = await confirmDepositPayment(b.paymentId, { paymentIntentId: "pi_it_late" });
    expect(res).toMatchObject({ success: false, error: "not_pending" });
    const { payment, appointment } = await state(b);
    expect(payment.status).toBe(status);
    expect(payment.paidAt).toBeNull();
    expect(payment.stripePaymentIntentId).not.toBe("pi_it_late");
    expect(appointment.status).toBe("scheduled");
    expect(appointment.depositPaid).toBe(false);
    expect(smsMock).not.toHaveBeenCalled();
  });

  it("nieistniejąca płatność → not_found, nic nie zapisane", async () => {
    const res = await confirmDepositPayment(randomUUID());
    expect(res).toMatchObject({ success: false, error: "not_found" });
    expect(smsMock).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------ idempotencja

  it("to samo zdarzenie dwa razy po kolei: drugie = alreadyConfirmed, paidAt bez zmian, jeden SMS", async () => {
    const b = await booking();
    await confirmDepositPayment(b.paymentId, { paymentIntentId: "pi_it_dup" });
    const first = (await state(b)).payment.paidAt!.getTime();

    const again = await confirmDepositPayment(b.paymentId, { paymentIntentId: "pi_it_dup" });
    expect(again).toMatchObject({ success: true, alreadyConfirmed: true, smsSent: false });
    const { payment } = await state(b);
    expect(payment.paidAt!.getTime()).toBe(first);
    expect(smsMock).toHaveBeenCalledTimes(1);
  });

  it("to samo zdarzenie 5× równolegle: dokładnie jedno potwierdzenie i jeden SMS", async () => {
    const b = await booking();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => confirmDepositPayment(b.paymentId, { paymentIntentId: "pi_it_par" }))
    );
    expect(results.every((r) => r.success)).toBe(true);
    expect(results.filter((r) => !r.alreadyConfirmed)).toHaveLength(1);
    expect(smsMock).toHaveBeenCalledTimes(1);
    const { payment, appointment } = await state(b);
    expect(payment.status).toBe("succeeded");
    expect(appointment).toMatchObject({ status: "confirmed", depositPaid: true });
  });

  // ------------------------------------------------------------ wyścig z cronem

  it("cron bez wyścigu: martwa rezerwacja anulowana, świeża i potwierdzona nietknięte", async () => {
    const stale = await booking({ ageMinutes: 120 });
    const fresh = await booking({ ageMinutes: 5 });
    const paid = await booking({ ageMinutes: 120 });
    await confirmDepositPayment(paid.paymentId);

    const res = await runCron();
    expect(res.status).toBe(200);

    expect(await state(stale)).toMatchObject({
      payment: { status: "failed" },
      appointment: { status: "cancelled", depositPaid: false },
    });
    expect(await state(fresh)).toMatchObject({ payment: { status: "pending" }, appointment: { status: "scheduled" } });
    expect(await state(paid)).toMatchObject({
      payment: { status: "succeeded" },
      appointment: { status: "confirmed", depositPaid: true },
    });
  });

  it("wyścig: webhook przed cronem w kolejce blokady → opłacona i potwierdzona; cron niczego nie cofa", async () => {
    const b = await booking({ ageMinutes: 120 });
    const lock = await holdPaymentRow(b.paymentId);

    let confirmP: ReturnType<typeof confirmDepositPayment>;
    let cronP: ReturnType<typeof runCron>;
    try {
      confirmP = confirmDepositPayment(b.paymentId, { paymentIntentId: "pi_it_race1" });
      expect(await lock.waiters(1), "webhook nie czeka na blokadę wiersza").toBe(true);
      cronP = runCron();
      expect(await lock.waiters(2), "cron nie czeka na blokadę wiersza").toBe(true);
    } finally {
      // Zawsze zwalniamy blokadę — inaczej nieudana asercja zawiesza sprzątanie.
      lock.release();
      await lock.done;
    }

    const [confirmed, cron] = await Promise.all([confirmP, cronP]);
    expect(confirmed).toMatchObject({ success: true, alreadyConfirmed: false });
    expect(cron.status).toBe(200);
    expect(await state(b)).toMatchObject({
      payment: { status: "succeeded", stripePaymentIntentId: "pi_it_race1" },
      appointment: { status: "confirmed", depositPaid: true },
    });
    expect(smsMock).toHaveBeenCalledTimes(1);
  });

  /** Cron wchodzi pierwszy w kolejkę blokady płatności, potem webhook z `options`. */
  async function cronThenWebhook(options: Parameters<typeof confirmDepositPayment>[1]) {
    const b = await booking({ ageMinutes: 120 });
    const lock = await holdPaymentRow(b.paymentId);

    let cronP: ReturnType<typeof runCron>;
    let confirmP: ReturnType<typeof confirmDepositPayment>;
    try {
      cronP = runCron();
      expect(await lock.waiters(1), "cron nie czeka na blokadę wiersza").toBe(true);
      confirmP = confirmDepositPayment(b.paymentId, options);
      expect(await lock.waiters(2), "webhook nie czeka na blokadę wiersza").toBe(true);
    } finally {
      lock.release();
      await lock.done;
    }

    const [cron, confirmed] = await Promise.all([cronP, confirmP]);
    expect(cron.status).toBe(200);
    // Cron zdążył przed webhookiem: to on przestawił płatność na failed.
    expect(await cron.json()).toMatchObject({ failedPayments: 1 });
    return { b, confirmed };
  }

  it("kontrakt (1): cron przed webhookiem `paid` → failed → succeeded → refunded, wizyta cancelled, inactiveAppointment", async () => {
    const { b, confirmed } = await cronThenWebhook({ paymentIntentId: "pi_it_race2", stripePaymentStatus: "paid" });

    expect(confirmed).toMatchObject({
      success: true,
      alreadyConfirmed: false,
      smsSent: false,
      inactiveAppointment: {
        appointmentStatus: "cancelled",
        reason: "appointment_inactive",
        refunded: true,
        refundId: "re_it_1",
      },
    });
    const { payment, appointment } = await state(b);
    // succeeded po drodze: paidAt i pi_ z webhooka; potem zwrot tej płatności.
    expect(payment).toMatchObject({
      status: "refunded",
      stripePaymentIntentId: "pi_it_race2",
      stripeRefundId: "re_it_1",
    });
    expect(payment.paidAt).not.toBeNull();
    expect(payment.refundedAt).not.toBeNull();
    expect(appointment).toMatchObject({ status: "cancelled", depositPaid: false });
    expect(smsMock).not.toHaveBeenCalled();
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(refundsCreate.mock.calls[0]![0]).toMatchObject({ payment_intent: "pi_it_race2", amount: 5000 });
    expect(refundsCreate.mock.calls[0]![1]).toMatchObject({ idempotencyKey: `deposit-refund:${b.paymentId}` });
  });

  it("cron przed zdarzeniem bez potwierdzonej wpłaty Stripe → not_pending, płatność failed, wizyta cancelled, bez zwrotu", async () => {
    const { b, confirmed } = await cronThenWebhook({ paymentIntentId: "pi_it_race3" });

    expect(confirmed).toMatchObject({ success: false, alreadyConfirmed: false, smsSent: false, error: "not_pending" });
    const { payment, appointment } = await state(b);
    expect(payment.status).toBe("failed");
    expect(payment.paidAt).toBeNull();
    expect(payment.stripePaymentIntentId).not.toBe("pi_it_race3");
    expect(appointment).toMatchObject({ status: "cancelled", depositPaid: false });
    expect(smsMock).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------ cron ‖ ręczne potwierdzenie

  it("bariera: salon potwierdza wizytę ręcznie, cron czeka na wiersz wizyty → wizyta zostaje confirmed", async () => {
    const b = await booking({ ageMinutes: 120 });
    const lock = await holdRow("appointments", b.appointmentId);

    let cronP: ReturnType<typeof runCron>;
    try {
      cronP = runCron();
      // Cron przestawił już płatność (wiersz nietrzymany) i stoi na UPDATE wizyty.
      expect(await lock.waiters(1), "cron nie czeka na blokadę wizyty").toBe(true);
    } finally {
      lock.release(async (sql) => {
        await sql`update appointments set status = 'confirmed', updated_at = now() where id = ${b.appointmentId}`;
      });
      await lock.done;
    }

    const cron = await cronP;
    expect(cron.status).toBe(200);
    const { payment, appointment } = await state(b);
    // Ponowna ocena WHERE po zwolnieniu blokady: `status = 'scheduled'` już nie
    // pasuje, więc cron nie anuluje wizyty potwierdzonej przez salon.
    expect(appointment).toMatchObject({ status: "confirmed", depositPaid: false });
    expect(payment.status).toBe("failed");
  });
});
