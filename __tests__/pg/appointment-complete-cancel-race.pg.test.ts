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
 * Na tej samej barierze warunek pracownika pod blokadą (obserwator przepisuje
 * wizytę na innego pracownika, zanim zatwierdzi):
 * - pracownik odwołuje wizytę przepisaną → 404, wizyta nieanulowana,
 *   płatność `pending`, bez wpisu w `notifications`, bez listy oczekujących
 *   i zwrotu; przepisana i zakończona → 404, nie 409;
 * - pracownik zapisuje notatkę własnej wizyty → 200; wizyty przepisanej → 404,
 *   notatka bez zmian;
 * - pracownik przesuwa termin wizyty przepisanej → 404, termin i pracownik
 *   bez zmian, bez logu błędu;
 * - PUT właściciela z body dialogu edycji czeka za zakończeniem: nowa notatka
 *   → 200, zapisana tylko notatka; zmieniony termin → 409, wiersz bez zmian.
 *
 * Zakres edycji pracownika: pracownik zmienia pracownika, klienta albo usługę
 * własnej wizyty (wyczyszczenie albo inny klient salonu) → 403 z kodem,
 * wiersz bez zmian; ta sama wartość z dialogu → 200.
 *
 * Kontrola pozytywna `notifications`: właściciel odwołuje wizytę klienta
 * z SMS-em → jeden nowy wiersz (zapytanie użyte w przypadkach „bez wpisu” widzi
 * wiersze).
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
 * Dane: konta `it-t3-ccr-…` (właściciel i pracownik), salon, trzech
 * pracowników (jeden z kontem), dwóch klientów bez telefonu, usługa, wizyty w 2097
 * z zadatkiem 50.00 i płatnością `pending`. Salon usuwany w `afterAll` (kaskada);
 * konta usuwane także wtedy, gdy usunięcie salonu się nie uda.
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
  clients,
  depositPayments,
  employeeCommissions,
  employees,
  notifications,
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
const EMP_USER = `it-t3-ccr-e-${RUN}`;

const ids = { salon: "", emp: "", service: "", empOwn: "", empOther: "", client: "", clientOther: "" };
let slot = 0;

type Body = { success: boolean; code?: string; error?: string; data?: Record<string, unknown> };
type Outcome = { status: number; body: Body };
type ObserverTx = { unsafe: (query: string, params?: unknown[]) => Promise<unknown> };

