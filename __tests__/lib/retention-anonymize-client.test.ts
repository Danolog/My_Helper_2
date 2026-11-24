/**
 * `anonymizeClientData` bez bazy:
 * - brak salonu albo klienta kończy się błędem, zanim funkcja wyśle cokolwiek
 *   do transakcji;
 * - kolejność zapytań: `lock_timeout`, blokada klienta, blokada jego wizyt,
 *   dopiero potem pierwszy `UPDATE` (prawdziwy budowniczy drizzle `pg-proxy`
 *   zapisuje renderowany SQL).
 * Zachowanie na danych sprawdza test na prawdziwym Postgresie
 * (`__tests__/pg/anonymize-client.pg.test.ts`).
 */
import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it, vi } from "vitest";
import type { DbTx } from "@/lib/server/repository";
import {
  anonymizeClientData,
  countClientRemovalBlockers,
  lockClientForRemoval,
} from "@/lib/server/retention/anonymize-client";

const SALON_ID = "salon-1";
const CLIENT_ID = "client-1";

/** Transakcja `pg-proxy`: zapisuje SQL z parametrami; wiersze według wzorca. */
function recordingTx(rows: Array<[RegExp, unknown[][]]>) {
  const captured: Array<{ sql: string; params: unknown[] }> = [];
  const tx = drizzle(async (sql: string, params: unknown[]) => {
    captured.push({ sql, params });
    const hit = rows.find(([re]) => re.test(sql));
    return { rows: hit ? hit[1] : [] };
  }) as unknown as DbTx;
  return { tx, captured };
}

const CLIENT_LOCK = /^select "id" from "clients" .* for update$/;
const APPOINTMENTS_LOCK = /^select "id" from "appointments" .* for update$/;

function trackingTx() {
  const calls: string[] = [];
  const tx = new Proxy(
    {},
    {
      get(_target, prop) {
        return vi.fn(() => {
          calls.push(String(prop));
          throw new Error(`nieoczekiwane wywołanie tx.${String(prop)}`);
        });
      },
    }
  ) as unknown as DbTx;
  return { tx, calls };
}

describe("anonymizeClientData — walidacja argumentów", () => {
  it.each([
    ["pusty salonId", "", "client-1"],
    ["pusty clientId", "salon-1", ""],
    ["oba puste", "", ""],
  ])("%s → błąd, transakcja nietknięta", async (_label, salonId, clientId) => {
    const { tx, calls } = trackingTx();
    await expect(anonymizeClientData(tx, salonId, clientId)).rejects.toThrow(
      "anonymizeClientData: salonId i clientId wymagane"
    );
    expect(calls).toEqual([]);
  });
});

