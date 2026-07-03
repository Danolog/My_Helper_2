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
