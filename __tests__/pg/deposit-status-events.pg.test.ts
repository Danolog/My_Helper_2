/**
 * Dziennik zmian zadatku `deposit_status_events` (migracja 0014) na PRAWDZIWYM Postgresie:
 * - uprawnienia roli aplikacji: tylko SELECT i INSERT, PUBLIC bez dostępu;
 * - zapis tylko do dopisywania pod `SET LOCAL ROLE myhelper_app`: UPDATE/DELETE/TRUNCATE →
 *   42501 z braku uprawnienia (nie z RLS), wpis bez zmian;
 * - CHECK-i (23514) i złożony FK (23503) także dla roli migracji (pula systemowa omija RLS, FK nie);
 * - RLS po `salon_id`;
 * - atomowość z UPDATE flagi przez `forSalon(A).raw` + `recordDepositStatusEvent`;
 * - kaskada: usunięcie wizyty usuwa jej wpisy.
 *
 * Dane: konto `it-t3-dse-…`, salony A i B, pracownicy i wizyty zatwierdzone rolą migracji;
 * wpisy z prób uprawnień, CHECK, FK i RLS w transakcji wycofywanej. Salony usuwane w
 * `afterAll` (kaskada: wizyty i ich wpisy). Bez danych klientów (wizyty bez gościa i klienta).
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { recordDepositStatusEvent } from "@/lib/deposit-status-events";
import { appointments, depositStatusEvents, employees, salons, user } from "@/lib/schema";
import { forSalon, type DbTx } from "@/lib/server/repository";
import { APP_ROLE, SALON_CONTEXT_VAR } from "../../scripts/db-rls-guard";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));

const suite = h ? describe : describe.skip;

type Conn = { unsafe: (query: string, params?: unknown[]) => PromiseLike<readonly unknown[]> };
type Reserved = Conn & { release: () => void };
type PgError = { code?: unknown; message?: unknown; constraint_name?: unknown };

const RUN = randomUUID().slice(0, 8);
const USER_ID = `it-t3-dse-${RUN}`;
const ACTOR = `it-t3-dse-actor-${RUN}`;
const TABLE = "deposit_status_events";
let salonA = "";
let salonB = "";
const employeeOf: Record<string, string> = {};
let slot = 0;

/** Wizyta salonu (rola migracji, zatwierdzona); każda w osobnym, dalekim terminie. */
async function appointment(salonId: string): Promise<string> {
  const start = new Date(Date.UTC(2099, 5, 1, 8) + slot++ * 3_600_000);
  const [a] = await h!.db
    .insert(appointments)
    .values({ salonId, employeeId: employeeOf[salonId]!, startTime: start, endTime: new Date(start.getTime() + 1_800_000), depositPaid: false })
    .returning({ id: appointments.id });
  return a!.id;
}

/** Transakcja na zarezerwowanym połączeniu (rola migracji), zawsze wycofywana. */
async function inRolledBackTx(fn: (c: Conn) => Promise<void>): Promise<void> {
  const c = (await h!.observer.reserve()) as unknown as Reserved;
  try {
    await c.unsafe("BEGIN");
    await fn(c);
  } finally {
    await c.unsafe("ROLLBACK");
    c.release();
  }
}

/** Błąd polecenia w SAVEPOINT (transakcja zostaje używalna) albo null, gdy przeszło. */
async function failure(c: Conn, query: string, params?: unknown[]): Promise<PgError | null> {
  await c.unsafe("SAVEPOINT step");
  try {
    await c.unsafe(query, params);
    return null;
  } catch (e) {
    return e as PgError;
  } finally {
    await c.unsafe("ROLLBACK TO SAVEPOINT step");
  }
}

/** Polecenie pod rolą aplikacji z kontekstem salonu; efekty (także SET LOCAL) cofane. */
async function failureAsApp(c: Conn, salon: string, query: string, params?: unknown[]): Promise<PgError | null> {
  await c.unsafe("SAVEPOINT app");
  try {
    await c.unsafe(`SET LOCAL ROLE ${APP_ROLE}`);
    await c.unsafe(`SELECT set_config('${SALON_CONTEXT_VAR}', $1, true)`, [salon]);
    await c.unsafe(query, params);
    return null;
  } catch (e) {
    return e as PgError;
  } finally {
    await c.unsafe("ROLLBACK TO SAVEPOINT app");
  }
}

