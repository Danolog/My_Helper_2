/**
 * notifyDepositMarkedPaid (src/lib/deposit-marked-sms.ts) — SMS do klienta po
 * ręcznym oznaczeniu zadatku jako wpłaconego.
 *
 * Atrapa `forSalon(salonId).raw(fn)` woła `fn(tx)` na łańcuchu, który zapisuje
 * kolumny `select`, warunki `leftJoin`/`innerJoin`/`where` i zwraca sterowane
 * wiersze albo rzuca. Warunki renderujemy dialektem Postgresa (jawne
 * `eq(salonId)`). `@/lib/sms` częściowo: podmieniony tylko `sendDepositMarkedSms`,
 * prawdziwe `smsFailureReason` i stałe błędów. Meta każdego logu przez `toEqual`.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { notifyDepositMarkedPaid } from "@/lib/deposit-marked-sms";
import { SMS_PROVIDER_UNAVAILABLE_ERROR, SMS_SEND_FAILED_ERROR, SMS_TEST_PHONE_ERROR } from "@/lib/sms";
import type { SQL } from "drizzle-orm";

const h = vi.hoisted(() => {
  const state: { rows: unknown[]; confirmations: unknown[]; readError: Error | null } = {
    rows: [],
    confirmations: [],
    readError: null,
  };
  const selectColumns: Record<string, unknown>[] = [];
  const joins: { kind: "left" | "inner"; on: unknown }[] = [];
  const wheres: unknown[] = [];
  const limits: number[] = [];
  const forSalon = vi.fn((salonId: string) => {
    void salonId;
    return {
      raw: (fn: (tx: unknown) => unknown) => {
        // Pierwszy `limit` w danym `raw` = odczyt szczegółów, drugi = wpisy dziennika.
        let limitCalls = 0;
        const chain = {
          from: () => chain,
          leftJoin: (_t: unknown, on: unknown) => {
            joins.push({ kind: "left", on });
            return chain;
          },
          innerJoin: (_t: unknown, on: unknown) => {
            joins.push({ kind: "inner", on });
            return chain;
          },
          where: (w: unknown) => {
            wheres.push(w);
            return chain;
          },
          limit: (n: number) => {
            limits.push(n);
            limitCalls += 1;
            if (limitCalls === 1) {
              return state.readError ? Promise.reject(state.readError) : Promise.resolve(state.rows);
            }
            return Promise.resolve(state.confirmations);
          },
        };
        const tx = {
          select: (columns: Record<string, unknown>) => {
            selectColumns.push(columns);
            return chain;
          },
        };
        return fn(tx);
      },
    };
  });
  const sendDepositMarkedSms = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { state, selectColumns, joins, wheres, limits, forSalon, sendDepositMarkedSms, logger };
});

vi.mock("@/lib/server/repository", () => ({ forSalon: h.forSalon }));
vi.mock("@/lib/sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sms")>()),
  sendDepositMarkedSms: h.sendDepositMarkedSms,
}));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));

const dialect = new PgDialect();
const SALON = "22222222-2222-4222-8222-222222222222";
const APPT = "33333333-3333-4333-8333-333333333333";
const CLIENT = "44444444-4444-4444-8444-444444444444";
const START = new Date("2030-01-15T13:00:00Z");
const CLIENT_PHONE = "+48500600701";
const GUEST_PHONE = "+48500600702";

/** Wiersz odczytu szczegółów z kolumnami jak w `select` modułu. */
function row(over: Record<string, unknown> = {}) {
  return {
    clientId: CLIENT,
    clientPhone: CLIENT_PHONE,
    guestPhone: null,
    startTime: START,
    depositAmount: "50.00",
    depositPaid: true,
    salonName: "Salon A",
    ...over,
  };
}

function given(...rows: unknown[]) {
  h.state.rows = rows;
}

function run() {
  return notifyDepositMarkedPaid({ salonId: SALON, appointmentId: APPT });
}

