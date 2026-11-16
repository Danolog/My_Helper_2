/**
 * #193 P5a — cron martwych rezerwacji z zadatkiem przeniesiony do
 * `src/lib/server/system/deposits-cleanup.ts` (recenzja także Ethan: zapis
 * deposit_payments i anulowanie wizyt).
 *
 * Czerwone do PR P5a:
 * - moduł `system/deposits-cleanup.ts` nie istnieje (ładowany dynamicznie, żeby
 *   brak modułu był czerwienią testów, a nie błędem typecheck całego pliku);
 * - trasa liczy sama na `@/lib/db` zamiast wołać wyjście z rejestru.
 *
 * Pule są rozróżnione jawnie: `@/lib/db` (pula żądań) rzuca przy każdym użyciu,
 * `@/lib/server/system/db-system` to osobny fałszywy klient. Zachowanie trasy
 * (bramka CRON_SECRET, komunikaty, liczniki) bez zmian względem
 * __tests__/api/cron-cleanup-pending-deposits.test.ts — tamten plik zostaje
 * nietknięty do PR P5a.
 */
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequest, parseResponse } from "../api/helpers";

const requestPool = vi.hoisted(
  () =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return undefined;
          throw new Error(`pula żądań użyta w ścieżce systemowej (db.${String(prop)})`);
        },
      }
    )
);
vi.mock("@/lib/db", () => ({ db: requestPool }));

const sys = vi.hoisted(() => {
  const selectWhere = vi.fn();
  const txUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const txUpdateSet = vi.fn((..._a: unknown[]) => ({ where: txUpdateWhere }));
  const txUpdate = vi.fn((..._a: unknown[]) => ({ set: txUpdateSet }));
  const transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ update: txUpdate }));
  const select = vi.fn((..._a: unknown[]) => ({ from: () => ({ innerJoin: () => ({ where: selectWhere }) }) }));
  return { selectWhere, txUpdate, txUpdateSet, txUpdateWhere, transaction, select };
});
vi.mock("@/lib/server/system/db-system", () => ({
  dbSystem: { select: sys.select, transaction: sys.transaction },
}));

const registry = vi.hoisted(() => ({ cleanupStaleDepositBookings: vi.fn() }));
vi.mock("@/lib/server/system", () => registry);

// Bramka CRON_SECRET (auth-middleware) zostaje prawdziwa; moduł sesji bez adaptera.
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import { GET, POST } from "@/app/api/cron/cleanup-pending-deposits/route";

const MODULE = path.resolve(__dirname, "../../src/lib/server/system/deposits-cleanup.ts");
type Cleanup = () => Promise<{ cancelledAppointments: number; failedPayments: number }>;
async function loadCleanup(): Promise<Cleanup> {
  const mod = (await import(/* @vite-ignore */ MODULE)) as Record<string, unknown>;
  expect(typeof mod.cleanupStaleDepositBookings, "eksport cleanupStaleDepositBookings").toBe("function");
  return mod.cleanupStaleDepositBookings as Cleanup;
}

const SECRET = "test-cron-secret";
const CRON_URL = "http://localhost/api/cron/cleanup-pending-deposits";
const cronRequest = (method: "GET" | "POST", secret: string | null = SECRET) =>
  createMockRequest(CRON_URL,{ method, headers: secret ? { authorization: `Bearer ${secret}` } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  sys.selectWhere.mockResolvedValue([]);
});

