/**
 * #193 P5a-1: biblioteki powiadomień (sms, email, notification-settings) bez
 * surowej puli żądań.
 *
 * Zapis do `notifications` i odczyt ustawień salonu idą przez
 * `forSalon(salonId).raw` WEWNĄTRZ biblioteki, z salonId wiadomości. Sygnatury
 * eksportów bez zmian. Bez salonId (e-mail auth) — żadnego zapisu i żadnej puli.
 *
 * Pule rozróżnione jawnie: `@/lib/db` i `@/lib/server/system/db-system` rzucają
 * przy każdym użyciu; `@/lib/server/repository` to fałszywa brama, która
 * zapamiętuje salonId i wartości zapisu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { gateway, throwingPool } = vi.hoisted(() => {
  const throwingPool = (name: string) =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return undefined;
          throw new Error(`${name} użyta wprost w bibliotece (${String(prop)})`);
        },
      }
    );

  const gateway = {
    salonIds: [] as string[],
    inserted: [] as Array<Record<string, unknown>>,
    selectRows: [] as unknown[],
    fail: false,
  };
  return { gateway, throwingPool };
});

vi.mock("@/lib/db", () => ({ db: throwingPool("pula żądań") }));
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: throwingPool("pula systemowa") }));

vi.mock("@/lib/server/repository", () => ({
  forSalon: (salonId: string) => {
    if (!salonId) throw new Error("repository.forSalon: salonId wymagany");
    return {
      salonId,
      raw: async (fn: (tx: unknown) => Promise<unknown>) => {
        gateway.salonIds.push(salonId);
        if (gateway.fail) throw new Error("brama salonu: błąd zapisu");
        const selectChain: Record<string, unknown> = {};
        for (const m of ["from", "where", "limit"]) selectChain[m] = () => selectChain;
        selectChain.then = (resolve: (rows: unknown[]) => unknown) => resolve(gateway.selectRows);
        const tx = {
          insert: () => ({
            values: (v: Record<string, unknown>) => {
              gateway.inserted.push(v);
              return { returning: async () => [{ id: `notif-${gateway.inserted.length}` }] };
            },
          }),
          select: () => selectChain,
        };
        return fn(tx);
      },
    };
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { sendEmail, sendPasswordResetEmail, sendVerificationEmail } from "@/lib/email";
import {
  DEFAULT_NOTIFICATION_TYPE_SETTINGS,
  getNotificationTypeSettings,
} from "@/lib/notification-settings";
import { sendSms } from "@/lib/sms";

const SALON_A = "aaaaaaaa-0000-4000-8000-000000000001";
const mockFetch = vi.fn();

beforeEach(() => {
  gateway.salonIds = [];
  gateway.inserted = [];
  gateway.selectRows = [];
  gateway.fail = false;
  vi.clearAllMocks();
  vi.stubEnv("SMSAPI_TOKEN", "");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sms.ts: zapis notyfikacji przez forSalon(salonId wiadomości)", () => {
  it("wysłany SMS → jeden zapis 'sent' przez bramę salonu wiadomości", async () => {
    const r = await sendSms({ to: "+48512345678", message: "treść", salonId: SALON_A, clientId: "c1" });
    expect(r).toMatchObject({ success: true, notificationId: "notif-1" });
    expect(gateway.salonIds).toEqual([SALON_A]);
    expect(gateway.inserted).toEqual([
      expect.objectContaining({ salonId: SALON_A, clientId: "c1", type: "sms", message: "treść", status: "sent" }),
    ]);
  });

  it("zły numer → zapis 'failed' przez bramę salonu wiadomości", async () => {
    const r = await sendSms({ to: "123", message: "treść", salonId: SALON_A });
    expect(r.success).toBe(false);
    expect(gateway.salonIds).toEqual([SALON_A]);
    expect(gateway.inserted).toEqual([expect.objectContaining({ salonId: SALON_A, type: "sms", status: "failed" })]);
  });

  it("błąd zapisu w bramie → wynik błędu jak dotąd, bez sięgania do puli", async () => {
    gateway.fail = true;
    const r = await sendSms({ to: "+48512345678", message: "treść", salonId: SALON_A });
    expect(r.success).toBe(false);
    expect(gateway.salonIds).toEqual([SALON_A, SALON_A]); // 'sent', potem best-effort 'failed'
  });
});

describe("email.ts: zapis tylko z salonId, przez forSalon(salonId wiadomości)", () => {
  it("z salonId → zapis 'sent' przez bramę salonu wiadomości", async () => {
    const r = await sendEmail({ to: "a@example.com", subject: "Temat", html: "<p>x</p>", salonId: SALON_A });
    expect(r).toMatchObject({ success: true, notificationId: "notif-1" });
    expect(gateway.salonIds).toEqual([SALON_A]);
    expect(gateway.inserted).toEqual([
      expect.objectContaining({ salonId: SALON_A, type: "email", message: "Temat", status: "sent" }),
    ]);
  });

  it("zły adres z salonId → zapis 'failed' przez bramę", async () => {
    const r = await sendEmail({ to: "zly", subject: "Temat", html: "x", salonId: SALON_A });
    expect(r.success).toBe(false);
    expect(gateway.inserted).toEqual([expect.objectContaining({ salonId: SALON_A, status: "failed" })]);
  });

  it("bez salonId → brak zapisu i brak bramy", async () => {
    const r = await sendEmail({ to: "a@example.com", subject: "Temat", html: "x" });
    expect(r.success).toBe(true);
    expect(gateway.salonIds).toEqual([]);
    expect(gateway.inserted).toEqual([]);
  });

  it("e-mail auth (weryfikacja, reset hasła) → żadnej puli i żadnego zapisu, także przy złym adresie", async () => {
    await expect(sendVerificationEmail({ to: "a@example.com", url: "https://x/v" })).resolves.toMatchObject({ success: true });
    await expect(sendPasswordResetEmail({ to: "a@example.com", url: "https://x/r" })).resolves.toMatchObject({ success: true });
    await expect(sendVerificationEmail({ to: "zly", url: "https://x/v" })).resolves.toMatchObject({ success: false });
    await expect(sendPasswordResetEmail({ to: "zly", url: "https://x/r" })).resolves.toMatchObject({ success: false });
    expect(gateway.salonIds).toEqual([]);
    expect(gateway.inserted).toEqual([]);
  });
});

describe("notification-settings.ts: odczyt ustawień przez forSalon(salonId)", () => {
  it("ustawienia salonu nadpisują domyślne; odczyt przez bramę tego salonu", async () => {
    gateway.selectRows = [{ settingsJson: { notificationTypes: { smsReminders: false } } }];
    await expect(getNotificationTypeSettings(SALON_A)).resolves.toEqual({
      ...DEFAULT_NOTIFICATION_TYPE_SETTINGS,
      smsReminders: false,
    });
    expect(gateway.salonIds).toEqual([SALON_A]);
  });

  it("brak salonu → domyślne", async () => {
    await expect(getNotificationTypeSettings(SALON_A)).resolves.toEqual(DEFAULT_NOTIFICATION_TYPE_SETTINGS);
    expect(gateway.salonIds).toEqual([SALON_A]);
  });

  it("błąd bramy → domyślne (nie blokuje powiadomień, jak dotąd)", async () => {
    gateway.fail = true;
    await expect(getNotificationTypeSettings(SALON_A)).resolves.toEqual(DEFAULT_NOTIFICATION_TYPE_SETTINGS);
    expect(gateway.salonIds).toEqual([SALON_A]);
  });
});
