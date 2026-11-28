/**
 * Zakończenie wizyty kontra anulowanie przez salon na PRAWDZIWYM Postgresie,
 * w obu kolejnościach, pod rolą aplikacji:
 * - zakończenie pierwsze, anulowanie czeka na blokadę wiersza → zakończenie
 *   200, anulowanie 409 `APPOINTMENT_COMPLETED`; wizyta zakończona, płatność
 *   zadatku `pending` zostaje `pending` (krok `pending → failed` anulowania
 *   wycofany razem z transakcją), bez listy oczekujących i zwrotu;
 * - anulowanie pierwsze, zakończenie czeka na blokadę wiersza → anulowanie 200,
 *   zakończenie 400 `APPOINTMENT_CANCELLED`; wizyta anulowana, płatność
 *   `failed`, bez zabiegu i prowizji.
 *
 * Kolejność wymusza obserwator: trzyma blokadę wiersza wizyty w swojej
 * transakcji, uruchamia pierwsze żądanie, czeka, aż stanie za jego blokadą,
 * uruchamia drugie, czeka, aż w łańcuchu `pg_blocking_pids` stoją dwie
 * transakcje (druga czeka na blokadę krotki pierwszej), i dopiero wtedy
 * zatwierdza. Bez uśpień na czas. Żądanie zakończone przed barierą przerywa
 * test od razu z jego wynikiem (status i `code`, bez body).
 *
 * Odczyt z blokadą po czekaniu (READ COMMITTED) odświeża tylko zablokowany
 * wiersz wizyty; wiersze złączeń zostają ze starego odczytu. Test sprawdza
 * więc tylko status wizyty i płatności oraz zapisy zależne od statusu.
 *
 * Trasy wołane bezpośrednio; atrapa sesji (`auth.api.getSession`), nagłówków,
 * loggera, zwrotu zadatku i listy oczekujących. `@/lib/db` wskazuje bazę
 * testową, kontekst salonu i `forSalon` prawdziwe.
 *
 * Dane: konto `it-t3-ccr-…` (właściciel), salon, pracownik, usługa, wizyty
 * w 2097 z zadatkiem 50.00 i płatnością `pending`. Salon usuwany w `afterAll` (kaskada).
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as completeRoute from "@/app/api/appointments/[id]/complete/route";
import * as appointmentRoute from "@/app/api/appointments/[id]/route";
import { APPOINTMENT_ERROR_CODES } from "@/lib/appointment-codes";
import { APPOINTMENT_COMPLETED_CODE } from "@/lib/appointment-completion";
import {
  appointments,
  depositPayments,
  employeeCommissions,
  employees,
  salons,
  services,
  treatmentHistory,
  user,
} from "@/lib/schema";
import { createMockRequest, createRouteParams, parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ userId: "" }));
const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  refund: vi.fn(),
  notifyWaitingList: vi.fn(),
}));

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
        ctl.userId
          ? {
              user: { id: ctl.userId, email: `${ctl.userId}@example.invalid`, name: "IT" },
              session: { id: `s-${ctl.userId}`, userId: ctl.userId },
            }
          : null,
    },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.error, info: mocks.info, warn: mocks.warn, debug: vi.fn() },
}));
vi.mock("@/lib/refund", () => ({
  refundAppointmentDeposits: (...args: unknown[]) => mocks.refund(...args),
}));
vi.mock("@/lib/waiting-list", () => ({
  notifyWaitingList: (...args: unknown[]) => mocks.notifyWaitingList(...args),
}));

const suite = h ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const OWNER = `it-t3-ccr-o-${RUN}`;

const ids = { salon: "", emp: "", service: "" };
let slot = 0;

type Body = { success: boolean; code?: string; error?: string; data?: Record<string, unknown> };
type Outcome = { status: number; body: Body };

/** Wizyta salonu (rola migracji) z zadatkiem i płatnością `pending`; każda w osobnym terminie. */
async function appointmentWithPendingDeposit(): Promise<{ appt: string; payment: string }> {
  const start = new Date(Date.UTC(2097, 2, 1, 8) + slot++ * 3_600_000);
  const [a] = await h!.db
    .insert(appointments)
    .values({
      salonId: ids.salon,
      employeeId: ids.emp,
      serviceId: ids.service,
      startTime: start,
      endTime: new Date(start.getTime() + 1_800_000),
      status: "scheduled",
      depositAmount: "50.00",
      depositPaid: false,
    })
    .returning({ id: appointments.id });
  const [p] = await h!.db
    .insert(depositPayments)
    .values({ appointmentId: a!.id, salonId: ids.salon, amount: "50.00", paymentMethod: "blik", status: "pending" })
    .returning({ id: depositPayments.id });
  return { appt: a!.id, payment: p!.id };
}