describe("system/deposits-cleanup.ts: cleanupStaleDepositBookings (P5a)", () => {
  it("nic do zrobienia → zera, bez transakcji, tylko pula systemowa", async () => {
    const cleanup = await loadCleanup();
    await expect(cleanup()).resolves.toEqual({ cancelledAppointments: 0, failedPayments: 0 });
    expect(sys.select).toHaveBeenCalledTimes(1);
    expect(sys.transaction).not.toHaveBeenCalled();
  });

  it("martwe rezerwacje → jedna transakcja na dbSystem: płatności pending → failed, potem wizyty", async () => {
    sys.selectWhere.mockResolvedValue([
      { paymentId: "p1", paymentStatus: "pending", appointmentId: "a1" },
      { paymentId: "p2", paymentStatus: "failed", appointmentId: "a2" },
      { paymentId: "p3", paymentStatus: "failed", appointmentId: "a2" },
    ]);
    const cleanup = await loadCleanup();
    await expect(cleanup()).resolves.toEqual({ cancelledAppointments: 2, failedPayments: 1 });
    expect(sys.transaction).toHaveBeenCalledTimes(1);
    expect(sys.txUpdate).toHaveBeenCalledTimes(2);
    expect(sys.txUpdateSet.mock.calls[0]![0]).toEqual({ status: "failed" });
    expect(sys.txUpdateSet.mock.calls[1]![0]).toMatchObject({ status: "cancelled" });
  });

  it("same płatności failed → bez aktualizacji płatności, tylko wizyty", async () => {
    sys.selectWhere.mockResolvedValue([{ paymentId: "p2", paymentStatus: "failed", appointmentId: "a2" }]);
    const cleanup = await loadCleanup();
    await expect(cleanup()).resolves.toEqual({ cancelledAppointments: 1, failedPayments: 0 });
    expect(sys.txUpdate).toHaveBeenCalledTimes(1);
    expect(sys.txUpdateSet.mock.calls[0]![0]).toMatchObject({ status: "cancelled" });
  });
});

describe("trasa /api/cron/cleanup-pending-deposits woła wyjście z rejestru (P5a)", () => {
  it.each(["GET", "POST"] as const)("%s z sekretem → 200 z licznikami z rejestru, bez puli żądań", async (method) => {
    registry.cleanupStaleDepositBookings.mockResolvedValue({ cancelledAppointments: 2, failedPayments: 1 });
    const handler = method === "GET" ? GET : POST;
    const { status, body: data } = await parseResponse(await handler(cronRequest(method)));
    expect(status).toBe(200);
    expect(data).toMatchObject({ success: true, cancelledAppointments: 2, failedPayments: 1 });
    expect(registry.cleanupStaleDepositBookings).toHaveBeenCalledTimes(1);
  });

  it("zero martwych → 200 z dotychczasowym komunikatem", async () => {
    registry.cleanupStaleDepositBookings.mockResolvedValue({ cancelledAppointments: 0, failedPayments: 0 });
    const { status, body: data } = await parseResponse(await POST(cronRequest("POST")));
    expect(status).toBe(200);
    expect(data).toMatchObject({ success: true, cancelledAppointments: 0, failedPayments: 0 });
  });

  it("błąd wyjścia systemowego → 500 z dotychczasowym komunikatem", async () => {
    registry.cleanupStaleDepositBookings.mockRejectedValue(new Error("boom"));
    const { status, body: data } = await parseResponse(await POST(cronRequest("POST")));
    expect(status).toBe(500);
    expect(data).toMatchObject({ success: false, error: "Nie udalo sie wyczyscic nieoplaconych zadatkow" });
    expect(registry.cleanupStaleDepositBookings).toHaveBeenCalledTimes(1);
  });

  it("bez CRON_SECRET → 500 przed wyjściem systemowym (fail-closed bez zmian)", async () => {
    delete process.env.CRON_SECRET;
    const { status } = await parseResponse(await POST(cronRequest("POST")));
    expect(status).toBe(500);
    expect(registry.cleanupStaleDepositBookings).not.toHaveBeenCalled();
  });

  it("zły token → 401 przed wyjściem systemowym", async () => {
    const { status } = await parseResponse(await POST(cronRequest("POST", "zly")));
    expect(status).toBe(401);
    expect(registry.cleanupStaleDepositBookings).not.toHaveBeenCalled();
  });
});
