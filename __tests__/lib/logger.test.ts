/**
 * logger — strukturalne logowanie serwerowe.
 * Kontrakt:
 *   - produkcja: jednoliniowy JSON (level, msg, timestamp, kontekst) kierowany
 *     do console.error/warn/log wg poziomu (log drain Vercela),
 *   - development: czytelny format [LEVEL] + opcjonalny kontekst,
 *   - obiekty Error w kontekscie sa serializowane (message/name/stack).
 *
 * `isProduction` liczy sie przy imporcie modulu — testy produkcyjne robia
 * vi.resetModules() + vi.stubEnv przed dynamicznym importem.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

async function importLoggerWithEnv(nodeEnv: string) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  const { logger } = await import("@/lib/logger");
  return logger;
}

describe("logger — produkcja (JSON structured)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("error: JSON na console.error z poziomem, wiadomoscia i kontekstem", async () => {
    const logger = await importLoggerWithEnv("production");
    logger.error("DB polaczenie padlo", { route: "/api/x" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(entry).toMatchObject({
      level: "error",
      msg: "DB polaczenie padlo",
      route: "/api/x",
    });
    expect(typeof entry.timestamp).toBe("string");
  });

  it("warn: JSON na console.warn", async () => {
    const logger = await importLoggerWithEnv("production");
    logger.warn("Powoli");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warnSpy.mock.calls[0]![0] as string)).toMatchObject({
      level: "warn",
      msg: "Powoli",
    });
  });

  it("info i debug: JSON na console.log", async () => {
    const logger = await importLoggerWithEnv("production");
    logger.info("Zrobione", { jobId: 7 });
    logger.debug("Szczegoly");

    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({
      level: "info",
      msg: "Zrobione",
      jobId: 7,
    });
    expect(JSON.parse(logSpy.mock.calls[1]![0] as string)).toMatchObject({
      level: "debug",
      msg: "Szczegoly",
    });
  });

  it("serializuje Error z kontekstu do {message, name, stack} (JSON nie gubi bledu)", async () => {
    const logger = await importLoggerWithEnv("production");
    logger.error("Padlo", { error: new Error("boom") });

    const entry = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(entry.error).toMatchObject({ message: "boom", name: "Error" });
    expect(typeof entry.error.stack).toBe("string");
  });

  // DrizzleQueryError niesie parametry zapytania (dane gościa)
  // w message i w pierwszej linii stack.
  it("DrizzleQueryError — parametry wycięte z message i stack, zapytanie i kod błędu zostają", async () => {
    const { DrizzleQueryError } = await import("drizzle-orm");
    const logger = await importLoggerWithEnv("production");
    const err = new DrizzleQueryError(
      'insert into "appointments" ("guest_name", "guest_phone") values ($1, $2)',
      ["Anna Nowak", "+48123456789", "anna@test.pl"],
      Object.assign(new Error("dup"), { code: "23505", detail: "Key (guest_email)=(anna@test.pl)" })
    );
    logger.error("Padlo", { error: err });

    const raw = errorSpy.mock.calls[0]![0] as string;
    expect(raw).not.toContain("Anna");
    expect(raw).not.toContain("123456789");
    expect(raw).not.toContain("anna@test.pl");
    const entry = JSON.parse(raw);
    expect(entry.error.message).toBe(
      'Failed query: insert into "appointments" ("guest_name", "guest_phone") values ($1, $2)\nparams: [redacted]'
    );
    expect(entry.error.stack).toMatch(/params: \[redacted\]\n\s+at /); // ramki zachowane
    expect(entry.error.causeCode).toBe("23505");
  });

  it("parametr z '\\n    at ' nie skraca wycięcia", async () => {
    const { DrizzleQueryError } = await import("drizzle-orm");
    const logger = await importLoggerWithEnv("production");
    logger.error("Padlo", {
      error: new DrizzleQueryError("select $1", ["x\n    at sekret@poczta.pl"]),
    });
    expect(errorSpy.mock.calls[0]![0] as string).not.toContain("sekret@poczta.pl");
  });

  it("zalogowany napis error.message z parametrami też jest redagowany", async () => {
    const { DrizzleQueryError } = await import("drizzle-orm");
    const logger = await importLoggerWithEnv("production");
    const err = new DrizzleQueryError("insert into x values ($1)", ["anna@test.pl"]);
    logger.error("Padlo", { error: err.message });
    const raw = errorSpy.mock.calls[0]![0] as string;
    expect(raw).not.toContain("anna@test.pl");
    expect(raw).toContain("params: [redacted]");
  });

  it("zwykły Error bez parametrów — bez zmian", async () => {
    const logger = await importLoggerWithEnv("production");
    const err = new Error("boom");
    logger.error("Padlo", { error: err });
    const entry = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(entry.error).toEqual({ message: "boom", name: "Error", stack: err.stack });
  });
});

describe("logger — development (format czytelny)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("error/warn z kontekstem i bez kontekstu", async () => {
    const logger = await importLoggerWithEnv("development");
    logger.error("Blad", { id: 1 });
    logger.error("Blad bez kontekstu");
    logger.warn("Uwaga", { id: 2 });
    logger.warn("Uwaga bez kontekstu");

    expect(errorSpy).toHaveBeenNthCalledWith(1, "[ERROR]", "Blad", { id: 1 });
    expect(errorSpy).toHaveBeenNthCalledWith(2, "[ERROR]", "Blad bez kontekstu");
    expect(warnSpy).toHaveBeenNthCalledWith(1, "[WARN]", "Uwaga", { id: 2 });
    expect(warnSpy).toHaveBeenNthCalledWith(2, "[WARN]", "Uwaga bez kontekstu");
  });

  it("info/debug ida na console.log z prefiksem poziomu", async () => {
    const logger = await importLoggerWithEnv("development");
    logger.info("Info", { a: 1 });
    logger.debug("Debug bez kontekstu");

    expect(logSpy).toHaveBeenNthCalledWith(1, "[INFO]", "Info", { a: 1 });
    expect(logSpy).toHaveBeenNthCalledWith(2, "[DEBUG]", "Debug bez kontekstu");
  });

  it("pusty kontekst {} traktowany jak brak kontekstu", async () => {
    const logger = await importLoggerWithEnv("development");
    logger.info("Bez pol", {});

    expect(logSpy).toHaveBeenCalledWith("[INFO]", "Bez pol");
  });
});

describe("logger — redakcja danych osobowych", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("produkcja: { client: { firstName, phone } } zredagowane, klucze techniczne zostają", async () => {
    const logger = await importLoggerWithEnv("production");
    logger.info("Rezerwacja", {
      salonId: "salon-1",
      appointmentId: "appt-1",
      client: { id: "c-1", firstName: "Anna", phone: "+48600123456" },
    });

    const raw = logSpy.mock.calls[0]![0] as string;
    const entry = JSON.parse(raw);
    expect(entry).toMatchObject({
      salonId: "salon-1",
      appointmentId: "appt-1",
      client: { id: "c-1", firstName: "[redacted]", phone: "[redacted]" },
    });
    expect(raw).not.toContain("Anna");
    expect(raw).not.toContain("600123456");
  });

  it("produkcja: message, name i stack błędu zostają w logu", async () => {
    const logger = await importLoggerWithEnv("production");
    const err = new TypeError("Nie udalo sie zapisac wizyty");
    logger.error("Blad", { error: err, nested: { error: err } });

    const entry = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    for (const meta of [entry.error, entry.nested.error]) {
      expect(meta.message).toBe("Nie udalo sie zapisac wizyty");
      expect(meta.name).toBe("TypeError");
      expect(typeof meta.stack).toBe("string");
      expect(meta.stack.length).toBeGreaterThan(0);
    }
  });

  it("development: ta sama redakcja (każde środowisko)", async () => {
    const logger = await importLoggerWithEnv("development");
    logger.info("x", { notes: "alergia na lateks" });

    expect(logSpy).toHaveBeenCalledWith("[INFO]", "x", { notes: "[redacted]" });
  });

  it("każdy klucz z listy, bez wielkości liter, na dowolnym poziomie i w tablicach", async () => {
    const { redactLogContext, PII_LOG_KEYS, REDACTED } = await import("@/lib/logger");
    for (const key of PII_LOG_KEYS) {
      const ctx = {
        [key]: "v",
        [key.toUpperCase()]: "v",
        deep: { a: { b: [{ [key]: "v" }, [{ [key]: "v" }]] } },
      };
      expect(redactLogContext(ctx), key).toEqual({
        [key]: REDACTED,
        [key.toUpperCase()]: REDACTED,
        deep: { a: { b: [{ [key]: REDACTED }, [{ [key]: REDACTED }]] } },
      });
    }
  });

  it("obiekt pod kluczem z listy znika w całości; inne wartości bez zmian", async () => {
    const { redactLogContext } = await import("@/lib/logger");
    const at = new Date("2026-11-15T10:00:00Z");
    expect(
      redactLogContext({ body: { anything: 1 }, count: 3, ok: true, none: null, at, name: "Strzyzenie" }),
    ).toEqual({ body: "[redacted]", count: 3, ok: true, none: null, at, name: "Strzyzenie" });
  });

  it("nie modyfikuje wejścia; cykl i głębokość nie wywracają logu", async () => {
    const { redactLogContext } = await import("@/lib/logger");
    const input: Record<string, unknown> = { client: { email: "a@b.pl" } };
    input.self = input;
    const out = redactLogContext(input) as Record<string, unknown>;
    expect((input.client as Record<string, unknown>).email).toBe("a@b.pl");
    expect(out).toEqual({ client: { email: "[redacted]" }, self: "[circular]" });

    let deep: Record<string, unknown> = { phone: "1" };
    for (let i = 0; i < 20; i++) deep = { x: deep };
    expect(JSON.stringify(redactLogContext(deep))).not.toContain('"1"');
  });
});

describe("logger — klucze z fragmentem phone/email", () => {
  const CONTACT_KEYS = ["guestPhone", "guestEmail", "blikPhoneNumber", "clientEmail"] as const;
  const VALUES: Record<(typeof CONTACT_KEYS)[number], string> = {
    guestPhone: "+48600123456",
    guestEmail: "anna@test.pl",
    blikPhoneNumber: "+48123456789",
    clientEmail: "a@b.pl",
  };

  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("napis pod kluczem z fragmentem → [redacted] na poziomie głównym, zagnieżdżonym i w tablicy, bez wielkości liter", async () => {
    const { redactLogContext, REDACTED } = await import("@/lib/logger");
    for (const key of CONTACT_KEYS) {
      const v = VALUES[key];
      const ctx = { [key]: v, [key.toUpperCase()]: v, deep: { a: [{ [key]: v }, [{ [key]: v }]] } };
      expect(redactLogContext(ctx), key).toEqual({
        [key]: REDACTED,
        [key.toUpperCase()]: REDACTED,
        deep: { a: [{ [key]: REDACTED }, [{ [key]: REDACTED }]] },
      });
    }
  });

  it("wartości nienapisowe pod kluczem z fragmentem zostają", async () => {
    const { redactLogContext } = await import("@/lib/logger");
    const ctx = { emailSent: true, emailCount: 3, phoneVerified: false, emailAt: null };
    expect(redactLogContext(ctx)).toEqual(ctx);
  });

  it("obiekt pod kluczem z fragmentem nie znika; jego pola redagowane wg reguł", async () => {
    const { redactLogContext } = await import("@/lib/logger");
    expect(
      redactLogContext({
        emailData: { recipientEmail: "anna@test.pl", template: "reminder", sent: true, body: "tekst" },
      }),
    ).toEqual({
      emailData: { recipientEmail: "[redacted]", template: "reminder", sent: true, body: "[redacted]" },
    });
  });

  it("fragmenty są eksportowane obok listy pełnych nazw", async () => {
    const { PII_LOG_KEY_FRAGMENTS } = await import("@/lib/logger");
    expect(PII_LOG_KEY_FRAGMENTS).toEqual(["phone", "email"]);
  });

  it("produkcja: klucze z fragmentem zredagowane w wyjściu JSON", async () => {
    const logger = await importLoggerWithEnv("production");
    logger.info("Rezerwacja", { salonId: "salon-1", emailSent: true, guest: [{ ...VALUES }] });

    const raw = logSpy.mock.calls[0]![0] as string;
    for (const v of Object.values(VALUES)) expect(raw).not.toContain(v);
    expect(JSON.parse(raw)).toMatchObject({
      salonId: "salon-1",
      emailSent: true,
      guest: [Object.fromEntries(CONTACT_KEYS.map((k) => [k, "[redacted]"]))],
    });
  });

  it("development: ta sama redakcja", async () => {
    const logger = await importLoggerWithEnv("development");
    logger.info("x", { guestPhone: "+48600123456", nested: { clientEmail: "a@b.pl" }, emailCount: 3 });

    expect(logSpy).toHaveBeenCalledWith("[INFO]", "x", {
      guestPhone: "[redacted]",
      nested: { clientEmail: "[redacted]" },
      emailCount: 3,
    });
  });

  it("logger.error z SyntaxError z JSON.parse → w wyjściu brak telefonu i e-maila (produkcja i development)", async () => {
    // Zły znak tuż przed wartością: wycinek wejścia w treści błędu obejmuje
    // znaki następujące po nim.
    const parse = (text: string): Error => {
      try {
        JSON.parse(text);
      } catch (e) {
        return e as Error;
      }
      throw new Error("JSON.parse nie rzucił");
    };
    const emailError = parse('x"anna@test.pl"');
    const phoneError = parse('x"+48123456789"');
    expect(emailError.message).toContain("anna@test");
    expect(phoneError.message).toContain("4812345");

    const prod = await importLoggerWithEnv("production");
    prod.error("Padlo", { error: emailError, cause: phoneError });
    const raw = errorSpy.mock.calls[0]![0] as string;
    expect(raw).not.toContain("anna@test");
    expect(raw).not.toContain("4812345");
    expect(JSON.parse(raw).error.name).toBe("SyntaxError");

    const dev = await importLoggerWithEnv("development");
    dev.error("Padlo", { error: emailError, cause: phoneError });
    const printed = JSON.stringify(errorSpy.mock.calls[1]);
    expect(printed).not.toContain("anna@test");
    expect(printed).not.toContain("4812345");
  });
});

describe("logger — liczby i tablice pod kluczem z fragmentem phone/email", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("tablica napisów pod kluczem z fragmentem → [redacted] w całości", async () => {
    const { redactLogContext, REDACTED } = await import("@/lib/logger");
    expect(
      redactLogContext({ phones: ["+48600123456", "+48123456789"], emails: ["anna@example.com"] }),
    ).toEqual({ phones: REDACTED, emails: REDACTED });
  });

  it("tablica mieszana (napis + obiekt) pod kluczem z fragmentem → [redacted] w całości", async () => {
    const { redactLogContext, REDACTED } = await import("@/lib/logger");
    expect(redactLogContext({ guestEmails: ["anna@example.com", { id: "c-1" }] })).toEqual({
      guestEmails: REDACTED,
    });
  });

  it("tablica zagnieżdżona z napisem, liczbą albo bigint pod kluczem z fragmentem → [redacted] w całości", async () => {
    const { redactLogContext, REDACTED } = await import("@/lib/logger");
    expect(
      redactLogContext({
        phones: [["+48600123456"]],
        guestPhones: [[], [[48600123456]]],
        emails: [[{ id: "c-1" }], ["anna@example.com"]],
        blikPhones: [[BigInt("48123456789")]],
      }),
    ).toEqual({ phones: REDACTED, guestPhones: REDACTED, emails: REDACTED, blikPhones: REDACTED });
  });

  it("tablica zagnieżdżona bez wartości kontaktowej pod kluczem z fragmentem → bez zmiany kształtu", async () => {
    const { redactLogContext, REDACTED } = await import("@/lib/logger");
    expect(
      redactLogContext({ emails: [[], [[]]], phones: [[{ id: "c-1", phone: "+48600123456", count: 3 }]] }),
    ).toEqual({ emails: [[], [[]]], phones: [[{ id: "c-1", phone: REDACTED, count: 3 }]] });
  });

  it("szeroka tablica zawierająca samą siebie pod kluczem bez fragmentu → wywołanie wraca ze znacznikiem [circular]", async () => {
    const { redactLogContext } = await import("@/lib/logger");
    const a: unknown[] = [];
    for (let i = 0; i < 20; i++) a.push(a);
    const out = redactLogContext({ items: a });
    expect(JSON.stringify(out)).toContain("[circular]");
  });

  it("szeroka tablica zawierająca samą siebie pod kluczem z fragmentem → wywołanie wraca ze znacznikiem [circular]", async () => {
    const { redactLogContext } = await import("@/lib/logger");
    const a: unknown[] = [];
    for (let i = 0; i < 20; i++) a.push(a);
    const out = redactLogContext({ emails: a });
    expect(JSON.stringify(out)).toContain("[circular]");
  });

  it("liczba całkowita od 7 cyfr i bigint pod kluczem z fragmentem → [redacted], także w tablicy", async () => {
    const { redactLogContext, REDACTED } = await import("@/lib/logger");
    expect(
      redactLogContext({
        guestPhone: 48600123456,
        clientPhone: -48600123456,
        blikPhoneNumber: BigInt("48123456789"),
        phoneMin: 1_000_000,
        phones: [{ id: "c-1" }, 48600123456],
      }),
    ).toEqual({
      guestPhone: REDACTED,
      clientPhone: REDACTED,
      blikPhoneNumber: REDACTED,
      phoneMin: REDACTED,
      phones: REDACTED,
    });
  });

  it("zostają: licznik, wartość logiczna, pusta tablica; tablica obiektów redagowana rekurencyjnie", async () => {
    const { redactLogContext, REDACTED } = await import("@/lib/logger");
    expect(
      redactLogContext({
        emailCount: 3,
        phoneMax: 999_999,
        emailSent: true,
        emails: [],
        emailRecipients: [
          { id: "c-1", email: "anna@example.com", sent: true },
          { id: "c-2", guestPhone: "+48600123456" },
        ],
      }),
    ).toEqual({
      emailCount: 3,
      phoneMax: 999_999,
      emailSent: true,
      emails: [],
      emailRecipients: [
        { id: "c-1", email: REDACTED, sent: true },
        { id: "c-2", guestPhone: REDACTED },
      ],
    });
  });

  it("na poziomie zagnieżdżonym i w tablicy obiektów", async () => {
    const { redactLogContext, REDACTED } = await import("@/lib/logger");
    expect(
      redactLogContext({
        booking: { guest: { phones: ["+48600123456"], guestPhone: 48600123456, emailCount: 2 } },
        list: [{ emails: ["anna@example.com"], salonId: "salon-1" }],
      }),
    ).toEqual({
      booking: { guest: { phones: REDACTED, guestPhone: REDACTED, emailCount: 2 } },
      list: [{ emails: REDACTED, salonId: "salon-1" }],
    });
  });

  it("produkcja: w wyjściu JSON ani numeru zapisanego liczbą, ani adresu z tablicy", async () => {
    const logger = await importLoggerWithEnv("production");
    logger.info("Rezerwacja", {
      salonId: "salon-1",
      guestPhone: 48600123456,
      blikPhoneNumber: BigInt("48123456789"),
      emails: ["anna@example.com"],
      emailCount: 3,
    });

    const raw = logSpy.mock.calls[0]![0] as string;
    expect(raw).not.toContain("600123456");
    expect(raw).not.toContain("123456789");
    expect(raw).not.toContain("anna@example.com");
    expect(JSON.parse(raw)).toMatchObject({
      salonId: "salon-1",
      guestPhone: "[redacted]",
      blikPhoneNumber: "[redacted]",
      emails: "[redacted]",
      emailCount: 3,
    });
  });
});

describe("logger — wartości nieserializowalne w kontekście (produkcja)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("bigint pod zwykłym kluczem → napis dziesiętny, wpis nie ginie", async () => {
    const logger = await importLoggerWithEnv("production");
    expect(() => logger.info("x", { count: BigInt(10) })).not.toThrow();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({ level: "info", msg: "x", count: "10" });
  });

  it("bigint głęboko w obiekcie i tablicy → napis dziesiętny; pod kluczem kontaktowym → [redacted]", async () => {
    const logger = await importLoggerWithEnv("production");
    logger.info("x", { a: { b: [BigInt(1)] }, phone: BigInt("48600100200") });

    const raw = logSpy.mock.calls[0]![0] as string;
    expect(raw).not.toContain("48600100200");
    expect(JSON.parse(raw)).toMatchObject({ a: { b: ["1"] }, phone: "[redacted]" });
  });

  it("bigint w obiekcie niebędącym zwykłym obiektem → napis dziesiętny", async () => {
    class Licznik {
      value = BigInt(42);
    }
    const logger = await importLoggerWithEnv("production");
    logger.info("x", { licznik: new Licznik() });

    expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({ licznik: { value: "42" } });
  });

  it("cykl w obiekcie niebędącym zwykłym obiektem → wpis zastępczy z polami prostymi kontekstu, kanał wg poziomu", async () => {
    class Wezel {
      self: Wezel;
      constructor() {
        this.self = this;
      }
    }
    const logger = await importLoggerWithEnv("production");
    expect(() => logger.error("Padlo", { route: "/api/x", node: new Wezel() })).not.toThrow();
    expect(() => logger.warn("Uwaga", { node: new Wezel() })).not.toThrow();
    expect(() => logger.info("Info", { node: new Wezel() })).not.toThrow();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(errorSpy.mock.calls[0]![0] as string)).toEqual({
      level: "error",
      msg: "Padlo",
      timestamp: expect.any(String),
      route: "/api/x",
      contextError: "unserializable",
    });
    expect(JSON.parse(warnSpy.mock.calls[0]![0] as string)).toEqual({
      level: "warn",
      msg: "Uwaga",
      timestamp: expect.any(String),
      contextError: "unserializable",
    });
    expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toEqual({
      level: "info",
      msg: "Info",
      timestamp: expect.any(String),
      contextError: "unserializable",
    });
  });
});

describe("logger — redakcja przy serializacji, wpis zastępczy, logger nie rzuca", () => {
  const PHONE = "+48600100200";
  const EMAIL = "anna@example.com";
  const DB_URL = "https://uzytkownik:tajne-haslo@db.example.com/x?token=abc";
  const DB_URL_SAFE = "https://db.example.com/x?token=abc";

  class Kontakt {
    id = "c-1";
    phone = PHONE;
    email = EMAIL;
    firstName = "Anna";
  }

  class Wezel {
    self: Wezel;
    constructor() {
      this.self = this;
    }
  }

  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("pola phone, email i firstName instancji klasy → [redacted], pole zwykłe zostaje", async () => {
    const logger = await importLoggerWithEnv("production");
    logger.info("x", { kontakt: new Kontakt() });

    const raw = logSpy.mock.calls[0]![0] as string;
    expect(raw).not.toContain("600100200");
    expect(raw).not.toContain(EMAIL);
    expect(JSON.parse(raw).kontakt).toEqual({
      id: "c-1",
      phone: "[redacted]",
      email: "[redacted]",
      firstName: "[redacted]",
    });
  });

  it("instancja klasy z zagnieżdżonym zwykłym obiektem i tablicą pod kluczem z fragmentem → zredagowane", async () => {
    class Rezerwacja {
      id = "r-1";
      contact = { email: EMAIL };
      phones = [PHONE];
    }
    const logger = await importLoggerWithEnv("production");
    logger.info("x", { rezerwacja: new Rezerwacja() });

    const raw = logSpy.mock.calls[0]![0] as string;
    expect(raw).not.toContain("600100200");
    expect(raw).not.toContain(EMAIL);
    expect(JSON.parse(raw).rezerwacja).toEqual({
      id: "r-1",
      contact: { email: "[redacted]" },
      phones: "[redacted]",
    });
  });

  it("URL z danymi logowania w zwykłym obiekcie i w instancji klasy → adres bez nazwy użytkownika i hasła", async () => {
    class Polaczenie {
      url = new URL(DB_URL);
    }
    const logger = await importLoggerWithEnv("production");
    logger.info("x", { dbUrl: new URL(DB_URL), polaczenie: new Polaczenie() });

    const raw = logSpy.mock.calls[0]![0] as string;
    expect(raw).not.toContain("tajne-haslo");
    expect(raw).not.toContain("uzytkownik:");
    expect(raw).toContain("db.example.com");
    expect(JSON.parse(raw)).toMatchObject({ dbUrl: DB_URL_SAFE, polaczenie: { url: DB_URL_SAFE } });
  });

  it("URL z danymi logowania — redactLogContext i tryb deweloperski dają adres bez nazwy użytkownika i hasła", async () => {
    const { redactLogContext } = await import("@/lib/logger");
    expect(redactLogContext({ dbUrl: new URL(DB_URL) })).toEqual({ dbUrl: DB_URL_SAFE });

    const logger = await importLoggerWithEnv("development");
    logger.info("x", { dbUrl: new URL(DB_URL) });
    expect(logSpy).toHaveBeenCalledWith("[INFO]", "x", { dbUrl: DB_URL_SAFE });
  });

  it("wpis zastępczy: pola proste kontekstu zostają, level/msg/timestamp z wpisu wygrywają, bez obiektów", async () => {
    const logger = await importLoggerWithEnv("production");
    expect(() =>
      logger.error("Padlo", {
        route: "/api/x",
        attempt: 2,
        ok: false,
        level: "fałszywy",
        node: new Wezel(),
        meta: { a: 1 },
      }),
    ).not.toThrow();

    expect(JSON.parse(errorSpy.mock.calls[0]![0] as string)).toEqual({
      level: "error",
      msg: "Padlo",
      timestamp: expect.any(String),
      route: "/api/x",
      attempt: 2,
      ok: false,
      contextError: "unserializable",
    });
  });

  it("wpis zastępczy: phone w kontekście → [redacted]", async () => {
    const logger = await importLoggerWithEnv("production");
    logger.error("Padlo", { phone: PHONE, node: new Wezel() });

    const raw = errorSpy.mock.calls[0]![0] as string;
    expect(raw).not.toContain("600100200");
    expect(JSON.parse(raw)).toMatchObject({ phone: "[redacted]", contextError: "unserializable" });
  });

  it("msg typu bigint z kodu bez typów i cykl w kontekście → logger nie rzuca", async () => {
    const logger = await importLoggerWithEnv("production");
    expect(() => logger.error(BigInt(5) as unknown as string, { node: new Wezel() })).not.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("getter rzucający wyjątek w kontekście → logger nie rzuca (produkcja i development), contextError bez treści wyjątku", async () => {
    const makeCtx = () => {
      const ctx: Record<string, unknown> = { route: "/api/x" };
      Object.defineProperty(ctx, "x", {
        enumerable: true,
        get() {
          throw new Error("getter-tekst");
        },
      });
      return ctx;
    };

    const prod = await importLoggerWithEnv("production");
    expect(() => prod.error("Padlo", makeCtx())).not.toThrow();
    const raw = errorSpy.mock.calls[0]![0] as string;
    expect(raw).not.toContain("getter-tekst");
    expect(JSON.parse(raw)).toEqual({
      level: "error",
      msg: "Padlo",
      timestamp: expect.any(String),
      contextError: "unserializable",
    });

    const dev = await importLoggerWithEnv("development");
    expect(() => dev.error("Padlo", makeCtx())).not.toThrow();
    expect(errorSpy).toHaveBeenNthCalledWith(2, "[ERROR]", "Padlo", { contextError: "unserializable" });
  });

  it("Date pod kluczem z fragmentem w zwykłym obiekcie i w instancji klasy → napis daty; liczba pod takim kluczem → [redacted]", async () => {
    const ISO = "2026-01-02T03:04:05.000Z";
    class Wysylka {
      emailSentAt = new Date(ISO);
      emailSentAtMs = 1767323045000;
    }
    const logger = await importLoggerWithEnv("production");
    logger.info("x", { emailSentAt: new Date(ISO), emailSentAtMs: 1767323045000, wysylka: new Wysylka() });

    expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({
      emailSentAt: ISO,
      emailSentAtMs: "[redacted]",
      wysylka: { emailSentAt: ISO, emailSentAtMs: "[redacted]" },
    });
  });

  class KontekstZGetterem {
    route = "/api/x";
  }

  const makeClassCtx = () => {
    const ctx = new KontekstZGetterem();
    Object.defineProperty(ctx, "x", {
      enumerable: true,
      get() {
        throw new Error("getter-tekst");
      },
    });
    return ctx as unknown as Record<string, unknown>;
  };

  it("cały kontekst jako instancja klasy z getterem rzucającym wyjątek → logger nie rzuca (produkcja i development), wpis ostateczny", async () => {
    const prod = await importLoggerWithEnv("production");
    expect(() => prod.error("Padlo", makeClassCtx())).not.toThrow();
    const raw = errorSpy.mock.calls[0]![0] as string;
    expect(raw).not.toContain("getter-tekst");
    expect(JSON.parse(raw)).toEqual({
      level: "error",
      msg: "Padlo",
      timestamp: expect.any(String),
      contextError: "unserializable",
    });

    const dev = await importLoggerWithEnv("development");
    expect(() => dev.error("Padlo", makeClassCtx())).not.toThrow();
  });

  it("cały kontekst jako instancja klasy z getterem rzucającym wyjątek i msg niebędący napisem → logger nie rzuca, msg [unserializable]", async () => {
    const prod = await importLoggerWithEnv("production");
    expect(() => prod.error(BigInt(5) as unknown as string, makeClassCtx())).not.toThrow();
    const raw = errorSpy.mock.calls[0]![0] as string;
    expect(raw).not.toContain("getter-tekst");
    expect(JSON.parse(raw)).toEqual({
      level: "error",
      msg: "[unserializable]",
      timestamp: expect.any(String),
      contextError: "unserializable",
    });
  });

  it("URL i Date pod kluczem z listy oraz URL pod kluczem z fragmentem w instancji klasy → [redacted]", async () => {
    class Adresat {
      address = new URL(DB_URL);
      emailLink = new URL("mailto:" + EMAIL);
      note = new Date("2026-01-02T03:04:05.000Z");
    }
    const logger = await importLoggerWithEnv("production");
    logger.info("x", { adresat: new Adresat() });

    const raw = logSpy.mock.calls[0]![0] as string;
    expect(raw).not.toContain(EMAIL);
    expect(raw).not.toContain("db.example.com");
    expect(raw).not.toContain("2026-01-02");
    expect(JSON.parse(raw).adresat).toEqual({
      address: "[redacted]",
      emailLink: "[redacted]",
      note: "[redacted]",
    });
  });

  it("błąd zapytania w polu instancji klasy → bezpieczny zapis błędu, parametry nie trafiają do logu", async () => {
    const { DrizzleQueryError } = await import("drizzle-orm");
    class Zadanie {
      id = "z-1";
      cause = new DrizzleQueryError("insert into x values ($1)", [EMAIL]);
    }
    const logger = await importLoggerWithEnv("production");
    logger.error("Padlo", { zadanie: new Zadanie() });

    const raw = errorSpy.mock.calls[0]![0] as string;
    expect(raw).not.toContain(EMAIL);
    const cause = JSON.parse(raw).zadanie.cause;
    expect(cause).toHaveProperty("message");
    expect(cause).toHaveProperty("name");
  });

  it("tryb deweloperski: URL pod kluczem z fragmentem w zwykłym obiekcie → [redacted]", async () => {
    const logger = await importLoggerWithEnv("development");
    logger.info("x", { emailLink: new URL("mailto:" + EMAIL) });
    expect(logSpy).toHaveBeenCalledWith("[INFO]", "x", { emailLink: "[redacted]" });
  });

  it("tablica URL pod kluczem z fragmentem w instancji klasy → cała tablica [redacted]", async () => {
    class Adresat {
      emailLinks = [new URL("mailto:" + EMAIL)];
    }
    const logger = await importLoggerWithEnv("production");
    logger.info("x", { adresat: new Adresat() });

    const raw = logSpy.mock.calls[0]![0] as string;
    expect(raw).not.toContain(EMAIL);
    expect(JSON.parse(raw).adresat).toEqual({ emailLinks: "[redacted]" });
  });

  it("tryb deweloperski: tablica URL pod kluczem z fragmentem w zwykłym obiekcie → [redacted]", async () => {
    const logger = await importLoggerWithEnv("development");
    logger.info("x", { emailLinks: [new URL("mailto:" + EMAIL)] });
    expect(logSpy).toHaveBeenCalledWith("[INFO]", "x", { emailLinks: "[redacted]" });
  });
});
