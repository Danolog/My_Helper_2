/**
 * Treść powiadomienia o zwolnionym terminie z listy oczekujących:
 * - `buildWaitingListSms` (src/lib/sms.ts) — SMS w podstawowym alfabecie GSM-7,
 * - `buildWaitingListPush` (src/lib/waiting-list-message.ts) — tytuł i treść push.
 *
 * Obie funkcje są czyste: bez wysyłki, bez odczytu bazy i zmiennych
 * środowiska. Data i godzina zawsze w strefie SMS_TIME_ZONE (Europe/Warsaw),
 * niezależnie od strefy procesu — test wymusza strefę procesu UTC
 * i sprawdza to strażnikiem (`assertProcessInUtc`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildWaitingListSms } from "@/lib/sms";
import { buildWaitingListPush } from "@/lib/waiting-list-message";

/** Podstawowa tabela GSM 03.38 bez znaków sterujących (LF, CR, ESC). */
const GSM7_BASIC =
  "@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const nonGsm7 = (s: string) => [...s].filter((c) => !GSM7_BASIC.includes(c));

const SUMMER = new Date("2026-07-15T08:30:00Z");

/** Strażnik: proces liczy w UTC, inaczej test sprawdzałby strefę maszyny. */
function assertProcessInUtc() {
  const d = new Date("2026-07-15T08:30:00Z");
  expect(d.getHours(), "proces nie jest w UTC — test przeszedłby na pusto").toBe(8);
  expect(d.getTimezoneOffset()).toBe(0);
}

