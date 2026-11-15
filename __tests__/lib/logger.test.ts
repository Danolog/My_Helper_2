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

  // N3 (Ryan): DrizzleQueryError niesie parametry zapytania (dane gościa)
  // w message i w pierwszej linii stack.
  it("N3: DrizzleQueryError — parametry wycięte z message i stack, zapytanie i kod błędu zostają", async () => {
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

  it("N3: parametr z '\\n    at ' nie skraca wycięcia", async () => {
    const { DrizzleQueryError } = await import("drizzle-orm");
    const logger = await importLoggerWithEnv("production");
    logger.error("Padlo", {
      error: new DrizzleQueryError("select $1", ["x\n    at sekret@poczta.pl"]),
    });
    expect(errorSpy.mock.calls[0]![0] as string).not.toContain("sekret@poczta.pl");
  });

  it("N3: zalogowany napis error.message z parametrami też jest redagowany", async () => {
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

describe("logger — redakcja danych osobowych (hotfix P1)", () => {
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