/** Wizyta salonu (rola migracji) z zadatkiem i płatnością `pending`; każda w osobnym terminie. */
async function appointmentWithPendingDeposit(
  overrides: { employeeId?: string; clientId?: string } = {}
): Promise<{ appt: string; payment: string; start: Date; end: Date }> {
  const start = new Date(Date.UTC(2097, 2, 1, 8) + slot++ * 3_600_000);
  const end = new Date(start.getTime() + 1_800_000);
  const [a] = await h!.db
    .insert(appointments)
    .values({
      salonId: ids.salon,
      employeeId: overrides.employeeId ?? ids.emp,
      serviceId: ids.service,
      clientId: overrides.clientId ?? null,
      startTime: start,
      endTime: end,
      status: "scheduled",
      depositAmount: "50.00",
      depositPaid: false,
    })
    .returning({ id: appointments.id });
  const [p] = await h!.db
    .insert(depositPayments)
    .values({ appointmentId: a!.id, salonId: ids.salon, amount: "50.00", paymentMethod: "blik", status: "pending" })
    .returning({ id: depositPayments.id });
  return { appt: a!.id, payment: p!.id, start, end };
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

/** Odwołanie z SMS-em do klienta (wpis w `notifications`). */
const cancelNotify = (id: string) =>
  appointmentRoute.DELETE(
    createMockRequest(`http://localhost/api/appointments/${id}?notifyClient=true`, { method: "DELETE" }),
    createRouteParams(id)
  );

const update = (id: string, body: Record<string, unknown>) =>
  appointmentRoute.PUT(
    createMockRequest(`http://localhost/api/appointments/${id}`, { method: "PUT", body }),
    createRouteParams(id)
  );

/** Obserwator pod blokadą przepisuje wizytę na innego pracownika (opcjonalnie też ją kończy). */
const reassignUnderLock =
  (appt: string, status?: string) =>
  async (tx: ObserverTx): Promise<void> => {
    if (status) {
      await tx.unsafe("update appointments set employee_id = $1, status = $2 where id = $3", [
        ids.empOther,
        status,
        appt,
      ]);
    } else {
      await tx.unsafe("update appointments set employee_id = $1 where id = $2", [ids.empOther, appt]);
    }
  };

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
 * `underLock` (opcjonalnie) zmienia wiersz w transakcji obserwatora zaraz po
 * blokadzie: żądania widzą stan sprzed zmiany, dopóki obserwator nie zatwierdzi.
 * Zwraca wyniki w kolejności uruchomienia.
 */
async function inLockOrder(
  appt: string,
  starts: Array<() => Promise<Outcome>>,
  underLock?: (tx: ObserverTx) => Promise<void>
): Promise<Outcome[]> {
  const pending: Promise<Outcome>[] = [];
  let barrierPassed = false;
  try {
    await h!.observer.begin(async (tx) => {
      await tx.unsafe("set local lock_timeout = '15s'");
      const [me] = (await tx.unsafe("select pg_backend_pid() as pid")) as unknown as { pid: number }[];
      const locked = (await tx.unsafe("select id from appointments where id = $1 for update", [appt])) as unknown as unknown[];
      if (locked.length !== 1) throw new Error("obserwator nie zablokował wiersza wizyty");
      if (underLock) await underLock(tx as unknown as ObserverTx);
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

async function rowOf(appt: string) {
  const [a] = await h!.db
    .select({
      status: appointments.status,
      employeeId: appointments.employeeId,
      clientId: appointments.clientId,
      serviceId: appointments.serviceId,
      notes: appointments.notes,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      depositPaid: appointments.depositPaid,
    })
    .from(appointments)
    .where(eq(appointments.id, appt));
  return a!;
}

async function notificationsOfClient() {
  return h!.db.select({ id: notifications.id }).from(notifications).where(eq(notifications.clientId, ids.client));
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
    await db.insert(user).values([
      { id: OWNER, name: "IT ccr", email: `${OWNER}@example.invalid` },
      { id: EMP_USER, name: "IT ccr pracownik", email: `${EMP_USER}@example.invalid` },
    ]);
    const [s] = await db.insert(salons).values({ name: `IT ccr ${RUN}`, ownerId: OWNER }).returning({ id: salons.id });
    ids.salon = s!.id;
    const [e] = await db
      .insert(employees)
      .values({ salonId: ids.salon, firstName: "IT", lastName: "Pracownik ccr", commissionRate: "40" })
      .returning({ id: employees.id });
    ids.emp = e!.id;
    const [own] = await db
      .insert(employees)
      .values({
        salonId: ids.salon,
        userId: EMP_USER,
        firstName: "IT",
        lastName: "Pracownik z kontem ccr",
        role: "employee",
        isActive: true,
      })
      .returning({ id: employees.id });
    ids.empOwn = own!.id;
    const [other] = await db
      .insert(employees)
      .values({ salonId: ids.salon, firstName: "IT", lastName: "Inny pracownik ccr" })
      .returning({ id: employees.id });
    ids.empOther = other!.id;
    const [c] = await db
      .insert(clients)
      .values({ salonId: ids.salon, firstName: "IT", lastName: "Klient ccr" })
      .returning({ id: clients.id });
    ids.client = c!.id;
    const [c2] = await db
      .insert(clients)
      .values({ salonId: ids.salon, firstName: "IT", lastName: "Inny klient ccr" })
      .returning({ id: clients.id });
    ids.clientOther = c2!.id;
    const [sv] = await db
      .insert(services)
      .values({ salonId: ids.salon, name: "IT ccr usługa", basePrice: "150.00", baseDuration: 30 })
      .returning({ id: services.id });
    ids.service = sv!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      try {
        if (ids.salon) await h.db.delete(salons).where(inArray(salons.id, [ids.salon]));
      } finally {
        // Konta niezależnie od wyniku usunięcia salonu (błąd kaskady nie zostawia kont).
        await h.db.delete(user).where(inArray(user.id, [OWNER, EMP_USER]));
      }
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
      // Zadatek wizyty bez zmian (anulowanie niczego nie zatwierdziło).
      expect((await rowOf(appt)).depositPaid).toBe(false);
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
      // Zwolniony termin zgłoszony liście oczekujących dokładnie raz.
      expect(mocks.notifyWaitingList).toHaveBeenCalledTimes(1);
      expect(mocks.error).not.toHaveBeenCalled();
    },
    30_000
  );

  it(
    "pracownik odwołuje wizytę przepisaną pod blokadą → 404; nieanulowana, płatność pending, bez powiadomienia, listy i zwrotu",
    async () => {
      const { appt, payment } = await appointmentWithPendingDeposit({ employeeId: ids.empOwn, clientId: ids.client });
      ctl.userId = EMP_USER;

      const [cancelled] = await inLockOrder(
        appt,
        [async () => parseResponse<Body>(await cancelNotify(appt))],
        reassignUnderLock(appt)
      );

      expect(cancelled!.status, outcomeSummary(cancelled)).toBe(404);
      expect(cancelled!.body.code).toBe(APPOINTMENT_ERROR_CODES.appointmentNotFound);
      const row = await rowOf(appt);
      expect(row.status).toBe("scheduled");
      expect(row.employeeId).toBe(ids.empOther);
      // Krok `pending → failed` wycofany razem z transakcją odwołania.
      expect(await paymentStatusOf(payment)).toBe("pending");
      expect(await notificationsOfClient()).toHaveLength(0);
      expect(mocks.notifyWaitingList).not.toHaveBeenCalled();
      expect(mocks.refund).not.toHaveBeenCalled();
      expect(mocks.error).not.toHaveBeenCalled();
    },
    30_000
  );

  it(
    "pracownik odwołuje wizytę przepisaną i zakończoną pod blokadą → 404, nie 409",
    async () => {
      const { appt, payment } = await appointmentWithPendingDeposit({ employeeId: ids.empOwn, clientId: ids.client });
      ctl.userId = EMP_USER;

      const [cancelled] = await inLockOrder(
        appt,
        [async () => parseResponse<Body>(await cancelNotify(appt))],
        reassignUnderLock(appt, "completed")
      );

      expect(cancelled!.status, outcomeSummary(cancelled)).toBe(404);
      expect(cancelled!.body.code).toBe(APPOINTMENT_ERROR_CODES.appointmentNotFound);
      const row = await rowOf(appt);
      expect(row.status).toBe("completed");
      expect(row.employeeId).toBe(ids.empOther);
      expect(await paymentStatusOf(payment)).toBe("pending");
      expect(await notificationsOfClient()).toHaveLength(0);
      expect(mocks.notifyWaitingList).not.toHaveBeenCalled();
      expect(mocks.refund).not.toHaveBeenCalled();
      expect(mocks.error).not.toHaveBeenCalled();
    },
    30_000
  );

  it("kontrola: pracownik zapisuje notatkę własnej wizyty → 200, notatka w bazie", async () => {
    const { appt } = await appointmentWithPendingDeposit({ employeeId: ids.empOwn });
    ctl.userId = EMP_USER;

    const res = await parseResponse<Body>(await update(appt, { notes: "IT notatka własna" }));

    expect(res.status, outcomeSummary(res)).toBe(200);
    expect((await rowOf(appt)).notes).toBe("IT notatka własna");
  });

  it(
    "pracownik zapisuje notatkę wizyty przepisanej pod blokadą → 404, notatka bez zmian",
    async () => {
      const { appt } = await appointmentWithPendingDeposit({ employeeId: ids.empOwn });
      ctl.userId = EMP_USER;

      const [saved] = await inLockOrder(
        appt,
        [async () => parseResponse<Body>(await update(appt, { notes: "IT notatka po przepisaniu" }))],
        reassignUnderLock(appt)
      );

      expect(saved!.status, outcomeSummary(saved)).toBe(404);
      expect(saved!.body.code).toBe(APPOINTMENT_ERROR_CODES.appointmentNotFound);
      const row = await rowOf(appt);
      expect(row.notes).toBeNull();
      expect(row.employeeId).toBe(ids.empOther);
    },
    30_000
  );

  it(
    "pracownik przesuwa termin wizyty przepisanej pod blokadą → 404, termin i pracownik bez zmian, bez logu błędu",
    async () => {
      const { appt, start, end } = await appointmentWithPendingDeposit({ employeeId: ids.empOwn });
      ctl.userId = EMP_USER;
      // Termin przesunięty o 15 minut, w obrębie własnego slotu (bez kolizji z innymi wizytami testu).
      const moved = {
        startTime: new Date(start.getTime() + 900_000).toISOString(),
        endTime: new Date(end.getTime() + 900_000).toISOString(),
      };

      const [saved] = await inLockOrder(
        appt,
        [async () => parseResponse<Body>(await update(appt, moved))],
        reassignUnderLock(appt)
      );

      expect(saved!.status, outcomeSummary(saved)).toBe(404);
      expect(saved!.body.code).toBe(APPOINTMENT_ERROR_CODES.appointmentNotFound);
      const row = await rowOf(appt);
      expect(row.startTime.getTime()).toBe(start.getTime());
      expect(row.endTime.getTime()).toBe(end.getTime());
      expect(row.employeeId).toBe(ids.empOther);
      expect(row.status).toBe("scheduled");
      expect(mocks.error).not.toHaveBeenCalled();
    },
    30_000
  );

  it(
    "PUT z body dialogu edycji czeka za zakończeniem: nowa notatka → 200, zapisana tylko notatka",
    async () => {
      const { appt, start, end } = await appointmentWithPendingDeposit();
      const dialogBody = {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        employeeId: ids.emp,
        serviceId: ids.service,
        notes: "IT notatka z dialogu",
      };

      const [done, saved] = await inLockOrder(appt, [
        async () => parseResponse<Body>(await complete(appt)),
        async () => parseResponse<Body>(await update(appt, dialogBody)),
      ]);

      expect(done!.status, outcomeSummary(done)).toBe(200);
      expect(saved!.status, outcomeSummary(saved)).toBe(200);
      const row = await rowOf(appt);
      expect(row.status).toBe("completed");
      expect(row.notes).toBe("IT notatka z dialogu");
      expect(row.startTime.getTime()).toBe(start.getTime());
      expect(row.endTime.getTime()).toBe(end.getTime());
      expect(row.employeeId).toBe(ids.emp);
    },
    30_000
  );

  it(
    "PUT ze zmienionym terminem czeka za zakończeniem → 409 APPOINTMENT_COMPLETED, wiersz bez zmian",
    async () => {
      const { appt, start, end } = await appointmentWithPendingDeposit();
      const moved = {
        startTime: new Date(start.getTime() + 900_000).toISOString(),
        endTime: new Date(end.getTime() + 900_000).toISOString(),
        employeeId: ids.emp,
        serviceId: ids.service,
        notes: "IT notatka z przeniesieniem",
      };

      const [done, saved] = await inLockOrder(appt, [
        async () => parseResponse<Body>(await complete(appt)),
        async () => parseResponse<Body>(await update(appt, moved)),
      ]);

      expect(done!.status, outcomeSummary(done)).toBe(200);
      expect(saved!.status, outcomeSummary(saved)).toBe(409);
      expect(saved!.body.code).toBe(APPOINTMENT_COMPLETED_CODE);
      const row = await rowOf(appt);
      expect(row.status).toBe("completed");
      expect(row.notes).toBeNull();
      expect(row.startTime.getTime()).toBe(start.getTime());
      expect(row.endTime.getTime()).toBe(end.getTime());
    },
    30_000
  );

  it("pracownik zmienia pracownika własnej wizyty → 403 z kodem, wiersz bez zmian", async () => {
    const { appt, start, end } = await appointmentWithPendingDeposit({ employeeId: ids.empOwn, clientId: ids.client });
    ctl.userId = EMP_USER;

    const res = await parseResponse<Body>(
      await update(appt, {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        employeeId: ids.empOther,
        clientId: ids.client,
        serviceId: ids.service,
        notes: "IT notatka przy przekazaniu",
      })
    );

    expect(res.status, outcomeSummary(res)).toBe(403);
    expect(res.body.code).toBe(APPOINTMENT_ERROR_CODES.assignmentForbidden);
    const row = await rowOf(appt);
    expect(row.employeeId).toBe(ids.empOwn);
    expect(row.clientId).toBe(ids.client);
    expect(row.serviceId).toBe(ids.service);
    expect(row.notes).toBeNull();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("pracownik zmienia klienta albo usługę własnej wizyty → 403 z kodem, wiersz bez zmian", async () => {
    const { appt } = await appointmentWithPendingDeposit({ employeeId: ids.empOwn, clientId: ids.client });
    ctl.userId = EMP_USER;

    const noClient = await parseResponse<Body>(await update(appt, { clientId: null, notes: "IT notatka bez klienta" }));
    const noService = await parseResponse<Body>(await update(appt, { serviceId: null }));
    const otherClient = await parseResponse<Body>(
      await update(appt, { clientId: ids.clientOther, notes: "IT notatka z innym klientem" })
    );

    for (const res of [noClient, noService, otherClient]) {
      expect(res.status, outcomeSummary(res)).toBe(403);
      expect(res.body.code).toBe(APPOINTMENT_ERROR_CODES.assignmentForbidden);
    }
    const row = await rowOf(appt);
    expect(row.clientId).toBe(ids.client);
    expect(row.serviceId).toBe(ids.service);
    expect(row.employeeId).toBe(ids.empOwn);
    expect(row.notes).toBeNull();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("kontrola: pracownik, body dialogu z tymi samymi wartościami i nowym terminem → 200, termin zapisany", async () => {
    const { appt, start, end } = await appointmentWithPendingDeposit({ employeeId: ids.empOwn, clientId: ids.client });
    ctl.userId = EMP_USER;
    // Termin przesunięty o 15 minut, w obrębie własnego slotu (bez kolizji z innymi wizytami testu).
    const movedStart = new Date(start.getTime() + 900_000);
    const movedEnd = new Date(end.getTime() + 900_000);

    const res = await parseResponse<Body>(
      await update(appt, {
        startTime: movedStart.toISOString(),
        endTime: movedEnd.toISOString(),
        employeeId: ids.empOwn,
        clientId: ids.client,
        serviceId: ids.service,
        notes: "IT notatka pracownika",
      })
    );

    expect(res.status, outcomeSummary(res)).toBe(200);
    const row = await rowOf(appt);
    expect(row.startTime.getTime()).toBe(movedStart.getTime());
    expect(row.notes).toBe("IT notatka pracownika");
    expect(row.employeeId).toBe(ids.empOwn);
  });

  it("kontrola pozytywna: właściciel odwołuje wizytę klienta z SMS-em → jeden nowy wiersz notifications", async () => {
    const { appt } = await appointmentWithPendingDeposit({ clientId: ids.client });
    const before = (await notificationsOfClient()).length;

    const res = await parseResponse<Body>(await cancelNotify(appt));

    expect(res.status, outcomeSummary(res)).toBe(200);
    expect(await statusOf(appt)).toBe("cancelled");
    expect(await notificationsOfClient()).toHaveLength(before + 1);
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