type EventRow = {
  salon_id: string;
  appointment_id: string;
  deposit_paid: boolean;
  previous_deposit_paid: boolean;
  source: string;
  actor_user_id: string | null;
  actor_role: string | null;
};

const INSERT_EVENT =
  `INSERT INTO ${TABLE} (salon_id, appointment_id, deposit_paid, previous_deposit_paid, source, actor_user_id, actor_role) ` +
  "VALUES ($1::uuid, $2::uuid, $3::boolean, $4::boolean, $5, $6, $7)";
const params = (r: EventRow) => [r.salon_id, r.appointment_id, r.deposit_paid, r.previous_deposit_paid, r.source, r.actor_user_id, r.actor_role];

const markBy = (salon: string, appt: string): EventRow => ({
  salon_id: salon,
  appointment_id: appt,
  deposit_paid: true,
  previous_deposit_paid: false,
  source: "manual_mark",
  actor_user_id: ACTOR,
  actor_role: "owner",
});

async function insertEventReturningId(c: Conn, r: EventRow): Promise<string> {
  const rows = (await c.unsafe(`${INSERT_EVENT} RETURNING id::text AS id`, params(r))) as Array<{ id: string }>;
  return rows[0]!.id;
}

async function flagOf(appt: string): Promise<boolean | null> {
  const [a] = await h!.db.select({ v: appointments.depositPaid }).from(appointments).where(eq(appointments.id, appt));
  return a!.v;
}

async function eventsOf(appt: string) {
  return h!.db.select().from(depositStatusEvents).where(eq(depositStatusEvents.appointmentId, appt));
}

