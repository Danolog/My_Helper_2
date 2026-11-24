/**
 * #193 P5a-1: push.ts bez surowej puli żądań (decyzje z recenzji 3d i 3d-KOREKTA).
 *
 * - Subskrypcje użytkownika: `getPushSubscriptionsForUser(userId)` z rejestru
 *   `@/lib/server/system` (tylko kolumny potrzebne do wysyłki).
 * - Kasowanie: `deleteUndeliverablePushSubscriptions(userId, subscriptionIds)`
 *   — po id, zawsze zawężone do user_id; obejmuje wiersze spoza allowlisty
 *   (`isValidPushSubscription`) i odrzucone przez dostawcę 404/410. Wyjście nie
 *   ocenia wadliwości, decyduje wywołujący (push.ts). Pusta lista = no-op bez
 *   zapytania. Błąd kasowania jest logowany (tylko id) i nie przerywa wysyłki.
 * - Zapis notyfikacji: `forSalon(salonId).raw`.
 *
 * Moduł `system/notifications.ts` ładowany dynamicznie: brak modułu to
 * czerwień testów, nie błąd typecheck.
 */
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { pushSubscriptions } from "@/lib/schema";
import { VALID_AUTH, VALID_ENDPOINTS, VALID_P256DH } from "../fixtures/push-subscriptions";

const h = vi.hoisted(() => {
  const throwingPool = (name: string) =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return undefined;
          throw new Error(`${name} użyta wprost (${String(prop)})`);
        },
      }
    );
  return {
    throwingPool,
    send: { fn: null as unknown as (...a: unknown[]) => unknown },
    registry: {
      getPushSubscriptionsForUser: null as unknown as (...a: unknown[]) => unknown,
      deleteUndeliverablePushSubscriptions: null as unknown as (...a: unknown[]) => unknown,
    },
    gateway: { salonIds: [] as string[], inserted: [] as Array<Record<string, unknown>> },
    sys: {
      selectCols: [] as unknown[],
      selectWhere: [] as unknown[],
      selectRows: [] as unknown[],
      deleteWhere: [] as unknown[],
      deleteCalls: 0,
      selectCalls: 0,
    },
  };
});

vi.mock("@/lib/db", () => ({ db: h.throwingPool("pula żądań") }));

vi.mock("@/lib/server/system/db-system", () => ({
  dbSystem: {
    select: (cols: unknown) => {
      h.sys.selectCalls++;
      h.sys.selectCols.push(cols);
      return {
        from: () => ({
          where: (w: unknown) => {
            h.sys.selectWhere.push(w);
            return Promise.resolve(h.sys.selectRows);
          },
        }),
      };
    },
    delete: () => {
      h.sys.deleteCalls++;
      return {
        where: (w: unknown) => {
          h.sys.deleteWhere.push(w);
          return { returning: () => Promise.resolve([{ id: "x" }]) };
        },
      };
    },
  },
}));

vi.mock("@/lib/server/system", () => ({
  getPushSubscriptionsForUser: (...a: unknown[]) => h.registry.getPushSubscriptionsForUser(...a),
  deleteUndeliverablePushSubscriptions: (...a: unknown[]) => h.registry.deleteUndeliverablePushSubscriptions(...a),
}));

vi.mock("@/lib/server/repository", () => ({
  forSalon: (salonId: string) => ({
    salonId,
    raw: async (fn: (tx: unknown) => Promise<unknown>) => {
      h.gateway.salonIds.push(salonId);
      return fn({
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            h.gateway.inserted.push(v);
            return { returning: async () => [{ id: "notif-1" }], then: (r: (x: unknown) => unknown) => r(undefined) };
          },
        }),
      });
    },
  }),
}));

vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => h.send.fn(...a) },
}));

vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  return { ...actual, isModuleFrozen: (key: string) => (key === "pushNotifications" ? false : actual.isModuleFrozen(key as never)) };
});

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { sendPushNotification } from "@/lib/push";
import { logger } from "@/lib/logger";

const USER = "user-1";
const SALON = "aaaaaaaa-0000-4000-8000-000000000001";
const MSG = { title: "T", body: "B", salonId: SALON, clientId: "c1" };

