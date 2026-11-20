/**
 * Szablony SMS transakcyjnych z src/lib/sms.ts: treść przekazana dostawcy
 * zawiera wyłącznie informację o wizycie / płatności — bez adresu URL i bez
 * wezwania do rezerwacji, także przy wrogiej nazwie salonu. Imię klienta
 * z adresem, cyfrą albo ponad limit jest pomijane (treść bez powitania), a nazwa
 * usługi i pracownika wyglądająca na adres — opuszczana; treść zostaje
 * gramatyczna przy pustych polach.
 *
 * Lista szablonów jest zamknięta względem eksportów sms.ts: każdy eksport
 * `send…Sms` (poza ogólnym `sendSms`) musi mieć wpis w TEMPLATES, inaczej
 * test jest czerwony — nowy szablon z linkiem nie przejdzie bez przeglądu.
 */
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
import { TEST_PHONE_NUMBERS } from "@/lib/test-phone";

const APP_URL = "https://aplikacja-salonu.example";
const SALON_ID = "11111111-2222-4333-8444-555555555555";
const PHONE = "+48512345678";
const DATE = new Date("2030-01-15T14:00:00");

/**
 * Nazwy salonu (tekst właściciela) podawane do każdego szablonu: zwykła
 * oraz wrogie — z nową linią, znakiem sterującym, adresem, emoji, ponad limit.
 */
const SALON_NAMES: readonly string[] = [
  "Salon Uroda",
  "Salon\nUroda\u0007 https://aplikacja-salonu.example/book",
  "Salon www.uroda-ania.pl",
  "Uroda.com",
  "Salon 💇‍♀️ Uroda " + "x".repeat(60),
];

/** Każdy eksportowany szablon SMS transakcyjnego z parametrami do wywołania. */
const TEMPLATES: Record<string, (mod: typeof sms, salonName: string) => Promise<sms.SmsResult>> = {
  sendAppointmentReminderSms: (mod, salonName) =>
    mod.sendAppointmentReminderSms({
      clientPhone: PHONE,
      clientName: "Jan Kowalski",
      serviceName: "Strzyzenie",
      employeeName: "Anna Nowak",
      appointmentDate: DATE,
      salonName,
      salonId: SALON_ID,
      clientId: "client-1",
    }),
  sendBookingConfirmationSms: (mod, salonName) =>
    mod.sendBookingConfirmationSms({
      clientPhone: PHONE,
      clientName: "Jan Kowalski",
      serviceName: "Strzyzenie",
      employeeName: "Anna Nowak",
      appointmentDate: DATE,
      salonName,
      salonId: SALON_ID,
      clientId: "client-1",
    }),
  sendPaymentConfirmationSms: (mod, salonName) =>
    mod.sendPaymentConfirmationSms({
      clientPhone: PHONE,
      clientName: "Jan Kowalski",
      amount: 50,
      currency: "PLN",
      serviceName: "Strzyzenie",
      appointmentDate: DATE,
      employeeName: "Anna Nowak",
      salonName,
      salonId: SALON_ID,
      clientId: "client-1",
    }),
  sendBlikDepositBookingSms: (mod, salonName) =>
    mod.sendBlikDepositBookingSms({
      clientPhone: PHONE,
      clientName: "Jan Kowalski",
      serviceName: "Strzyzenie",
      employeeName: "Anna Nowak",
      appointmentDate: DATE,
      salonName,
      salonId: SALON_ID,
      clientId: "client-1",
      blikPhone: TEST_PHONE_NUMBERS[3]!,
      amount: 50,
      title: "Zadatek MH-A1B2C3",
    }),
};

const mockFetch = vi.fn();