suite("deposit_status_events — prawdziwy Postgres (migracja 0014)", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values({ id: USER_ID, name: "IT T3 dse", email: `${USER_ID}@example.invalid` });
    for (const label of ["A", "B"]) {
      const [s] = await db.insert(salons).values({ name: `IT T3 dse ${label} ${RUN}`, ownerId: USER_ID }).returning({ id: salons.id });
      const [e] = await db.insert(employees).values({ salonId: s!.id, firstName: "IT", lastName: "Pracownik" }).returning({ id: employees.id });
      employeeOf[s!.id] = e!.id;
      if (label === "A") salonA = s!.id;
      else salonB = s!.id;
    }
  });

  afterAll(async () => {
    if (!h) return;
    try {
      // Kaskada z salonów: pracownicy, wizyty i ich wpisy w dzienniku.
      for (const s of [salonA, salonB]) if (s) await h.db.delete(salons).where(eq(salons.id, s));
      await h.db.delete(user).where(eq(user.id, USER_ID));
    } finally {
      await h.end();
    }
  });

  it("uprawnienia: myhelper_app ma SELECT i INSERT, nie ma UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER; PUBLIC bez SELECT", async () => {
    const privs = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
    const rows = (await h!.observer.unsafe(
      `SELECT p, has_table_privilege('${APP_ROLE}', 'public.${TABLE}', p) AS app FROM unnest($1::text[]) AS p`,
      [privs],
    )) as Array<{ p: string; app: boolean }>;
    expect(Object.fromEntries(rows.map((r) => [r.p, r.app]))).toEqual({
      SELECT: true,
      INSERT: true,
      UPDATE: false,
      DELETE: false,
      TRUNCATE: false,
      REFERENCES: false,
      TRIGGER: false,
    });
    const [pub] = (await h!.observer.unsafe(`SELECT has_table_privilege('public', 'public.${TABLE}', 'SELECT') AS v`)) as Array<{ v: boolean }>;
    expect(pub!.v).toBe(false);
  });

  it("tylko do dopisywania: UPDATE/DELETE/TRUNCATE własnego wpisu pod rolą aplikacji → 42501 z braku uprawnienia; wpis bez zmian", async () => {
    const appt = await appointment(salonA);
    await inRolledBackTx(async (c) => {
      const id = await insertEventReturningId(c, markBy(salonA, appt));
      const [before] = (await c.unsafe(`SELECT to_jsonb(e) AS r FROM ${TABLE} e WHERE id = $1::uuid`, [id])) as Array<{ r: unknown }>;
      for (const q of [
        `UPDATE ${TABLE} SET actor_role = 'receptionist' WHERE id = '${id}'::uuid`,
        `DELETE FROM ${TABLE} WHERE id = '${id}'::uuid`,
        `TRUNCATE ${TABLE}`,
      ]) {
        const err = await failureAsApp(c, salonA, q);
        expect(err?.code, q).toBe("42501");
        expect(String(err?.message), q).toMatch(/permission denied/);
        expect(String(err?.message), q).not.toMatch(/row-level security/);
      }
      const [after] = (await c.unsafe(`SELECT to_jsonb(e) AS r FROM ${TABLE} e WHERE id = $1::uuid`, [id])) as Array<{ r: unknown }>;
      expect(after!.r).toEqual(before!.r);
    });
  });

  // Każdy przypadek łamie tylko wskazany CHECK, żeby nazwa ograniczenia w błędzie była jednoznaczna.
  // Wyjątek: źródło spoza listy łamie też direction i actor (wyliczają źródła) — wtedy tylko kod.
  it.each<[string, (r: EventRow) => EventRow, string | null]>([
    ["źródło spoza listy", (r) => ({ ...r, source: "import" }), null],
    ["wartość bez zmiany (owner_edit)", (r) => ({ ...r, source: "owner_edit", deposit_paid: false, previous_deposit_paid: false }), "deposit_status_events_value_changed"],
    ["manual_mark na false", (r) => ({ ...r, deposit_paid: false, previous_deposit_paid: true }), "deposit_status_events_direction"],
    ["refund na true", (r) => ({ ...r, source: "refund", actor_user_id: null, actor_role: null }), "deposit_status_events_direction"],
    ["stripe_confirmation z aktorem", (r) => ({ ...r, source: "stripe_confirmation" }), "deposit_status_events_actor"],
    ["manual_unmark bez aktora", (r) => ({ ...r, source: "manual_unmark", deposit_paid: false, previous_deposit_paid: true, actor_user_id: null, actor_role: null }), "deposit_status_events_actor"],
    ["manual_mark z rolą employee", (r) => ({ ...r, actor_role: "employee" }), "deposit_status_events_actor"],
    ["owner_edit przez recepcję", (r) => ({ ...r, source: "owner_edit", actor_role: "receptionist" }), "deposit_status_events_actor"],
  ])("CHECK (rola migracji): %s → 23514 %s", async (_n, mutate, constraint) => {
    const appt = await appointment(salonA);
    await inRolledBackTx(async (c) => {
      const err = await failure(c, INSERT_EVENT, params(mutate(markBy(salonA, appt))));
      expect(err?.code).toBe("23514");
      if (constraint) expect(err?.constraint_name).toBe(constraint);
      else expect(String(err?.constraint_name)).toMatch(/^deposit_status_events_/);
      // Kontrola fałszywej zieleni: wpis wyjściowy przechodzi.
      expect(await failure(c, INSERT_EVENT, params(markBy(salonA, appt)))).toBeNull();
    });
  });

  it("złożony FK (rola migracji): wizyta salonu B z salon_id A → 23503", async () => {
    const apptB = await appointment(salonB);
    await inRolledBackTx(async (c) => {
      const err = await failure(c, INSERT_EVENT, params(markBy(salonA, apptB)));
      expect(err?.code).toBe("23503");
      expect(err?.constraint_name).toBe("deposit_status_events_appointment_salon_fk");
      expect(await failure(c, INSERT_EVENT, params(markBy(salonB, apptB)))).toBeNull();
    });
  });

  it("RLS: kontekst B nie widzi wpisu A; INSERT wpisu A w kontekście B → 42501 z polityki", async () => {
    const appt = await appointment(salonA);
    await inRolledBackTx(async (c) => {
      const id = await insertEventReturningId(c, markBy(salonA, appt));
      const count = async (salon: string) => {
        await c.unsafe("SAVEPOINT read");
        try {
          await c.unsafe(`SET LOCAL ROLE ${APP_ROLE}`);
          await c.unsafe(`SELECT set_config('${SALON_CONTEXT_VAR}', $1, true)`, [salon]);
          const [r] = (await c.unsafe(`SELECT count(*)::int AS n FROM ${TABLE} WHERE id = $1::uuid`, [id])) as Array<{ n: number }>;
          return r!.n;
        } finally {
          await c.unsafe("ROLLBACK TO SAVEPOINT read");
        }
      };
      expect(await count(salonB)).toBe(0);
      expect(await count(salonA)).toBe(1);
      const err = await failureAsApp(c, salonB, INSERT_EVENT, params(markBy(salonA, appt)));
      expect(err?.code).toBe("42501");
      expect(String(err?.message)).toMatch(/row-level security/);
    });
  });

  describe("atomowość z UPDATE flagi przez forSalon(A).raw", () => {
    const setFlag = (appt: string) => (tx: DbTx) =>
      tx
        .update(appointments)
        .set({ depositPaid: true })
        .where(and(eq(appointments.id, appt), eq(appointments.salonId, salonA)));

    it("(i) błąd w callbacku po UPDATE i wpisie → flaga false, 0 wpisów", async () => {
      const appt = await appointment(salonA);
      await expect(
        forSalon(salonA).raw(async (tx) => {
          await setFlag(appt)(tx);
          await recordDepositStatusEvent(tx, {
            salonId: salonA,
            appointmentId: appt,
            previousDepositPaid: false,
            depositPaid: true,
            source: "manual_mark",
            actor: { userId: ACTOR, role: "owner" },
          });
          throw new Error("it-rollback");
        }),
      ).rejects.toThrow("it-rollback");
      expect(await flagOf(appt)).toBe(false);
      expect(await eventsOf(appt)).toHaveLength(0);
    });

    it("(ii) wpis z wizytą salonu B (błąd bazy) → flaga A bez zmian, 0 wpisów", async () => {
      const appt = await appointment(salonA);
      const apptB = await appointment(salonB);
      const err = await forSalon(salonA)
        .raw(async (tx) => {
          await setFlag(appt)(tx);
          await recordDepositStatusEvent(tx, {
            salonId: salonA,
            appointmentId: apptB,
            previousDepositPaid: false,
            depositPaid: true,
            source: "manual_mark",
            actor: { userId: ACTOR, role: "owner" },
          });
        })
        .then(() => null, (e: unknown) => e as PgError & { cause?: PgError });
      expect(err).not.toBeNull();
      // Drizzle może owinąć błąd sterownika; kod bazy w samym błędzie albo w `cause`.
      expect(err?.code ?? err?.cause?.code).toBe("23503");
      expect(await flagOf(appt)).toBe(false);
      expect(await eventsOf(appt)).toHaveLength(0);
      expect(await eventsOf(apptB)).toHaveLength(0);
    });

    it("(iii) UPDATE + wpis bez błędu → flaga true, 1 wpis z polami wejścia", async () => {
      const appt = await appointment(salonA);
      await forSalon(salonA).raw(async (tx) => {
        await setFlag(appt)(tx);
        await recordDepositStatusEvent(tx, {
          salonId: salonA,
          appointmentId: appt,
          previousDepositPaid: false,
          depositPaid: true,
          source: "manual_mark",
          actor: { userId: ACTOR, role: "receptionist" },
        });
      });
      expect(await flagOf(appt)).toBe(true);
      const events = await eventsOf(appt);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        salonId: salonA,
        appointmentId: appt,
        depositPaid: true,
        previousDepositPaid: false,
        source: "manual_mark",
        actorUserId: ACTOR,
        actorRole: "receptionist",
      });
      expect(events[0]!.createdAt).toBeInstanceOf(Date);
    });
  });

  it("kaskada: usunięcie wizyty rolą migracji usuwa jej wpisy", async () => {
    const appt = await appointment(salonA);
    await h!.observer.unsafe(INSERT_EVENT, params(markBy(salonA, appt)) as never[]);
    expect(await eventsOf(appt)).toHaveLength(1);
    await h!.db.delete(appointments).where(eq(appointments.id, appt));
    expect(await eventsOf(appt)).toHaveLength(0);
  });
});
