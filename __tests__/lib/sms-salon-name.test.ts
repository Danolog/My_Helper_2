/**
 * Nazwa salonu w treści SMS (tekst właściciela): jedna funkcja
 * `salonNameForSms` z src/lib/sms.ts, użyta we wszystkich trzech szablonach
 * z nazwą salonu (przypomnienie, potwierdzenie rezerwacji, potwierdzenie
 * zadatku). Reguły, w tej kolejności:
 *   1. znaki sterujące i nowe linie → spacja,
 *   2. NFKD, bez znaków łączących, ł→l, Ł→L,
 *   3. tylko podstawowa tabela GSM-7 (bez tabeli rozszerzeń),
 *   4. zwinięte spacje + trim,
 *   5. limit 40 znaków: dłuższa nazwa = 37 znaków (bez spacji na końcu) + "...".
 * Nazwa wyglądająca na adres („://”, „www.”, kropka + domena) jest pomijana
 * w całości. Pusty wynik = szablon bez fragmentu „w <salon>”.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// #193 P5a-1: biblioteka zapisuje przez forSalon(salonId).raw — brama deleguje
// do zmockowanego `db`, więc asercje na zapisie zostają bez zmian.
vi.mock("@/lib/server/repository", async () => {
  const { db } = await import("@/lib/db");
  return {
    forSalon: (salonId: string) => ({ salonId, raw: (fn: (tx: unknown) => unknown) => fn(db) }),
  };
});

const { mockDbValues } = vi.hoisted(() => {
  const returning = vi.fn().mockResolvedValue([{ id: "notif-1" }]);
  const mockDbValues = vi.fn().mockReturnValue({ returning });
  return { mockDbValues };
});

vi.mock("@/lib/db", () => ({
  db: { insert: () => ({ values: mockDbValues }) },
}));

vi.mock("@/lib/schema", () => ({ notifications: "notifications_table" }));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as sms from "@/lib/sms";

/** Podstawowa tabela GSM 03.38 bez znaków sterujących (LF, CR, ESC). */
const GSM7_BASIC =
  "@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const isGsm7Basic = (s: string) => [...s].every((c) => GSM7_BASIC.includes(c));

const PHONE = "+48512345678";
const SALON_ID = "11111111-2222-4333-8444-555555555555";
/** Wtorek, styczeń — data bez polskich znaków w nazwie dnia i miesiąca. */
const DATE = new Date("2030-01-15T14:00:00");

type Template = {
  send: (salonName: string | null) => Promise<sms.SmsResult>;
  /** Fragment z nazwą salonu. */
  withName: (name: string) => string;
  /** Ten sam fragment bez „w <salon>”. */
  without: string;
};

const BASE = {
  clientPhone: PHONE,
  clientName: "Jan Kowalski",
  serviceName: "Strzyzenie",
  employeeName: "Anna Nowak",
  appointmentDate: DATE,
  salonId: SALON_ID,
  clientId: "client-1",
};

const TEMPLATES: Record<string, Template> = {
  sendAppointmentReminderSms: {
    send: (salonName) => sms.sendAppointmentReminderSms({ ...BASE, salonName: salonName ?? "" }),
    withName: (n) => `u Anna Nowak w ${n} juz dzisiaj o `,
    without: "u Anna Nowak juz dzisiaj o ",
  },
  sendBookingConfirmationSms: {
    send: (salonName) => sms.sendBookingConfirmationSms({ ...BASE, salonName: salonName ?? "" }),
    withName: (n) => `u Anna Nowak w ${n} zostala umowiona na `,
    without: "u Anna Nowak zostala umowiona na ",
  },
  sendPaymentConfirmationSms: {
    send: (salonName) =>
      sms.sendPaymentConfirmationSms({ ...BASE, amount: 50, currency: "PLN", salonName }),
    withName: (n) => `u Anna Nowak w ${n} dnia `,
    without: "u Anna Nowak dnia ",
  },
};
const NAMES = Object.keys(TEMPLATES).map((n) => [n]);

const mockFetch = vi.fn();

/** Treść wysłana do dostawcy (pole `message` w treści żądania SMSAPI). */
function sentMessage(): string {
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const init = mockFetch.mock.calls[0]![1] as { body: string };
  return new URLSearchParams(init.body).get("message") ?? "";
}

async function messageFor(template: string, salonName: string | null): Promise<string> {
  const result = await TEMPLATES[template]!.send(salonName);
  expect(result.success).toBe(true);
  return sentMessage();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SMSAPI_TOKEN", "test-token");
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ count: 1, list: [{ id: "msg-1" }] }),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const LONG_41 = "Salon " + "x".repeat(35); // 41 znaków
const EXACT_40 = "Salon " + "y".repeat(34); // 40 znaków
const SPACE_AT_37 = "A".repeat(36) + " " + "B".repeat(10); // 47 znaków, 37. znak to spacja