/** Treść wysłana do dostawcy (pole `message` w treści żądania SMSAPI). */
function sentMessage(): string {
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const init = mockFetch.mock.calls[0]![1] as { body: string };
  return new URLSearchParams(init.body).get("message") ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SMSAPI_TOKEN", "test-token");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
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

describe("szablony SMS transakcyjnych: lista zamknięta względem eksportów", () => {
  it("każdy eksport send…Sms (poza sendSms) ma wpis w teście i odwrotnie", () => {
    const exported = Object.entries(sms)
      .filter(([name, value]) => typeof value === "function" && /^send\w+Sms$/.test(name))
      .map(([name]) => name)
      .filter((name) => name !== "sendSms")
      .sort();

    expect(exported).toEqual(Object.keys(TEMPLATES).sort());
  });
});

describe("szablony SMS transakcyjnych: bez linku i bez wezwania do rezerwacji", () => {
  it.each(
    Object.keys(TEMPLATES).flatMap((name) => SALON_NAMES.map((salonName) => [name, salonName]))
  )(
    "%s: treść do dostawcy bez URL, adresu aplikacji, /book i „Zarezerwuj” (salon: %j)",
    async (name, salonName) => {
      const result = await TEMPLATES[name]!(sms, salonName!);
      expect(result.success).toBe(true);

      const message = sentMessage();
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/[\u0000-\u001f\u007f]/);
      expect(message).not.toMatch(/\.pl\b|\.com\b/i);
      expect(message).not.toMatch(/https?:\/\//i);
      expect(message).not.toMatch(/www\./i);
      expect(message).not.toContain(APP_URL);
      expect(message).not.toContain("aplikacja-salonu");
      expect(message).not.toContain("/book");
      expect(message).not.toContain(SALON_ID);
      expect(message).not.toMatch(/zarezerwuj/i);
    }
  );
});

describe("SMS rezerwacji z zadatkiem BLIK (buildBlikDepositBookingSms)", () => {
  /** Niezależna kopia podstawowej tabeli GSM 03.38 (bez LF, CR, ESC). */
  const GSM7 = new Set(
    "@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
      "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
  );
  const BLIK_PHONE = TEST_PHONE_NUMBERS[3]!;
  const TITLE = "Zadatek MH-A1B2C3";

  const params = (patch: Partial<sms.BlikDepositBookingSmsParams> = {}): sms.BlikDepositBookingSmsParams => ({
    clientPhone: TEST_PHONE_NUMBERS[0]!,
    clientName: "Jan Testowy",
    serviceName: "Strzyżenie",
    employeeName: "Łucja Nowak",
    // 13:00 UTC = 14:00 w Warszawie (zima, UTC+1).
    appointmentDate: new Date("2030-01-15T13:00:00.000Z"),
    salonName: "Salon Uroda",
    salonId: SALON_ID,
    blikPhone: BLIK_PHONE,
    amount: 50,
    title: TITLE,
    ...patch,
  });

  /** Liczba części SMS GSM-7: do 160 znaków jedna, dłuższa po 153 na część. */
  const gsm7Parts = (text: string) => (text.length <= 160 ? 1 : Math.ceil(text.length / 153));

  it("pełna treść: numer, kwota z dwoma miejscami, tytuł, data w strefie Warszawy, salon", () => {
    const message = sms.buildBlikDepositBookingSms(params());
    expect(message).toBe(
      'Rezerwacja przyjeta: Jan Testowy, "Strzyzenie" u Lucja Nowak w Salon Uroda 15 stycznia o 14:00. ' +
        `Wplac zadatek 50.00 PLN BLIK-iem na telefon ${BLIK_PHONE}, tytul: ${TITLE}. Salon potwierdzi wplate.`
    );
    expect(gsm7Parts(message)).toBe(2);
  });

  it("godzina w strefie Warszawy także latem (UTC+2)", () => {
    const message = sms.buildBlikDepositBookingSms(params({ appointmentDate: new Date("2030-07-15T12:00:00.000Z") }));
    expect(message).toContain("15 lipca o 14:00.");
  });

  it.each([
    [49.5, "49.50 PLN"],
    [120, "120.00 PLN"],
    [33.333, "33.33 PLN"],
  ])("kwota %s → %s", (amount, text) => {
    expect(sms.buildBlikDepositBookingSms(params({ amount }))).toContain(`zadatek ${text} BLIK-iem`);
  });

  it.each([
    ["polskie znaki", params()],
    ["miesiąc z polskim znakiem (październik)", params({ appointmentDate: new Date("2030-10-15T12:00:00.000Z") })],
    ["teksty z nową linią i emoji", params({ clientName: "Zoś\nka 💅", serviceName: "Manicure ✨", employeeName: "Ćma\tŻak" })],
    ["wroga nazwa salonu", params({ salonName: "Salon 💇‍♀️ Uroda " + "x".repeat(60) })],
  ])("wyłącznie znaki GSM-7: %s", (_n, p) => {
    const message = sms.buildBlikDepositBookingSms(p);
    expect([...message].filter((c) => !GSM7.has(c))).toEqual([]);
    expect(message).toContain(BLIK_PHONE);
    expect(message).toContain(TITLE);
  });

  it.each([
    ["null", null],
    ["pusty napis", ""],
    ["adres", "Uroda.com"],
    ["adres w nazwie", "Salon www.uroda-ania.pl"],
  ])("nazwa salonu: %s → treść bez fragmentu salonu", (_n, salonName) => {
    const message = sms.buildBlikDepositBookingSms(params({ salonName }));
    expect(message).toContain('"Strzyzenie" u Lucja Nowak 15 stycznia o 14:00.');
    expect(message).not.toMatch(/ w /);
    expect(message).not.toMatch(/uroda/i);
  });

  it("nazwa usługi wyglądająca na adres → „wizyta”; numer, kwota i tytuł zostają", () => {
    const message = sms.buildBlikDepositBookingSms(params({ serviceName: "www.promo.pl" }));
    expect(message).toContain('"wizyta"');
    expect(message).toContain(`50.00 PLN BLIK-iem na telefon ${BLIK_PHONE}, tytul: ${TITLE}.`);
  });

  it("puste imię klienta → bez powitania", () => {
    expect(sms.buildBlikDepositBookingSms(params({ clientName: "" }))).toMatch(/^Rezerwacja przyjeta: "Strzyzenie"/);
  });

  /** Pełna treść bez powitania — imię pominięte, reszta bez zmian. */
  const WITHOUT_GREETING =
    'Rezerwacja przyjeta: "Strzyzenie" u Lucja Nowak w Salon Uroda 15 stycznia o 14:00. ' +
    `Wplac zadatek 50.00 PLN BLIK-iem na telefon ${BLIK_PHONE}, tytul: ${TITLE}. Salon potwierdzi wplate.`;

  it.each([
    ["www.", "Jan www.oplaty-salon.pl"],
    ["domena ze ścieżką", "x.pl/oplata"],
    ["https://", "https://oplata.example/zadatek"],
    ["domena dopiero po oczyszczeniu (znak zerowej szerokości)", "Jan oplata.​com"],
    ["adres numeryczny", "192.168.10.20"],
  ])("imię wyglądające na adres (%s) → bez powitania, reszta treści bez zmian", (_n, clientName) => {
    expect(sms.buildBlikDepositBookingSms(params({ clientName }))).toBe(WITHOUT_GREETING);
  });

  it.each([
    ["numer telefonu", "Jan 600123456"],
    ["numer konta", "Konto 12 3456"],
    ["jedna cyfra", "Jan2"],
    ["kod BLIK", "Kod BLIK 123 456"],
    ["cyfry pełnoszerokie (NFKD → ASCII)", "Jan ６００１２３４５６"],
    ["cyfry arabsko-indyjskie (usuwane przez GSM-7)", "Jan ٦٠٠١٢٣"],
    ["indeks górny (NFKD → cyfra)", "Jan²"],
  ])("imię z cyfrą (%s) → bez powitania, reszta treści bez zmian", (_n, clientName) => {
    expect(sms.buildBlikDepositBookingSms(params({ clientName }))).toBe(WITHOUT_GREETING);
  });

  it("imię z wstrzykniętym numerem → numer nie trafia do treści", () => {
    const PRIVATE_DIGITS = "799888777";
    const message = sms.buildBlikDepositBookingSms(
      params({ clientName: `Wplac na ${PRIVATE_DIGITS.replace(/(\d{3})(?=\d)/g, "$1 ")}` })
    );
    expect(message.replace(/\D/g, "")).not.toContain(PRIVATE_DIGITS);
    expect(message).not.toMatch(/Wplac na/);
  });

  it("imię dokładnie w limicie 30 znaków → zostaje; 31 znaków → pominięte w całości", () => {
    const atLimit = "Aleksandra Wisniewska-Kowalska";
    expect(atLimit).toHaveLength(30);
    expect(sms.buildBlikDepositBookingSms(params({ clientName: atLimit }))).toContain(
      `Rezerwacja przyjeta: ${atLimit}, "Strzyzenie"`
    );

    const overLimit = `${atLimit}a`;
    expect(sms.buildBlikDepositBookingSms(params({ clientName: overLimit }))).toBe(WITHOUT_GREETING);
  });

  it("limit liczony po oczyszczeniu: emoji i znaki sterujące nie wliczają się", () => {
    const message = sms.buildBlikDepositBookingSms(params({ clientName: `💅💅💅 Aleksandra Wisniewska-Kowalska\n` }));
    expect(message).toContain('Rezerwacja przyjeta: Aleksandra Wisniewska-Kowalska, "Strzyzenie"');
  });

  it.each([
    ["Zofia Wójcik-Łęcka", "Zofia Wojcik-Lecka"],
    ["Józef Żółć", "Jozef Zolc"],
    ["  Anna  ", "Anna"],
  ])("zwykłe imię %j → %j w powitaniu", (clientName, expected) => {
    expect(sms.buildBlikDepositBookingSms(params({ clientName }))).toContain(
      `Rezerwacja przyjeta: ${expected}, "Strzyzenie"`
    );
  });

  it("sendBlikDepositBookingSms wysyła treść z buildera przez sendSms (zapis w notifications, z clientId)", async () => {
    const p = params({ clientPhone: PHONE, clientId: "client-1" });
    const result = await sms.sendBlikDepositBookingSms(p);
    expect(result.success).toBe(true);
    expect(sentMessage()).toBe(sms.buildBlikDepositBookingSms(p));
    expect(mockDbValues).toHaveBeenCalledWith(
      expect.objectContaining({
        salonId: SALON_ID,
        clientId: "client-1",
        type: "sms",
        message: sms.buildBlikDepositBookingSms(p),
        status: "sent",
      })
    );
  });

  it("numer testowy klienta → bez wysyłki i bez zapisu", async () => {
    const result = await sms.sendBlikDepositBookingSms(params());
    expect(result).toMatchObject({ success: false, skipped: "test_phone" });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDbValues).not.toHaveBeenCalled();
  });

  it.each([
    ["www.", "Anna www.oplaty-salon.pl"],
    ["domena", "Anna.com"],
    ["https://", "https://oplata.example/zadatek"],
  ])("nazwa pracownika wyglądająca na adres (%s) → bez fragmentu „u …”", (_n, employeeName) => {
    const message = sms.buildBlikDepositBookingSms(params({ employeeName }));
    expect(message).toContain('Rezerwacja przyjeta: Jan Testowy, "Strzyzenie" w Salon Uroda 15 stycznia o 14:00.');
    expect(message).not.toMatch(/ u /);
    expect(message).toContain(`na telefon ${BLIK_PHONE}, tytul: ${TITLE}.`);
  });

  it("nazwa pracownika ponad limit → skrócona do 40 znaków z „...”", () => {
    const message = sms.buildBlikDepositBookingSms(params({ employeeName: "Anna " + "x".repeat(60) }));
    expect(message).toContain(` u Anna ${"x".repeat(32)}... w Salon Uroda`);
  });
});