const good = (id: string, endpoint: string = VALID_ENDPOINTS.chromeFcm) => ({
  id,
  endpoint,
  p256dh: VALID_P256DH,
  auth: VALID_AUTH,
});
const BAD_ENDPOINT = "https://evil.example/push/abc";

type AnyFn = (...a: unknown[]) => unknown;
let getSubs: Mock<AnyFn>;
let delSubs: Mock<AnyFn>;
let send: Mock<AnyFn>;

beforeEach(() => {
  vi.clearAllMocks();
  getSubs = vi.fn<AnyFn>();
  delSubs = vi.fn<AnyFn>().mockResolvedValue(0);
  send = vi.fn<AnyFn>().mockResolvedValue({ statusCode: 201 });
  h.registry.getPushSubscriptionsForUser = getSubs;
  h.registry.deleteUndeliverablePushSubscriptions = delSubs;
  h.send.fn = send;
  h.gateway.salonIds = [];
  h.gateway.inserted = [];
  h.sys.selectCols = [];
  h.sys.selectWhere = [];
  h.sys.selectRows = [];
  h.sys.deleteWhere = [];
  h.sys.deleteCalls = 0;
  h.sys.selectCalls = 0;
});

function logsText(): string {
  return JSON.stringify(
    (["debug", "info", "warn", "error"] as const).map((l) => vi.mocked(logger[l]).mock.calls)
  );
}

describe("push.ts: subskrypcje przez wyjścia rejestru, zapis przez bramę salonu", () => {
  it("wysyłka: odczyt getPushSubscriptionsForUser(userId), bez kasowania, zapis 'sent' przez forSalon", async () => {
    getSubs.mockResolvedValue([good("s1"), good("s2", VALID_ENDPOINTS.firefox)]);
    const r = await sendPushNotification(USER, MSG);
    expect(r).toMatchObject({ success: true, sent: 2, failed: 0, notificationId: "notif-1" });
    expect(getSubs).toHaveBeenCalledWith(USER);
    expect(delSubs).not.toHaveBeenCalled();
    expect(h.gateway.salonIds).toEqual([SALON]);
    expect(h.gateway.inserted).toEqual([expect.objectContaining({ salonId: SALON, type: "push", status: "sent" })]);
  });

  it("wiersz spoza allowlisty → kasowany po id użytkownika (przed wysyłką), poprawny wysłany", async () => {
    getSubs.mockResolvedValue([{ ...good("bad"), endpoint: BAD_ENDPOINT }, good("ok")]);
    const r = await sendPushNotification(USER, MSG);
    expect(r).toMatchObject({ success: true, sent: 1, failed: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(delSubs.mock.calls).toEqual([[USER, ["bad"]]]);
  });

  it("odrzucone 404 i 410 → kasowane po id użytkownika; 500 zostaje", async () => {
    getSubs.mockResolvedValue([good("s404"), good("s410"), good("s500"), good("ok")]);
    send.mockImplementation(async (sub: unknown) => {
      const n = send.mock.calls.length;
      if (n === 1) throw Object.assign(new Error("gone"), { statusCode: 404 });
      if (n === 2) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (n === 3) throw Object.assign(new Error("err"), { statusCode: 500 });
      return { statusCode: 201, sub };
    });
    const r = await sendPushNotification(USER, MSG);
    expect(r).toMatchObject({ sent: 1, failed: 3 });
    const deleted = delSubs.mock.calls.flatMap((c) => {
      expect(c[0]).toBe(USER);
      return c[1] as string[];
    });
    expect(deleted.sort()).toEqual(["s404", "s410"]);
  });

  it("błąd kasowania → zalogowany (tylko id), wysyłka do pozostałych idzie dalej", async () => {
    getSubs.mockResolvedValue([{ ...good("bad"), endpoint: BAD_ENDPOINT }, good("ok")]);
    delSubs.mockRejectedValue(new Error("delete failed"));
    const r = await sendPushNotification(USER, MSG);
    expect(send).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ success: true, sent: 1 });
    expect(vi.mocked(logger.error).mock.calls.some(([, ctx]) => JSON.stringify(ctx).includes("bad"))).toBe(true);
  });

  it("logi bez endpointu i kluczy (tylko subscriptionId)", async () => {
    getSubs.mockResolvedValue([{ ...good("bad"), endpoint: BAD_ENDPOINT }, good("s410")]);
    send.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    delSubs.mockRejectedValue(new Error("delete failed"));
    await sendPushNotification(USER, MSG);
    const logs = logsText();
    expect(logs).toContain("bad");
    expect(logs).toContain("s410");
    expect(logs).not.toContain(BAD_ENDPOINT);
    expect(logs).not.toContain(VALID_ENDPOINTS.chromeFcm);
    expect(logs).not.toContain(VALID_P256DH);
    expect(logs).not.toContain(VALID_AUTH);
  });

  it("bez subskrypcji → NO_SUBSCRIPTIONS, bez kasowania i bez zapisu", async () => {
    getSubs.mockResolvedValue([]);
    const r = await sendPushNotification(USER, MSG);
    expect(r.success).toBe(false);
    expect(delSubs).not.toHaveBeenCalled();
    expect(h.gateway.salonIds).toEqual([]);
  });

  it("salonId null → wysyłka bez zapisu i bez bramy", async () => {
    getSubs.mockResolvedValue([good("ok")]);
    const r = await sendPushNotification(USER, { ...MSG, salonId: null });
    expect(r).toMatchObject({ success: true, sent: 1 });
    expect(h.gateway.salonIds).toEqual([]);
  });

  it("błąd odczytu subskrypcji → zapis 'failed' przez bramę salonu", async () => {
    getSubs.mockRejectedValue(new Error("boom"));
    const r = await sendPushNotification(USER, MSG);
    expect(r.success).toBe(false);
    expect(h.gateway.inserted).toEqual([expect.objectContaining({ salonId: SALON, type: "push", status: "failed" })]);
  });
});

