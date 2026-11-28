/**
 * ai/content/newsletter — odczyty i zapis danych salonu przez forSalon.
 *
 * Każde zapytanie trasy (salon, usługi, promocje, zapis newslettera, lista)
 * idzie przez `forSalon(salonId).raw(...)` z salonem z bramki albo z sesji,
 * nigdy z treści ani z parametrów żądania. Wyniki i odpowiedzi jak przed
 * przeniesieniem; błąd odczytu promocji nie unieważnia salonu i usług.
 *
 * Bramka, model i zapis zużycia są mockowane; surowe `db` nie ma metod, więc
 * zapytanie z pominięciem `forSalon` nie trafi do atrapy.
 */
import { NextResponse } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockRequest, parseResponse } from "./helpers";

const m = vi.hoisted(() => {
  /** Wyniki zapytań w kolejności wykonania (wspólna kolejka dla wszystkich tx). */
  const results: Array<unknown | Error> = [];
  const next = () => {
    const r = results.shift();
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  const calls = { where: [] as unknown[], values: [] as unknown[] };
  const makeTx = () => {
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "from", "orderBy", "insert"]) {
      chain[name] = () => chain;
    }
    chain.where = (w: unknown) => {
      calls.where.push(w);
      return chain;
    };
    chain.values = (v: unknown) => {
      calls.values.push(v);
      return chain;
    };
    chain.limit = () => next();
    chain.returning = () => next();
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      next().then(resolve, reject);
    return chain;
  };
  const forSalon = vi.fn((salonId: string) => {
    if (!salonId) throw new Error("repository.forSalon: salonId wymagany");
    return { salonId, raw: (fn: (tx: unknown) => unknown) => fn(makeTx()) };
  });
  return {
    results,
    calls,
    forSalon,
    requireProAI: vi.fn(),
    trackAIUsage: vi.fn(),
    generateText: vi.fn(),
    requireAuth: vi.fn(),
    getUserSalonId: vi.fn(),
  };
});

vi.mock("@/lib/server/repository", () => ({
  forSalon: (salonId: string) => m.forSalon(salonId),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ai/openrouter", () => ({
  requireProAI: (...a: unknown[]) => m.requireProAI(...a),
  isProAIError: (r: unknown) => r instanceof Response,
  trackAIUsage: (...a: unknown[]) => m.trackAIUsage(...a),
}));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...a: unknown[]) => m.requireAuth(...a),
  isAuthError: (r: unknown) => r instanceof NextResponse,
}));
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: (...a: unknown[]) => m.getUserSalonId(...a),
}));
vi.mock("ai", () => ({
  generateText: (...a: unknown[]) => m.generateText(...a),
}));
vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: () => (id: string) => ({ id }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GET, POST } from "@/app/api/ai/content/newsletter/route";

const SALON = "salon-1";
const OTHER = "salon-2";

const SALON_ROW = {
  name: "Salon Testowy",
  industryType: "hair_salon",
  address: "ul. Testowa 1",
  phone: "000000000",
};
const SERVICES = [{ name: "Strzyzenie", basePrice: "80" }];
const PROMOS = [{ name: "Jesien", type: "percentage", value: "10" }];

function post(body: Record<string, unknown>) {
  return POST(
    createMockRequest("http://localhost/api/ai/content/newsletter", { method: "POST", body }),
  );
}