function loggedText(): string {
  return JSON.stringify(
    [h.logger.info, h.logger.warn, h.logger.error, h.logger.debug].flatMap((fn) => fn.mock.calls)
  );
}

function rendered(sql: unknown) {
  return dialect.sqlToQuery(sql as SQL);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.rows = [];
  h.state.readError = null;
  // Jeden wpis = bieżące oznaczenie (pierwsze potwierdzenie tej wizyty).
  h.state.confirmations = [{ id: "ev-current" }];
  h.selectColumns.length = 0;
  h.joins.length = 0;
  h.wheres.length = 0;
  h.limits.length = 0;
  h.sendDepositMarkedSms.mockReset();
  h.sendDepositMarkedSms.mockResolvedValue({ success: true, notificationId: "notif-1" });
});

describe("wysyłka", () => {
  it("klient z telefonem → SMS raz z kwotą, terminem, salonem i clientId; bez logów", async () => {
    given(row());

    await run();

    expect(h.sendDepositMarkedSms).toHaveBeenCalledTimes(1);
    expect(h.sendDepositMarkedSms.mock.calls[0]![0]).toEqual({
      clientPhone: CLIENT_PHONE,
      amount: 50,
      appointmentDate: START,
      salonName: "Salon A",
      salonId: SALON,
      clientId: CLIENT,
    });
    expect(h.logger.warn).not.toHaveBeenCalled();
    expect(h.logger.info).not.toHaveBeenCalled();
    expect(h.limits).toEqual([1, 2]);
  });

  it("gość (bez clientId i telefonu klienta) → numer gościa, bez klucza clientId", async () => {
    given(row({ clientId: null, clientPhone: null, guestPhone: GUEST_PHONE }));

    await run();

    expect(h.sendDepositMarkedSms).toHaveBeenCalledTimes(1);
    const params = h.sendDepositMarkedSms.mock.calls[0]![0] as Record<string, unknown>;
    expect(params).toEqual({
      clientPhone: GUEST_PHONE,
      amount: 50,
      appointmentDate: START,
      salonName: "Salon A",
      salonId: SALON,
    });
    expect("clientId" in params).toBe(false);
  });

  it("klient z kartoteki bez telefonu + telefon gościa → numer gościa (reguła #377)", async () => {
    given(row({ clientPhone: null, guestPhone: GUEST_PHONE }));

    await run();

    expect(h.sendDepositMarkedSms).toHaveBeenCalledTimes(1);
    expect(h.sendDepositMarkedSms.mock.calls[0]![0]).toEqual({
      clientPhone: GUEST_PHONE,
      amount: 50,
      appointmentDate: START,
      salonName: "Salon A",
      salonId: SALON,
      clientId: CLIENT,
    });
  });
});

