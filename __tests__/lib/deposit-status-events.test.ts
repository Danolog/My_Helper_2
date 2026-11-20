// @vitest-environment node
/**
 * Pomocnik dziennika zmian zadatku (`src/lib/deposit-status-events.ts`): walidacja
 * przed zapisem (te same reguły co CHECK-i migracji 0014) i dokładny kształt wpisu.
 * Na prawdziwym Postgresie (uprawnienia, CHECK, FK, RLS, atomowość):
 * `__tests__/pg/deposit-status-events.pg.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import {
  DepositStatusEventError,
  recordDepositStatusEvent,
  type DepositStatusEventInput,
} from "@/lib/deposit-status-events";
import { depositStatusEvents } from "@/lib/schema";
import type { DbTx } from "@/lib/server/repository";

const SALON = "11111111-1111-4111-8111-111111111111";
const APPOINTMENT = "22222222-2222-4222-8222-222222222222";
const USER = "user-actor-1";
const OWNER = { userId: USER, role: "owner" as const };
const RECEPTION = { userId: USER, role: "receptionist" as const };

function fakeTx(values = vi.fn(async (_v: unknown) => undefined)) {
  const insert = vi.fn(() => ({ values }));
  return { tx: { insert } as unknown as DbTx, insert, values };
}

const base = { salonId: SALON, appointmentId: APPOINTMENT };

describe("recordDepositStatusEvent — poprawne wpisy", () => {
  it.each<[string, DepositStatusEventInput, boolean]>([
    ["manual_mark (właściciel)", { ...base, previousDepositPaid: false, depositPaid: true, source: "manual_mark", actor: OWNER }, false],
    ["manual_mark (recepcja)", { ...base, previousDepositPaid: false, depositPaid: true, source: "manual_mark", actor: RECEPTION }, false],
    ["manual_unmark", { ...base, previousDepositPaid: true, depositPaid: false, source: "manual_unmark", actor: RECEPTION }, true],
    ["owner_edit false→true", { ...base, previousDepositPaid: false, depositPaid: true, source: "owner_edit", actor: OWNER }, false],
    ["owner_edit true→false", { ...base, previousDepositPaid: true, depositPaid: false, source: "owner_edit", actor: OWNER }, true],
    ["stripe_confirmation", { ...base, previousDepositPaid: false, depositPaid: true, source: "stripe_confirmation", actor: null }, false],
    ["refund", { ...base, previousDepositPaid: true, depositPaid: false, source: "refund", actor: null }, true],
    ["NULL w kolumnie liczony jako false", { ...base, previousDepositPaid: null, depositPaid: true, source: "manual_mark", actor: OWNER }, false],
  ])("%s → jeden INSERT z 7 kluczami", async (_n, input, expectedPrevious) => {
    const { tx, insert, values } = fakeTx();
    await recordDepositStatusEvent(tx, input);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(depositStatusEvents);
    expect(values).toHaveBeenCalledTimes(1);
    const row = values.mock.calls[0]![0] as Record<string, unknown>;
    expect(row).toEqual({
      salonId: SALON,
      appointmentId: APPOINTMENT,
      depositPaid: input.depositPaid,
      previousDepositPaid: expectedPrevious,
      source: input.source,
      actorUserId: input.actor ? input.actor.userId : null,
      actorRole: input.actor ? input.actor.role : null,
    });
    expect(Object.keys(row).sort()).toEqual([
      "actorRole",
      "actorUserId",
      "appointmentId",
      "depositPaid",
      "previousDepositPaid",
      "salonId",
      "source",
    ]);
  });
});

describe("recordDepositStatusEvent — odmowy przed zapisem", () => {
  it.each<[string, unknown, "unchanged" | "direction" | "actor"]>([
    ["true→true", { ...base, previousDepositPaid: true, depositPaid: true, source: "owner_edit", actor: OWNER }, "unchanged"],
    ["NULL→false", { ...base, previousDepositPaid: null, depositPaid: false, source: "owner_edit", actor: OWNER }, "unchanged"],
    ["manual_mark na false", { ...base, previousDepositPaid: true, depositPaid: false, source: "manual_mark", actor: OWNER }, "direction"],
    ["manual_unmark na true", { ...base, previousDepositPaid: false, depositPaid: true, source: "manual_unmark", actor: OWNER }, "direction"],
    ["stripe_confirmation na false", { ...base, previousDepositPaid: true, depositPaid: false, source: "stripe_confirmation", actor: null }, "direction"],
    ["refund na true", { ...base, previousDepositPaid: false, depositPaid: true, source: "refund", actor: null }, "direction"],
    ["ścieżka ręczna bez aktora", { ...base, previousDepositPaid: false, depositPaid: true, source: "manual_mark", actor: null }, "actor"],
    ["pusty userId", { ...base, previousDepositPaid: false, depositPaid: true, source: "manual_mark", actor: { userId: "", role: "owner" } }, "actor"],
    ["rola employee", { ...base, previousDepositPaid: false, depositPaid: true, source: "manual_mark", actor: { userId: USER, role: "employee" } }, "actor"],
    ["owner_edit przez recepcję", { ...base, previousDepositPaid: false, depositPaid: true, source: "owner_edit", actor: RECEPTION }, "actor"],
    ["stripe_confirmation z aktorem", { ...base, previousDepositPaid: false, depositPaid: true, source: "stripe_confirmation", actor: OWNER }, "actor"],
  ])("%s → DepositStatusEventError(%s), bez INSERT", async (_n, input, code) => {
    const { tx, insert } = fakeTx();
    // Rzutowanie celowe: część przypadków jest niemożliwa w typach, a sprawdzamy czas wykonania.
    const p = recordDepositStatusEvent(tx, input as DepositStatusEventInput);
    await expect(p).rejects.toBeInstanceOf(DepositStatusEventError);
    await expect(p).rejects.toMatchObject({ code, message: `Nieprawidlowy wpis zmiany zadatku (${code})` });
    const err = await p.then(
      () => null,
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    for (const secret of [SALON, APPOINTMENT, USER]) expect(err?.message).not.toContain(secret);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("recordDepositStatusEvent — błąd bazy", () => {
  it("odrzucenie INSERT leci do wołającego bez zmian (cofa jego transakcję)", async () => {
    const dbError = Object.assign(new Error("insert failed"), { code: "23503" });
    const { tx } = fakeTx(vi.fn(async () => Promise.reject(dbError)));
    await expect(
      recordDepositStatusEvent(tx, { ...base, previousDepositPaid: false, depositPaid: true, source: "manual_mark", actor: OWNER }),
    ).rejects.toBe(dbError);
  });
});
