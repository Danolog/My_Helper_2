/**
 * GET /api/promotions/check-first-visit — trasa publiczna (bez sesji).
 *
 * Wyciek: dla pary salonId + e-mail trasa odpowiadała inaczej klientowi
 * salonu (`appointmentCount`, „Klient ma juz wizyty…”) niż osobie nieznanej —
 * każdy mógł sprawdzić, czy dany e-mail jest klientem salonu.
 *
 * Promocja pierwszej wizyty jest zamrożona (decyzja produktowa), więc trasa
 * nie czyta bazy i zawsze odpowiada „nie przysługuje” — identycznie dla
 * każdego e-maila.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as route } from "@/app/api/promotions/check-first-visit/route";
import { createMockRequest } from "./helpers";

/**
 * Moduł `complexPromotions` jest zamrożony (B2) i trasa odpowiada 404 zanim
 * cokolwiek sprawdzi. Testy logiki poniżej omijają tę bramkę
 * (`guardState.bypass`), żeby zachowanie było pilnowane także na wypadek
 * odmrożenia; test „zamrożona” sprawdza bramkę prawdziwą.
 */
const { guardState } = vi.hoisted(() => ({ guardState: { bypass: true } }));
vi.mock("@/lib/server/frozen-guard", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/frozen-guard")>();
  return {
    frozenModuleResponse: (module: Parameters<typeof real.frozenModuleResponse>[0]) =>
      guardState.bypass ? null : real.frozenModuleResponse(module),
  };
});

const SALON = "11111111-1111-1111-1111-111111111111";
const SERVICE = "22222222-2222-2222-2222-222222222222";

/** Kolejka wyników kolejnych zapytań do bazy — stan sprzed poprawki. */
const { selectQueue, mockDbSelect } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const next = () => (selectQueue.length > 0 ? selectQueue.shift()! : []);
  const chain = () => {
    const thenable = Promise.resolve().then(next) as Promise<unknown[]> & Record<string, unknown>;
    thenable.limit = () => Promise.resolve(next());
    return thenable;
  };
  const mockDbSelect = vi.fn(() => ({ from: () => ({ where: chain }) }));
  return { selectQueue, mockDbSelect };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...(args as [])),
    insert: () => {
      throw new Error("trasa nie może pisać do bazy");
    },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Trasa nie czyta żądania (nie deklaruje parametru), ale Next przekazuje je
// każdemu handlerowi — test woła ją tak samo, z pełnym adresem i parametrami.
const GET = route as unknown as (request: Request) => Promise<Response>;

const activePromo = {
  id: "promo-1",
  salonId: SALON,
  name: "Pierwsza wizyta -20%",
  type: "first_visit",
  value: "20",
  isActive: true,
  startDate: null,
  endDate: null,
};

async function ask(email: string, withService = true) {
  const url =
    `http://localhost:3000/api/promotions/check-first-visit?salonId=${SALON}` +
    `&email=${encodeURIComponent(email)}` +
    (withService ? `&serviceId=${SERVICE}` : "");
  const response = await GET(createMockRequest(url));
  return { status: response.status, text: await response.text() };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
});

describe("GET /api/promotions/check-first-visit — zamrożona (B2)", () => {
  it("404 MODULE_DISABLED identycznie dla klienta i osoby nieznanej, bez bazy", async () => {
    guardState.bypass = false;
    try {
      selectQueue.push([activePromo], [{ id: "client-1" }], [{ count: 3 }], [{ count: 0 }]);
      const known = await ask("stala.klientka@example.com");
      const unknown = await ask("ktos.obcy@example.com");

      expect(known.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect(known.text).toBe(unknown.text);
      expect(JSON.parse(known.text)).toEqual({
        success: false,
        code: "MODULE_DISABLED",
        error: "Ta funkcja jest obecnie niedostępna.",
      });
      expect(mockDbSelect).not.toHaveBeenCalled();
    } finally {
      guardState.bypass = true;
    }
  });
});

describe("GET /api/promotions/check-first-visit (po odmrożeniu modułu)", () => {
  it("klient z wizytami i nieznany e-mail dostają odpowiedź identyczną bajt w bajt", async () => {
    // Baza „zna” pierwszego: aktywna promocja, kartoteka klienta, 3 wizyty.
    selectQueue.push([activePromo], [{ id: "client-1" }], [{ count: 3 }], [{ count: 0 }]);
    const known = await ask("stala.klientka@example.com");

    // Drugiego nie zna: aktywna promocja, brak kartoteki, 0 wizyt, usługa.
    selectQueue.length = 0;
    selectQueue.push([activePromo], [], [{ count: 0 }], [{ basePrice: "100.00" }]);
    const unknown = await ask("ktos.obcy@example.com");

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.text).toBe(unknown.text);
  });

  it("odpowiedź nie zdradza liczby wizyt ani tego, że e-mail jest klientem salonu", async () => {
    selectQueue.push([activePromo], [{ id: "client-1" }], [{ count: 3 }], [{ count: 0 }]);
    const { text } = await ask("stala.klientka@example.com");
    const body = JSON.parse(text);

    expect(body.success).toBe(true);
    expect(body.data.eligible).toBe(false);
    expect(body.data).not.toHaveProperty("appointmentCount");
    expect(text).not.toMatch(/appointmentCount|ma juz wizyty|ma już wizyty/i);
  });

  it("nikt nie dostaje promocji — także gość bez wizyt przy aktywnej promocji salonu", async () => {
    selectQueue.push([activePromo], [], [{ count: 0 }], [{ basePrice: "100.00" }]);
    const body = JSON.parse((await ask("nowa.osoba@example.com")).text);

    expect(body.data.eligible).toBe(false);
    expect(body.data).not.toHaveProperty("discountPercent");
    expect(body.data).not.toHaveProperty("promotionId");
  });

  it("trasa nie pyta bazy — dla żadnego e-maila", async () => {
    selectQueue.push([activePromo], [{ id: "client-1" }], [{ count: 3 }], [{ count: 0 }]);

    await ask("stala.klientka@example.com");
    await ask("ktos.obcy@example.com");
    await ask("nowa.osoba@example.com", false);

    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("brak parametrów daje tę samą odpowiedź co pełne zapytanie", async () => {
    const full = await ask("ktos@example.com");
    const response = await GET(
      createMockRequest("http://localhost:3000/api/promotions/check-first-visit")
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(full.text);
  });
});