const complete = (id: string) =>
  completeRoute.POST(
    createMockRequest(`http://localhost/api/appointments/${id}/complete`, { method: "POST", body: {} }),
    createRouteParams(id)
  );

const cancel = (id: string) =>
  appointmentRoute.DELETE(
    createMockRequest(`http://localhost/api/appointments/${id}`, { method: "DELETE" }),
    createRouteParams(id)
  );

/** Wynik do komunikatu bariery: sam status i `code`, bez body. */
function outcomeSummary(value: unknown): string {
  const res = value as { status?: unknown; body?: { code?: unknown } } | null;
  return JSON.stringify({ status: res?.status ?? null, code: res?.body?.code ?? null });
}

/** Najdłużej tyle czeka sprzątanie na żądanie, które bariera zostawiła w locie. */
const PENDING_SETTLE_MS = 5_000;

/** Czeka na obietnicę najwyżej `ms`; jej błąd nie wychodzi poza sprzątanie. */
async function settleWithin(pending: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    pending.then(
      () => undefined,
      () => undefined
    ),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  if (timer) clearTimeout(timer);
}

/**
 * Liczba transakcji stojących za `holderPid`: wprost albo w kolejce za inną
 * czekającą (łańcuch `pg_blocking_pids`). Druga czekająca stoi za blokadą
 * krotki PIERWSZEJ, nie bezpośrednio za obserwatorem.
 */
async function waitersBehind(holderPid: number): Promise<number> {
  const [row] = await h!.observer<{ n: number }[]>`
    with recursive chain(pid) as (
      select a.pid from pg_stat_activity a where ${holderPid} = any(pg_blocking_pids(a.pid))
      union
      select a.pid from pg_stat_activity a join chain c on c.pid = any(pg_blocking_pids(a.pid))
    )
    select count(*)::int as n from chain
  `;
  return row?.n ?? 0;
}

/** Stan połączeń przy nieudanej barierze: bez treści zapytań i danych. */
async function lockDiagnostics(): Promise<string> {
  const rows = await h!.observer<{ state: string | null; wait: string | null; blockers: string }[]>`
    select state, wait_event_type || ':' || wait_event as wait, pg_blocking_pids(pid)::text as blockers
    from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'
  `;
  return JSON.stringify(rows);
}

/** Czeka, aż `count` transakcji stoi za `holderPid`; żądanie zakończone wcześniej przerywa od razu. */
async function waitForWaitersBehind(
  holderPid: number,
  count: number,
  settled: () => string | null,
  timeoutMs = 10_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await waitersBehind(holderPid)) >= count) return;
    const early = settled();
    if (early) throw new Error(`bariera: żądanie zakończone bez czekania na blokadę wiersza: ${early}`);
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(
    `bariera: mniej niż ${count} transakcji czeka na blokadę po ${timeoutMs} ms; połączenia: ${await lockDiagnostics()}`
  );
}

/**
 * Obserwator blokuje wiersz wizyty, uruchamia żądania po kolei — każde
 * następne dopiero, gdy poprzednie stoi w kolejce do blokady — i zatwierdza.
 * Zwraca wyniki w kolejności uruchomienia.
 */
async function inLockOrder(appt: string, starts: Array<() => Promise<Outcome>>): Promise<Outcome[]> {
  const pending: Promise<Outcome>[] = [];
  let barrierPassed = false;
  try {
    await h!.observer.begin(async (tx) => {
      await tx.unsafe("set local lock_timeout = '15s'");
      const [me] = (await tx.unsafe("select pg_backend_pid() as pid")) as unknown as { pid: number }[];
      const locked = (await tx.unsafe("select id from appointments where id = $1 for update", [appt])) as unknown as unknown[];
      if (locked.length !== 1) throw new Error("obserwator nie zablokował wiersza wizyty");
      const finished: string[] = [];
      for (const start of starts) {
        const p = start();
        pending.push(p);
        // Błąd żądania przed barierą nie może zostać nieobsłużoną obietnicą.
        p.then(
          (v) => finished.push(outcomeSummary(v)),
          (e: unknown) => finished.push(e instanceof Error ? e.name : "rejected")
        );
        await waitForWaitersBehind(me!.pid, pending.length, () => (finished.length > 0 ? finished.join(",") : null));
      }
    });
    barrierPassed = true;
  } finally {
    // Bariera padła: żądania w locie nie mogą skończyć się po `afterAll`.
    if (!barrierPassed) await Promise.all(pending.map((p) => settleWithin(p, PENDING_SETTLE_MS)));
  }
  return Promise.all(pending);
}