describe("salonNameForSms", () => {
  it.each([
    ["nowa linia i znak sterujący", "Salon\nUroda\u0007Ania\tStyl\r", "Salon Uroda Ania Styl"],
    ["polskie znaki", "Zakład Fryzjerski Łucja Żółć Ęą Śń", "Zaklad Fryzjerski Lucja Zolc Ea Sn"],
    ["emoji", "Salon Uroda 💇‍♀️✨", "Salon Uroda"],
    ["zwinięte spacje", "  Salon    Uroda  ", "Salon Uroda"],
    ["dokładnie 40 znaków", EXACT_40, EXACT_40],
    ["41 znaków", LONG_41, LONG_41.slice(0, 37) + "..."],
    ["spacja na 37. pozycji", SPACE_AT_37, "A".repeat(36) + "..."],
  ])("%s", (_label, input, expected) => {
    expect(sms.salonNameForSms(input)).toBe(expected);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["pusty napis", ""],
    ["same spacje i znaki sterujące", " \n\t\u0007 "],
    ["wyłącznie spoza GSM-7", "💇‍♀️✨ 日本語"],
    ["https://", "Salon https://uroda.example"],
    ["://", "salon://uroda"],
    ["www.", "Salon www.uroda"],
    ["WWW. wielkimi", "WWW.Uroda"],
    [".pl", "Uroda.pl"],
    [".com", "Salon salon-uroda.com"],
    [".pl po normalizacji (kropka pełnej szerokości)", "Uroda．pl"],
  ])("%s → pusty wynik", (_label, input) => {
    expect(sms.salonNameForSms(input)).toBe("");
  });

  it("obcięcie kończy się trzema kropkami ASCII, nie znakiem „…”", () => {
    const out = sms.salonNameForSms(LONG_41);
    expect(out.endsWith("...")).toBe(true);
    expect(out).not.toContain("…");
    expect(out).toHaveLength(40);
  });

  it("zwykłe kropki w nazwie (skrót ze spacją) nie są adresem", () => {
    expect(sms.salonNameForSms("Salon Sp. z o.o. Uroda")).toBe("Salon Sp. z o.o. Uroda");
  });
});

describe("nazwa salonu w każdym z trzech szablonów", () => {
  it.each(NAMES)("%s: nowa linia i znak sterujący → spacja", async (t) => {
    const message = await messageFor(t, "Salon\nUroda\u0007Ania");
    expect(message).toContain(TEMPLATES[t]!.withName("Salon Uroda Ania"));
    expect(message).not.toMatch(/[\u0000-\u001f\u007f]/);
  });

  it.each(
    NAMES.flatMap(([t]) =>
      ["https://uroda.example", "Salon www.uroda", "Uroda.pl", "salon-uroda.com"].map((n) => [t!, n])
    )
  )("%s: nazwa jak adres (%s) pominięta w całości", async (t, name) => {
    const message = await messageFor(t, name);
    expect(message).toContain(TEMPLATES[t]!.without);
    expect(message).not.toMatch(/:\/\/|www\.|\.pl\b|\.com\b|uroda/i);
    expect(message).not.toMatch(/ {2}/);
  });

  it.each(NAMES)("%s: nazwa 41 znaków → 37 + \"...\"", async (t) => {
    const message = await messageFor(t, LONG_41);
    expect(message).toContain(TEMPLATES[t]!.withName(LONG_41.slice(0, 37) + "..."));
    expect(message).not.toContain(LONG_41);
  });

  it.each(NAMES)("%s: nazwa dokładnie 40 znaków bez zmian", async (t) => {
    const message = await messageFor(t, EXACT_40);
    expect(message).toContain(TEMPLATES[t]!.withName(EXACT_40));
  });

  it.each(NAMES)("%s: polskie znaki → odpowiedniki bez znaków diakrytycznych", async (t) => {
    const message = await messageFor(t, "Zakład Łucja Żółć");
    expect(message).toContain(TEMPLATES[t]!.withName("Zaklad Lucja Zolc"));
  });

  it.each(NAMES)("%s: emoji usunięte", async (t) => {
    const message = await messageFor(t, "Salon Uroda 💇‍♀️✨");
    expect(message).toContain(TEMPLATES[t]!.withName("Salon Uroda"));
  });

  it.each(NAMES)("%s: nazwa wyłącznie spoza GSM-7 → zdanie bez nazwy", async (t) => {
    const message = await messageFor(t, "💇‍♀️✨ 日本語");
    expect(message).toContain(TEMPLATES[t]!.without);
    expect(message).not.toMatch(/ {2}/);
  });

  // Sprawdza, że nazwa salonu po przygotowaniu nie wprowadza do treści znaków
  // spoza podstawowej tabeli GSM-7 — przy dacie i pozostałych polach bez
  // takich znaków (DATE, BASE). NIE gwarantuje, że każda treść SMS jest
  // w GSM-7: polskie daty i pozostałe pola obejmuje #231.
  it.each(NAMES)("%s: nazwa salonu (także na granicy limitu) nie wprowadza znaków spoza podstawowego GSM-7, treść ≤ 306 znaków", async (t) => {
    for (const name of [EXACT_40, LONG_41, "Zakład Łucja Żółć 💇‍♀️"]) {
      mockFetch.mockClear();
      const message = await messageFor(t, name);
      expect(isGsm7Basic(message), message).toBe(true);
      expect(message.length).toBeLessThanOrEqual(306);
    }
  });
});

describe("wszystkie trzy szablony wołają salonNameForSms", () => {
  const source = readFileSync(path.join(process.cwd(), "src/lib/sms.ts"), "utf8");

  it.each(NAMES)("%s", (t) => {
    const start = source.indexOf(`export async function ${t}(`);
    expect(start, t).toBeGreaterThanOrEqual(0);
    const next = source.indexOf("\nexport ", start + 1);
    const body = source.slice(start, next === -1 ? undefined : next);
    expect(body).toMatch(/salonNameForSms\(\s*params\.salonName\s*\)/);
  });
});