describe("pominięcie: log info z powodem, bez wysyłki", () => {
  it("brak telefonu → no_phone", async () => {
    given(row({ clientPhone: null, guestPhone: null }));

    await run();

    expect(h.sendDepositMarkedSms).not.toHaveBeenCalled();
    expect(h.logger.info).toHaveBeenCalledTimes(1);
    expect(h.logger.info.mock.calls[0]![1]).toEqual({ appointmentId: APPT, reason: "no_phone" });
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it("brak wiersza → no_details", async () => {
    given();

    await run();

    expect(h.sendDepositMarkedSms).not.toHaveBeenCalled();
    expect(h.logger.info).toHaveBeenCalledTimes(1);
    expect(h.logger.info.mock.calls[0]![1]).toEqual({ appointmentId: APPT, reason: "no_details" });
  });

  it.each([false, null])("depositPaid=%s (równoległe cofnięcie po COMMIT) → not_paid", async (depositPaid) => {
    given(row({ depositPaid }));

    await run();

    expect(h.sendDepositMarkedSms).not.toHaveBeenCalled();
    expect(h.logger.info).toHaveBeenCalledTimes(1);
    expect(h.logger.info.mock.calls[0]![1]).toEqual({ appointmentId: APPT, reason: "not_paid" });
  });

  it.each([null, "0.00", "Infinity"])("depositAmount=%j → no_amount", async (depositAmount) => {
    given(row({ depositAmount }));

    await run();

    expect(h.sendDepositMarkedSms).not.toHaveBeenCalled();
    expect(h.logger.info).toHaveBeenCalledTimes(1);
    expect(h.logger.info.mock.calls[0]![1]).toEqual({ appointmentId: APPT, reason: "no_amount" });
  });
});

describe("najwyżej jeden SMS na wizytę (wpisy dziennika potwierdzające wpłatę)", () => {
  const TWO_CONFIRMATIONS = [{ id: "ev-1" }, { id: "ev-2" }];

  it("oznacz → cofnij → oznacz (drugi wpis manual_mark) → already_confirmed, bez wysyłki", async () => {
    given(row());
    h.state.confirmations = TWO_CONFIRMATIONS;

    await run();

    expect(h.sendDepositMarkedSms).not.toHaveBeenCalled();
    expect(h.logger.info).toHaveBeenCalledTimes(1);
    expect(h.logger.info.mock.calls[0]![1]).toEqual({ appointmentId: APPT, reason: "already_confirmed" });
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it("wcześniejsze stripe_confirmation + bieżące oznaczenie → already_confirmed, bez wysyłki", async () => {
    given(row());
    h.state.confirmations = TWO_CONFIRMATIONS;

    await run();

    expect(h.sendDepositMarkedSms).not.toHaveBeenCalled();
    expect(h.logger.info).toHaveBeenCalledTimes(1);
    expect(h.logger.info.mock.calls[0]![1]).toEqual({ appointmentId: APPT, reason: "already_confirmed" });
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it("kolejność: depositPaid=false przy 2 wpisach → not_paid (nie already_confirmed)", async () => {
    given(row({ depositPaid: false }));
    h.state.confirmations = TWO_CONFIRMATIONS;

    await run();

    expect(h.sendDepositMarkedSms).not.toHaveBeenCalled();
    expect(h.logger.info).toHaveBeenCalledTimes(1);
    expect(h.logger.info.mock.calls[0]![1]).toEqual({ appointmentId: APPT, reason: "not_paid" });
  });

  it("kolejność: brak telefonu przy 2 wpisach → already_confirmed (nie no_phone)", async () => {
    given(row({ clientPhone: null, guestPhone: null }));
    h.state.confirmations = TWO_CONFIRMATIONS;

    await run();

    expect(h.sendDepositMarkedSms).not.toHaveBeenCalled();
    expect(h.logger.info).toHaveBeenCalledTimes(1);
    expect(h.logger.info.mock.calls[0]![1]).toEqual({ appointmentId: APPT, reason: "already_confirmed" });
  });

  it("brak wpisów (anomalia dziennika) → SMS wysłany jak dotąd (próg > 1)", async () => {
    given(row());
    h.state.confirmations = [];

    await run();

    expect(h.sendDepositMarkedSms).toHaveBeenCalledTimes(1);
    expect(h.logger.info).not.toHaveBeenCalled();
    expect(h.logger.warn).not.toHaveBeenCalled();
  });
});

describe("nieudana wysyłka: warn z powodem z zamkniętej listy", () => {
  it.each([
    ["send_failed", { success: false, error: SMS_SEND_FAILED_ERROR }],
    ["provider_unavailable", { success: false, error: SMS_PROVIDER_UNAVAILABLE_ERROR }],
    ["test_phone", { success: false, skipped: "test_phone", error: SMS_TEST_PHONE_ERROR }],
    [
      "rejected",
      { success: false, error: "Invalid phone number: +48*****0701. Expected 9 digits or +48 followed by 9 digits." },
    ],
  ] as const)("%s", async (reason, result) => {
    given(row());
    h.sendDepositMarkedSms.mockResolvedValueOnce(result);

    await run();

    expect(h.logger.warn).toHaveBeenCalledTimes(1);
    expect(h.logger.warn.mock.calls[0]![1]).toEqual({ appointmentId: APPT, reason });
    expect(h.logger.info).not.toHaveBeenCalled();
    expect(loggedText()).not.toContain("0701");
  });

  it("wynik undefined (atrapa) → bez warn", async () => {
    given(row());
    h.sendDepositMarkedSms.mockResolvedValueOnce(undefined);

    await run();

    expect(h.logger.warn).not.toHaveBeenCalled();
  });
});

describe("błędy: funkcja nie rzuca, warn z samą tożsamością błędu", () => {
  it("odczyt rzuca → rozstrzyga się, warn failed, bez numeru w logach i bez wysyłki", async () => {
    h.state.readError = new Error("db params: +48500600701");

    await expect(run()).resolves.toBeUndefined();

    expect(h.logger.warn).toHaveBeenCalledTimes(1);
    expect(h.logger.warn.mock.calls[0]![1]).toEqual({ appointmentId: APPT, errorName: "Error" });
    expect(loggedText()).not.toContain("500600701");
    expect(h.sendDepositMarkedSms).not.toHaveBeenCalled();
    expect(h.limits).toEqual([1]);
  });

  it("sendDepositMarkedSms rzuca → rozstrzyga się, warn failed, bez numeru w logach", async () => {
    given(row());
    h.sendDepositMarkedSms.mockRejectedValueOnce(new Error("sms params: +48500600701"));

    await expect(run()).resolves.toBeUndefined();

    expect(h.logger.warn).toHaveBeenCalledTimes(1);
    expect(h.logger.warn.mock.calls[0]![1]).toEqual({ appointmentId: APPT, errorName: "Error" });
    expect(loggedText()).not.toContain("500600701");
  });
});

describe("zakres salonu i kolumny odczytu", () => {
  it("forSalon raz z salonem wejścia; where z jawnym eq(salonId); klient tylko z tego salonu", async () => {
    given(row());

    await run();

    expect(h.forSalon).toHaveBeenCalledTimes(1);
    expect(h.forSalon).toHaveBeenCalledWith(SALON);

    expect(h.selectColumns).toHaveLength(2);
    expect(Object.keys(h.selectColumns[1]!)).toEqual(["id"]);

    expect(h.wheres).toHaveLength(2);
    const where = rendered(h.wheres[0]);
    expect(where.sql).toBe('("appointments"."id" = $1 and "appointments"."salon_id" = $2)');
    expect(where.params).toEqual([APPT, SALON]);

    const events = rendered(h.wheres[1]);
    expect(events.sql).toBe(
      '("deposit_status_events"."appointment_id" = $1 and "deposit_status_events"."salon_id" = $2 and "deposit_status_events"."deposit_paid" = $3 and "deposit_status_events"."source" in ($4, $5))'
    );
    expect(events.params).toEqual([APPT, SALON, true, "manual_mark", "stripe_confirmation"]);

    const left = h.joins.filter((j) => j.kind === "left");
    expect(left).toHaveLength(1);
    expect(rendered(left[0]!.on).sql).toContain('"clients"."salon_id"');
    expect(rendered(left[0]!.on).params).toEqual([SALON]);
  });

  it("select z jawną listą kolumn — bez imion i e-maili", async () => {
    given(row());

    await run();

    expect(h.selectColumns).toHaveLength(2);
    expect(Object.keys(h.selectColumns[0]!).sort()).toEqual([
      "clientId",
      "clientPhone",
      "depositAmount",
      "depositPaid",
      "guestPhone",
      "salonName",
      "startTime",
    ]);
    expect(Object.keys(h.selectColumns[1]!)).toEqual(["id"]);
  });
});