async function statusOf(appt: string) {
  const [a] = await h!.db.select({ status: appointments.status }).from(appointments).where(eq(appointments.id, appt));
  return a!.status;
}

async function paymentStatusOf(payment: string) {
  const [p] = await h!.db
    .select({ status: depositPayments.status })
    .from(depositPayments)
    .where(eq(depositPayments.id, payment));
  return p!.status;
}

async function treatmentsOf(appt: string) {
  return h!.db.select({ id: treatmentHistory.id }).from(treatmentHistory).where(eq(treatmentHistory.appointmentId, appt));
}

async function commissionsOf(appt: string) {
  return h!.db
    .select({ id: employeeCommissions.id })
    .from(employeeCommissions)
    .where(eq(employeeCommissions.appointmentId, appt));
}

suite("zakończenie kontra anulowanie wizyty — obie kolejności, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([{ id: OWNER, name: "IT ccr", email: `${OWNER}@example.invalid` }]);
    const [s] = await db.insert(salons).values({ name: `IT ccr ${RUN}`, ownerId: OWNER }).returning({ id: salons.id });
    ids.salon = s!.id;
    const [e] = await db
      .insert(employees)
      .values({ salonId: ids.salon, firstName: "IT", lastName: "Pracownik ccr", commissionRate: "40" })
      .returning({ id: employees.id });
    ids.emp = e!.id;
    const [sv] = await db
      .insert(services)
      .values({ salonId: ids.salon, name: "IT ccr usługa", basePrice: "150.00", baseDuration: 30 })
      .returning({ id: services.id });
    ids.service = sv!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      if (ids.salon) await h.db.delete(salons).where(inArray(salons.id, [ids.salon]));
      await h.db.delete(user).where(inArray(user.id, [OWNER]));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    ctl.userId = OWNER;
    mocks.error.mockClear();
    mocks.warn.mockClear();
    mocks.info.mockClear();
    mocks.refund.mockReset();
    mocks.notifyWaitingList.mockReset();
    mocks.notifyWaitingList.mockResolvedValue({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
  });

  it(
    "zakończenie pierwsze, anulowanie czeka → 200 i 409 APPOINTMENT_COMPLETED; płatność zostaje pending",
    async () => {
      const { appt, payment } = await appointmentWithPendingDeposit();

      const [done, cancelled] = await inLockOrder(appt, [
        async () => parseResponse<Body>(await complete(appt)),
        async () => parseResponse<Body>(await cancel(appt)),
      ]);

      expect(done!.status, outcomeSummary(done)).toBe(200);
      expect(cancelled!.status, outcomeSummary(cancelled)).toBe(409);
      expect(cancelled!.body.code).toBe(APPOINTMENT_COMPLETED_CODE);
      expect(await statusOf(appt)).toBe("completed");
      // Krok `pending → failed` anulowania wycofany razem z jego transakcją.
      expect(await paymentStatusOf(payment)).toBe("pending");
      expect(await treatmentsOf(appt)).toHaveLength(1);
      expect(await commissionsOf(appt)).toHaveLength(1);
      expect(mocks.refund).not.toHaveBeenCalled();
      expect(mocks.notifyWaitingList).not.toHaveBeenCalled();
      expect(mocks.error).not.toHaveBeenCalled();
    },
    30_000
  );

  it(
    "anulowanie pierwsze, zakończenie czeka → 200 i 400 APPOINTMENT_CANCELLED; płatność failed, bez zabiegu i prowizji",
    async () => {
      const { appt, payment } = await appointmentWithPendingDeposit();

      const [cancelled, done] = await inLockOrder(appt, [
        async () => parseResponse<Body>(await cancel(appt)),
        async () => parseResponse<Body>(await complete(appt)),
      ]);

      expect(cancelled!.status, outcomeSummary(cancelled)).toBe(200);
      expect((cancelled!.body.data as { status?: string } | undefined)?.status).toBe("cancelled");
      expect(done!.status, outcomeSummary(done)).toBe(400);
      expect(done!.body.code).toBe(APPOINTMENT_ERROR_CODES.appointmentCancelled);
      expect(await statusOf(appt)).toBe("cancelled");
      expect(await paymentStatusOf(payment)).toBe("failed");
      expect(await treatmentsOf(appt)).toHaveLength(0);
      expect(await commissionsOf(appt)).toHaveLength(0);
      expect(mocks.refund).not.toHaveBeenCalled();
      expect(mocks.error).not.toHaveBeenCalled();
    },
    30_000
  );
});