describe("anonymizeClientData — kolejność blokad", () => {
  it("blokada wizyt klienta (FOR UPDATE, warunek klienta i salonu) idzie po blokadzie klienta i przed pierwszym UPDATE", async () => {
    const { tx, captured } = recordingTx([[CLIENT_LOCK, [[CLIENT_ID]]]]);
    await anonymizeClientData(tx, SALON_ID, CLIENT_ID);

    const statements = captured.map((q) => q.sql);
    expect(statements[0]).toMatch(/^set local lock_timeout = /);
    expect(statements[1]).toMatch(CLIENT_LOCK);
    expect(statements[2]).toMatch(APPOINTMENTS_LOCK);
    expect(statements[2]).toContain('"appointments"."client_id" = $1');
    expect(statements[2]).toContain('"appointments"."salon_id" = $2');
    expect(captured[2]!.params).toEqual([CLIENT_ID, SALON_ID]);

    const firstUpdate = statements.findIndex((s) => s.startsWith("update "));
    expect(firstUpdate).toBe(3);
    expect(statements.filter((s) => / for update$/.test(s))).toHaveLength(2);
  });

  it("klient spoza salonu: bez blokady wizyt i bez UPDATE", async () => {
    const { tx, captured } = recordingTx([]);
    await expect(anonymizeClientData(tx, SALON_ID, CLIENT_ID)).resolves.toEqual({
      appointments: 0,
      treatmentHistory: 0,
      appointmentMaterials: 0,
      notifications: 0,
      aiConversations: 0,
      reviews: 0,
    });
    expect(captured.map((q) => q.sql)).toHaveLength(2);
    expect(captured.some((q) => APPOINTMENTS_LOCK.test(q.sql))).toBe(false);
  });

  it("treatment_history: materials_json wraca do pustej listy JSON", async () => {
    const { tx, captured } = recordingTx([[CLIENT_LOCK, [[CLIENT_ID]]]]);
    await anonymizeClientData(tx, SALON_ID, CLIENT_ID);
    const update = captured.find((q) => q.sql.startsWith('update "treatment_history"'));
    expect(update?.sql).toContain(`"materials_json" = '[]'::jsonb`);
  });

  it("appointments: ten sam UPDATE zeruje wskazanie konta portalu (booked_by_user_id)", async () => {
    const { tx, captured } = recordingTx([[CLIENT_LOCK, [[CLIENT_ID]]]]);
    await anonymizeClientData(tx, SALON_ID, CLIENT_ID);
    const updates = captured.filter((q) => q.sql.startsWith('update "appointments"'));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.sql).toMatch(/"booked_by_user_id" = (\$\d+|null)/);
    expect(updates[0]!.sql).toMatch(/"notes" = (\$\d+|null)/);
  });
});

describe("lockClientForRemoval", () => {
  it("lock_timeout, klient, wizyty — i nic więcej; zwraca true", async () => {
    const { tx, captured } = recordingTx([[CLIENT_LOCK, [[CLIENT_ID]]]]);
    await expect(lockClientForRemoval(tx, SALON_ID, CLIENT_ID)).resolves.toBe(true);
    const statements = captured.map((q) => q.sql);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/^set local lock_timeout = /);
    expect(statements[1]).toMatch(CLIENT_LOCK);
    expect(statements[2]).toMatch(APPOINTMENTS_LOCK);
  });

  it("klient spoza salonu: false, bez blokady wizyt", async () => {
    const { tx, captured } = recordingTx([]);
    await expect(lockClientForRemoval(tx, SALON_ID, CLIENT_ID)).resolves.toBe(false);
    expect(captured.some((q) => APPOINTMENTS_LOCK.test(q.sql))).toBe(false);
  });
});

describe("countClientRemovalBlockers", () => {
  const NOW = new Date("2026-11-24T10:00:00.000Z");

  it("jedno zapytanie po wizytach klienta w salonie: przyszłe nieodwołane i odwołane z wpłaconym zadatkiem", async () => {
    const { tx, captured } = recordingTx([[/from "appointments"/, [[3, 1]]]]);
    await expect(countClientRemovalBlockers(tx, SALON_ID, CLIENT_ID, NOW)).resolves.toEqual({
      futureAppointments: 3,
      depositsToRefund: 1,
    });
    expect(captured).toHaveLength(1);
    const { sql, params } = captured[0]!;
    expect(sql).not.toMatch(/for update/);
    expect(sql).toMatch(/"appointments"\."start_time" > \$\d+ and "appointments"\."status" <> \$\d+/);
    expect(sql).toMatch(/"appointments"\."status" = \$\d+ and "appointments"\."deposit_paid" = \$\d+/);
    expect(sql).toMatch(/"appointments"\."client_id" = \$\d+ and "appointments"\."salon_id" = \$\d+/);
    expect(params).toEqual(expect.arrayContaining(["cancelled", true, CLIENT_ID, SALON_ID]));
    // Termin porównywany z czasem aplikacji, zapisanym tak jak przy zapisie wizyty.
    expect(params).toContain(NOW.toISOString());
  });

  it("brak wizyt (pusty wynik) → zera", async () => {
    const { tx } = recordingTx([]);
    await expect(countClientRemovalBlockers(tx, SALON_ID, CLIENT_ID, NOW)).resolves.toEqual({
      futureAppointments: 0,
      depositsToRefund: 0,
    });
  });
});