const MODULE = path.resolve(__dirname, "../../src/lib/server/system/notifications.ts");
type SysMod = {
  getPushSubscriptionsForUser: (userId: string) => Promise<unknown[]>;
  deleteUndeliverablePushSubscriptions: (userId: string, ids: string[]) => Promise<number>;
};
async function loadSys(): Promise<SysMod> {
  const mod = (await import(/* @vite-ignore */ MODULE)) as Record<string, unknown>;
  expect(typeof mod.getPushSubscriptionsForUser, "eksport getPushSubscriptionsForUser").toBe("function");
  expect(typeof mod.deleteUndeliverablePushSubscriptions, "eksport deleteUndeliverablePushSubscriptions").toBe("function");
  return mod as unknown as SysMod;
}

const dialect = new PgDialect();
const render = (w: unknown) => {
  const q = dialect.sqlToQuery(w as Parameters<PgDialect["sqlToQuery"]>[0]);
  return { sql: q.sql, params: q.params };
};

describe("system/notifications.ts: wyjścia subskrypcji push (pula systemowa)", () => {
  it("getPushSubscriptionsForUser: tylko id/endpoint/p256dh/auth, warunek user_id", async () => {
    h.sys.selectRows = [good("s1")];
    const sys = await loadSys();
    await expect(sys.getPushSubscriptionsForUser(USER)).resolves.toEqual([good("s1")]);
    expect(Object.keys(h.sys.selectCols[0] as object).sort()).toEqual(["auth", "endpoint", "id", "p256dh"]);
    expect(render(h.sys.selectWhere[0])).toEqual(render(eq(pushSubscriptions.userId, USER)));
  });

  it("deleteUndeliverablePushSubscriptions: pusta lista → no-op bez zapytania, 0", async () => {
    const sys = await loadSys();
    await expect(sys.deleteUndeliverablePushSubscriptions(USER, [])).resolves.toBe(0);
    expect(h.sys.deleteCalls).toBe(0);
  });

  it("deleteUndeliverablePushSubscriptions: WHERE user_id = $1 AND id IN (...)", async () => {
    const sys = await loadSys();
    await sys.deleteUndeliverablePushSubscriptions(USER, ["a", "b"]);
    expect(h.sys.deleteCalls).toBe(1);
    expect(render(h.sys.deleteWhere[0])).toEqual(
      render(and(eq(pushSubscriptions.userId, USER), inArray(pushSubscriptions.id, ["a", "b"])))
    );
  });
});