function promptSent(): string {
  const args = m.generateText.mock.calls[0]![0] as { prompt: string };
  return args.prompt;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.results.length = 0;
  m.calls.where.length = 0;
  m.calls.values.length = 0;
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  m.requireProAI.mockResolvedValue({ salonId: SALON });
  m.trackAIUsage.mockResolvedValue(undefined);
  m.generateText.mockResolvedValue({ text: "TEMAT: Nowosci\n\nTresc newslettera." });
  m.requireAuth.mockResolvedValue({ user: { id: "u1" }, session: {} });
  m.getUserSalonId.mockResolvedValue(SALON);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST — odczyty i zapis przez forSalon", () => {
  it("salon, usługi, promocje i zapis: każde przez forSalon z salonem z bramki", async () => {
    m.results.push([SALON_ROW], SERVICES, PROMOS, [{ id: "nl-1" }]);

    const res = await parseResponse<{ savedId: string; subject: string }>(
      await post({ topic: "Nowosci", save: true, salonId: OTHER }),
    );

    expect(res.status).toBe(200);
    expect(res.body.savedId).toBe("nl-1");
    expect(res.body.subject).toBe("Nowosci");
    expect(m.forSalon).toHaveBeenCalledTimes(4);
    for (const call of m.forSalon.mock.calls) expect(call[0]).toBe(SALON);
    expect(m.calls.values).toEqual([
      { salonId: SALON, subject: "Nowosci", content: "Tresc newslettera." },
    ]);
    const prompt = promptSent();
    expect(prompt).toContain('Salon: "Salon Testowy" (salon fryzjerski)');
    expect(prompt).toContain("Dostepne uslugi: Strzyzenie (80 PLN)");
    expect(prompt).toContain("Aktywne promocje: Jesien (-10%)");
  });

  it("bez zapisu: trzy odczyty przez forSalon, brak insertu", async () => {
    m.results.push([SALON_ROW], SERVICES, PROMOS);

    const res = await post({ topic: "Nowosci" });

    expect(res.status).toBe(200);
    expect(m.forSalon).toHaveBeenCalledTimes(3);
    expect(m.calls.values).toEqual([]);
  });

  it("błąd odczytu promocji: salon i usługi zostają w zapytaniu do modelu", async () => {
    m.results.push([SALON_ROW], SERVICES, new Error("promotions down"));

    const res = await post({ topic: "Nowosci" });

    expect(res.status).toBe(200);
    const prompt = promptSent();
    expect(prompt).toContain('Salon: "Salon Testowy"');
    expect(prompt).toContain("Dostepne uslugi: Strzyzenie (80 PLN)");
    expect(prompt).not.toContain("Aktywne promocje");
  });

  it("błąd odczytu salonu: wartości domyślne, model wołany", async () => {
    m.results.push(new Error("db down"));

    const res = await post({ topic: "Nowosci" });

    expect(res.status).toBe(200);
    expect(promptSent()).toContain('Salon: "Salon" (salon uslugowy)');
  });

  it("błąd zapisu: 200 bez savedId", async () => {
    m.results.push([SALON_ROW], SERVICES, PROMOS, new Error("insert down"));

    const res = await parseResponse<{ savedId: string | null }>(
      await post({ topic: "Nowosci", save: true }),
    );

    expect(res.status).toBe(200);
    expect(res.body.savedId).toBeNull();
  });

  it("bramka odmawia: brak zapytań do bazy", async () => {
    m.requireProAI.mockResolvedValue(Response.json({ error: "x" }, { status: 403 }));

    const res = await post({ topic: "Nowosci" });

    expect(res.status).toBe(403);
    expect(m.forSalon).not.toHaveBeenCalled();
  });
});

describe("GET — lista przez forSalon", () => {
  it("lista z salonu z sesji, nie z parametru zapytania", async () => {
    const rows = [{ id: "nl-1", salonId: SALON, subject: "A", content: "B" }];
    m.results.push(rows);

    const res = await parseResponse<{ newsletters: unknown[] }>(
      await GET(),
    );

    expect(res.status).toBe(200);
    expect(res.body.newsletters).toEqual(rows);
    expect(m.forSalon).toHaveBeenCalledTimes(1);
    expect(m.forSalon).toHaveBeenCalledWith(SALON);
  });

  it("brak salonu w sesji → 404 bez zapytania", async () => {
    m.getUserSalonId.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(404);
    expect(m.forSalon).not.toHaveBeenCalled();
  });

  it("błąd bazy → 500 ze stałą treścią", async () => {
    m.results.push(new Error("db down"));

    const res = await parseResponse<{ error: string }>(await GET());

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Blad podczas pobierania newsletterow");
  });
});