beforeEach(() => {
  vi.stubEnv("TZ", "UTC");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * Chwile w UTC i oczekiwany tekst w Warszawie:
 * - lato (CEST, +2): 08:30 UTC → 10:30, 15 lipca,
 * - zima (CET, +1): 08:30 UTC → 09:30, 15 stycznia,
 * - 22:30 UTC 15 lipca → w Warszawie już 16 lipca, 00:30,
 * - wrzesień: nazwa miesiąca z polskim znakiem (SMS bez, push z).
 */
const TIME_CASES = [
  { label: "lato", at: "2026-07-15T08:30:00Z", smsDate: "15 lipca", pushDate: "15 lipca", time: "10:30" },
  { label: "zima", at: "2026-01-15T08:30:00Z", smsDate: "15 stycznia", pushDate: "15 stycznia", time: "09:30" },
  {
    label: "granica dnia",
    at: "2026-07-15T22:30:00Z",
    smsDate: "16 lipca",
    pushDate: "16 lipca",
    time: "00:30",
  },
  { label: "wrzesień", at: "2026-09-15T08:30:00Z", smsDate: "15 wrzesnia", pushDate: "15 września", time: "10:30" },
] as const;

describe("buildWaitingListSms", () => {
  it("pełna treść: salon, usługa, data, godzina i telefon salonu", () => {
    assertProcessInUtc();
    expect(
      buildWaitingListSms({
        salonName: "Salon Uroda",
        serviceName: "Strzyzenie",
        startTime: SUMMER,
        salonPhone: "+48 512 345 678",
      })
    ).toBe(
      'Zwolnil sie termin w Salon Uroda: "Strzyzenie" 15 lipca o 10:30. ' +
        "Aby go przyjac, zaloguj sie w aplikacji i otworz liste oczekujacych lub zadzwon: +48 512 345 678."
    );
  });

  it("minimalna treść: bez salonu, usługi i telefonu", () => {
    assertProcessInUtc();
    expect(buildWaitingListSms({ salonName: "", startTime: SUMMER })).toBe(
      "Zwolnil sie termin: 15 lipca o 10:30. " +
        "Aby go przyjac, zaloguj sie w aplikacji i otworz liste oczekujacych."
    );
  });

  it.each(TIME_CASES)("strefa Europe/Warsaw przy procesie w UTC: $label", (c) => {
    assertProcessInUtc();
    const message = buildWaitingListSms({ salonName: "Salon Uroda", startTime: new Date(c.at) });
    expect(message).toContain(`: ${c.smsDate} o ${c.time}. `);
  });

  it("brak usługi → bez fragmentu w cudzysłowie", () => {
    const message = buildWaitingListSms({ salonName: "Salon Uroda", startTime: SUMMER });
    expect(message).toContain("Zwolnil sie termin w Salon Uroda: 15 lipca o 10:30.");
    expect(message).not.toContain('"');
  });

  it.each([
    ["undefined", undefined],
    ["pusty napis", ""],
    ["same spacje", "   "],
  ])("brak telefonu salonu (%s) → bez fragmentu „lub zadzwon”", (_label, salonPhone) => {
    const message = buildWaitingListSms({ salonName: "Salon Uroda", startTime: SUMMER, salonPhone });
    expect(message).not.toContain("zadzwon");
    expect(message.endsWith("otworz liste oczekujacych.")).toBe(true);
  });

  it.each([
    ["pusta", ""],
    ["same spacje i znaki sterujące", " \n\t "],
    ["https://", "https://uroda.example"],
    ["www.", "Salon www.uroda"],
    [".pl", "Uroda.pl"],
  ])("nazwa salonu %s → bez fragmentu „w <salon>”", (_label, salonName) => {
    const message = buildWaitingListSms({ salonName, startTime: SUMMER });
    expect(message.startsWith("Zwolnil sie termin: 15 lipca o 10:30.")).toBe(true);
    expect(message).not.toMatch(/:\/\/|www\.|\.pl\b|uroda/i);
    expect(message).not.toMatch(/ {2}/);
  });

  it("nazwa salonu ponad 40 znaków → 37 znaków + \"...\" (jak salonNameForSms)", () => {
    const long = "Salon " + "x".repeat(35); // 41 znaków
    const message = buildWaitingListSms({ salonName: long, startTime: SUMMER });
    expect(message).toContain(`Zwolnil sie termin w ${long.slice(0, 37)}...: `);
    expect(message).not.toContain(long);
  });

  it("nazwa usługi wyglądająca na adres → bez fragmentu usługi", () => {
    const message = buildWaitingListSms({
      salonName: "Salon Uroda",
      serviceName: "Promocja https://uroda.example",
      startTime: SUMMER,
    });
    expect(message).toContain("Zwolnil sie termin w Salon Uroda: 15 lipca o 10:30.");
    expect(message).not.toMatch(/http|uroda\.example/i);
  });

  it("polskie znaki w nazwie salonu, usługi i w dacie → wyłącznie podstawowy GSM-7", () => {
    const message = buildWaitingListSms({
      salonName: "Zakład Łucja Żółć",
      serviceName: "Strzyżenie męskie — Łódź ✨",
      startTime: new Date("2026-09-15T08:30:00Z"),
      salonPhone: "+48 512 345 678",
    });
    expect(nonGsm7(message), message).toEqual([]);
    expect(message).toContain('w Zaklad Lucja Zolc: "Strzyzenie meskie Lodz" 15 wrzesnia o 10:30.');
  });

  it.each(TIME_CASES)("każda data ($label) w podstawowym GSM-7, bez „http”", (c) => {
    const message = buildWaitingListSms({
      salonName: "Salon Uroda",
      serviceName: "Strzyzenie",
      startTime: new Date(c.at),
      salonPhone: "+48 512 345 678",
    });
    expect(nonGsm7(message), message).toEqual([]);
    expect(message).not.toMatch(/http/i);
  });
});

describe("buildWaitingListPush", () => {
  it("pełna treść: tytuł i treść z salonem, usługą, datą i godziną", () => {
    assertProcessInUtc();
    expect(
      buildWaitingListPush({ salonName: "Salon Uroda", serviceName: "Strzyżenie", startTime: SUMMER })
    ).toEqual({
      title: "Zwolnił się termin",
      body: "Salon Uroda: Strzyżenie, 15 lipca o 10:30. Dotknij, aby przyjąć lub odrzucić.",
    });
  });

  it("bez usługi", () => {
    expect(buildWaitingListPush({ salonName: "Salon Uroda", startTime: SUMMER })).toEqual({
      title: "Zwolnił się termin",
      body: "Salon Uroda: 15 lipca o 10:30. Dotknij, aby przyjąć lub odrzucić.",
    });
  });

  it.each([
    ["pusta", ""],
    ["same spacje", "   "],
  ])("nazwa salonu %s → treść bez prefiksu salonu", (_label, salonName) => {
    expect(buildWaitingListPush({ salonName, serviceName: "Strzyżenie", startTime: SUMMER }).body).toBe(
      "Strzyżenie, 15 lipca o 10:30. Dotknij, aby przyjąć lub odrzucić."
    );
    expect(buildWaitingListPush({ salonName, startTime: SUMMER }).body).toBe(
      "15 lipca o 10:30. Dotknij, aby przyjąć lub odrzucić."
    );
  });

  it("nazwa salonu surowa: polskie znaki i długość bez zmian", () => {
    const long = "Zakład Fryzjerski Łucja " + "x".repeat(30);
    const { body } = buildWaitingListPush({ salonName: long, startTime: SUMMER });
    expect(body.startsWith(`${long}: 15 lipca o 10:30.`)).toBe(true);
  });

  it.each(TIME_CASES)("strefa Europe/Warsaw przy procesie w UTC: $label", (c) => {
    assertProcessInUtc();
    const { body } = buildWaitingListPush({ salonName: "Salon Uroda", startTime: new Date(c.at) });
    expect(body).toBe(`Salon Uroda: ${c.pushDate} o ${c.time}. Dotknij, aby przyjąć lub odrzucić.`);
  });

  it.each(TIME_CASES)("bez linku ($label)", (c) => {
    const result = buildWaitingListPush({
      salonName: "Salon Uroda",
      serviceName: "Strzyżenie",
      startTime: new Date(c.at),
    });
    expect(Object.keys(result).sort()).toEqual(["body", "title"]);
    expect(`${result.title} ${result.body}`).not.toMatch(/http|www\.|\//i);
  });
});

describe("parametry bez danych osobowych klienta i pracownika", () => {
  it("typ parametrów odrzuca imię klienta, telefon klienta, pracownika i link", () => {
    const base = { salonName: "Salon Uroda", startTime: SUMMER };
    // @ts-expect-error — brak pola clientName w parametrach
    buildWaitingListSms({ ...base, clientName: "Jan" });
    // @ts-expect-error — brak pola clientPhone w parametrach
    buildWaitingListSms({ ...base, clientPhone: "+48512345678" });
    // @ts-expect-error — brak pola employeeName w parametrach
    buildWaitingListPush({ ...base, employeeName: "Anna" });
    // @ts-expect-error — brak pola url w parametrach
    buildWaitingListPush({ ...base, url: "/client/waiting-list" });
    // @ts-expect-error — push nie przyjmuje telefonu salonu
    buildWaitingListPush({ ...base, salonPhone: "+48 512 345 678" });
  });
});