/**
 * Trzy szablony z imieniem klienta, usługą i pracownikiem wysyłane przez
 * sendSms (przypomnienie, potwierdzenie rezerwacji, potwierdzenie płatności).
 */
describe("SMS przypomnienia i potwierdzeń: imię, usługa i pracownik przez filtry", () => {
  interface TemplateFields {
    clientName: string;
    serviceName: string;
    employeeName: string;
  }

  const BASE: TemplateFields = { clientName: "Jan Kowalski", serviceName: "Strzyzenie", employeeName: "Anna Nowak" };
  // 13:00 UTC = 14:00 w Warszawie (zima, UTC+1).
  const WARSAW_DATE = new Date("2030-01-15T13:00:00.000Z");

  /** Każdy szablon: wysyłka z podmienionymi polami oraz oczekiwany początek treści. */
  const SENDERS: Record<
    string,
    { send: (f: TemplateFields) => Promise<sms.SmsResult>; prefix: (greeting: string) => string; noName: string }
  > = {
    sendAppointmentReminderSms: {
      send: (f) =>
        sms.sendAppointmentReminderSms({
          clientPhone: PHONE,
          ...f,
          appointmentDate: WARSAW_DATE,
          salonName: "Salon Uroda",
          salonId: SALON_ID,
        }),
      prefix: (g) => `Przypomnienie: ${g}Twoja wizyta "Strzyzenie" u Anna Nowak w Salon Uroda juz dzisiaj o 14:00`,
      noName: "Przypomnienie: Twoja wizyta",
    },
    sendBookingConfirmationSms: {
      send: (f) =>
        sms.sendBookingConfirmationSms({
          clientPhone: PHONE,
          ...f,
          appointmentDate: WARSAW_DATE,
          salonName: "Salon Uroda",
          salonId: SALON_ID,
        }),
      prefix: (g) => `Potwierdzenie rezerwacji: ${g}Twoja wizyta "Strzyzenie" u Anna Nowak w Salon Uroda zostala umowiona na `,
      noName: "Potwierdzenie rezerwacji: Twoja wizyta",
    },
    sendPaymentConfirmationSms: {
      send: (f) =>
        sms.sendPaymentConfirmationSms({
          clientPhone: PHONE,
          ...f,
          amount: 50,
          currency: "PLN",
          appointmentDate: WARSAW_DATE,
          salonName: "Salon Uroda",
          salonId: SALON_ID,
        }),
      prefix: (g) => `Potwierdzenie platnosci: ${g}zadatek 50.00 PLN za usluge "Strzyzenie" u Anna Nowak w Salon Uroda dnia `,
      noName: "Potwierdzenie platnosci: zadatek 50.00 PLN",
    },
  };

  const NAMES = Object.keys(SENDERS);

  /** Treść wysłana przez dany szablon przy polach BASE z podmianą. */
  async function messageOf(name: string, patch: Partial<TemplateFields> = {}): Promise<string> {
    mockFetch.mockClear();
    const result = await SENDERS[name]!.send({ ...BASE, ...patch });
    expect(result.success).toBe(true);
    return sentMessage();
  }

  /** Niezależna kopia podstawowej tabeli GSM 03.38 (bez LF, CR, ESC). */
  const GSM7 = new Set(
    "@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
      "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
  );

  it.each(NAMES)("%s: zwykłe imię, usługa i pracownik → pełna treść jak dotąd", async (name) => {
    expect(await messageOf(name)).toMatch(new RegExp(`^${escapeRegExp(SENDERS[name]!.prefix("Jan Kowalski, "))}`));
  });

  it.each(NAMES)("%s: imię z polskimi znakami → po oczyszczeniu w powitaniu", async (name) => {
    expect(await messageOf(name, { clientName: "Józef Żółć" })).toMatch(
      new RegExp(`^${escapeRegExp(SENDERS[name]!.prefix("Jozef Zolc, "))}`)
    );
  });

  const HOSTILE_CLIENT_NAMES: ReadonlyArray<[string, string]> = [
    ["adres www.", "Jan www.oplaty-salon.pl"],
    ["adres https://", "https://oplata.example/zadatek"],
    ["domena dopiero po oczyszczeniu", "Jan oplata.​com"],
    ["cyfra (telefon)", "Jan 600123456"],
    ["jedna cyfra", "Jan2"],
    ["cyfry pełnoszerokie", "Jan ６００１２３"],
    ["cyfra widoczna dopiero po oczyszczeniu", "Jan ㏠"],
    ["ponad 30 znaków", "Aleksandra Wisniewska-Kowalskaa"],
  ];

  it.each(
    NAMES.flatMap((name) =>
      HOSTILE_CLIENT_NAMES.map(([label, value]): [string, string, string] => [name, label, value])
    )
  )("%s: imię (%s) → bez powitania, reszta treści bez zmian", async (name, _label, clientName) => {
    const message = await messageOf(name, { clientName });
    expect(message).toBe(await messageOf(name, { clientName: "" }));
    expect(message).toMatch(new RegExp(`^${escapeRegExp(SENDERS[name]!.prefix(""))}`));
  });

  it.each(NAMES)("%s: imię dokładnie w limicie 30 znaków → zostaje", async (name) => {
    const atLimit = "Aleksandra Wisniewska-Kowalska";
    expect(atLimit).toHaveLength(30);
    expect(await messageOf(name, { clientName: atLimit })).toContain(`: ${atLimit}, `);
  });

  it.each(NAMES)("%s: imię z wstrzykniętym numerem → numer nie trafia do treści", async (name) => {
    const PRIVATE_DIGITS = "799888777";
    for (const clientName of [
      `Wplac na ${PRIVATE_DIGITS.replace(/(\d{3})(?=\d)/g, "$1 ")}`,
      `Wplac na ${PRIVATE_DIGITS}`,
      "Wplac na ７９９８８８７７７",
    ]) {
      const message = await messageOf(name, { clientName });
      expect(message.replace(/\D/g, "")).not.toContain(PRIVATE_DIGITS);
      expect(message).not.toMatch(/Wplac na/);
    }
  });

  const HOSTILE_OWNER_TEXTS: ReadonlyArray<[string, Partial<TemplateFields>]> = [
    ["usługa", { serviceName: "www.promo.pl" }],
    ["usługa", { serviceName: "Promocja https://oplata.example" }],
    ["pracownik", { employeeName: "Anna www.oplaty-salon.pl" }],
    ["pracownik", { employeeName: "Oplata.com" }],
  ];

  it.each(
    NAMES.flatMap((name) =>
      HOSTILE_OWNER_TEXTS.map(([label, patch]): [string, string, Partial<TemplateFields>] => [name, label, patch])
    )
  )("%s: %s wyglądająca na adres → pominięta", async (name, _label, patch) => {
    const message = await messageOf(name, patch);
    expect(message).not.toMatch(/\.pl\b|\.com\b|https?:\/\/|www\.|oplat/i);
    expect(message).toContain("Jan Kowalski, ");
  });

  it("puste pola: treść gramatyczna bez powitania, usługi i pracownika", async () => {
    const empty = { clientName: "", serviceName: "", employeeName: "" };
    expect(await messageOf("sendAppointmentReminderSms", empty)).toMatch(
      /^Przypomnienie: Twoja wizyta w Salon Uroda juz dzisiaj o 14:00 \(15 stycznia\)\. Do zobaczenia!$/
    );
    expect(await messageOf("sendBookingConfirmationSms", empty)).toMatch(
      /^Potwierdzenie rezerwacji: Twoja wizyta w Salon Uroda zostala umowiona na .+ o 14:00\. Do zobaczenia!$/
    );
    expect(await messageOf("sendPaymentConfirmationSms", empty)).toMatch(
      /^Potwierdzenie platnosci: zadatek 50\.00 PLN za wizyte w Salon Uroda dnia .+ zostal przyjety\. Dziekujemy!$/
    );
  });

  it.each(NAMES)("%s: wrogie wszystkie pola → treść gramatyczna, jak przy pustych", async (name) => {
    const hostile = await messageOf(name, {
      clientName: "Jan 600123456",
      serviceName: "www.promo.pl",
      employeeName: "Oplata.com",
    });
    expect(hostile).toBe(await messageOf(name, { clientName: "", serviceName: "", employeeName: "" }));
    expect(hostile.startsWith(SENDERS[name]!.noName)).toBe(true);
    expect(hostile).not.toMatch(/ {2}|""|: ,| u w | u (juz|zostala|dnia)\b/);
  });

  it.each(NAMES)("%s: wyłącznie znaki GSM-7 (polskie znaki, nowe linie, emoji, data)", async (name) => {
    const message = await messageOf(name, {
      clientName: "Zoś\nka 💅",
      serviceName: "Manicure ✨ ąę",
      employeeName: "Ćma\tŻak",
    });
    expect([...message].filter((c) => !GSM7.has(c))).toEqual([]);
    expect(message).toContain('"Manicure ae"');
    expect(message).toContain(" u Cma Zak ");
  });

  it.each(NAMES)("%s: nazwa pracownika ponad limit → skrócona z „...”", async (name) => {
    const message = await messageOf(name, { employeeName: "Anna " + "x".repeat(60) });
    expect(message).toContain(` u Anna ${"x".repeat(32)}... w Salon Uroda`);
  });
});

/** Ucieczka znaków specjalnych do dosłownego dopasowania w RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
