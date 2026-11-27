/**
 * Druga linia obrony zamrożenia (B2, uwaga z audytu bezpieczeństwa z przeglądu B1).
 *
 * Proxy (`src/proxy.ts`) blokuje trasy modułów zamrożonych — to pilnują
 * `frozen-modules.test.ts` i `proxy-frozen-modules.test.ts`. Ten plik
 * pilnuje, że trasy promocji złożonych, generowania obrazów, opinii, listy
 * salonów katalogu i ulubionych
 * odpowiadają 404 także SAME, gdy proxy zostanie ominięte: handler wołany
 * wprost nie sprawdza sesji ani planu, nie sięga do bazy i nie wywołuje modelu.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MODULE_DISABLED_CODE,
  MODULE_DISABLED_MESSAGE,
  frozenModuleForApiPath,
  type ModuleKey,
} from "@/lib/features";
import { createMockRequest } from "./helpers";

const {
  mockRequireProAI,
  mockRequireAuth,
  mockDbSelect,
  mockGenerateImage,
  mockGetSession,
  mockGetUserSalon,
  mockForSalon,
} = vi.hoisted(() => ({
  mockRequireProAI: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockDbSelect: vi.fn(),
  mockGenerateImage: vi.fn(),
  mockGetSession: vi.fn(),
  mockGetUserSalon: vi.fn(),
  mockForSalon: vi.fn(),
}));

vi.mock("@/lib/ai/openrouter", () => ({
  requireProAI: (...a: unknown[]) => mockRequireProAI(...a),
  isProAIError: () => false,
  createAIClient: vi.fn(),
  getAIModel: vi.fn(),
  getSalonContext: vi.fn(),
  trackAIUsage: vi.fn(),
}));
// Trasy opinii w panelu: sesja w handlerze, salon właściciela, repozytorium.
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...a: unknown[]) => mockGetSession(...a) } },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalon: (...a: unknown[]) => mockGetUserSalon(...a),
  getUserSalonId: (...a: unknown[]) => mockGetUserSalon(...a),
}));
vi.mock("@/lib/server/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/repository")>()),
  forSalon: (...a: unknown[]) => mockForSalon(...a),
}));
vi.mock("@/lib/ai/google-imagen", () => ({
  generateImage: (...a: unknown[]) => mockGenerateImage(...a),
  IMAGE_SIZES: {},
}));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
  isAuthError: () => false,
}));
vi.mock("@/lib/db", () => ({
  db: { select: (...a: unknown[]) => mockDbSelect(...a) },
}));
vi.mock("@/lib/storage", () => ({ upload: vi.fn() }));
// Lista salonów katalogu czyta bazę przez warstwę systemową.
vi.mock("@/lib/server/system", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/system")>()),
  listPublicSalonCatalog: (...a: unknown[]) => mockDbSelect(...a),
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

type Handler = (request: Request) => Promise<Response>;

const ROUTES: Array<[string, string, () => Promise<Handler>]> = [
  ["GET", "/api/promotions/check", async () => (await import("@/app/api/promotions/check/route")).GET],
  [
    "GET",
    "/api/promotions/check-happy-hours",
    async () => (await import("@/app/api/promotions/check-happy-hours/route")).GET,
  ],
  [
    "GET",
    "/api/promotions/check-package",
    async () => (await import("@/app/api/promotions/check-package/route")).GET,
  ],
  [
    "GET",
    "/api/promotions/check-first-visit",
    async () =>
      (await import("@/app/api/promotions/check-first-visit/route")).GET as unknown as Handler,
  ],
  [
    "POST",
    "/api/appointments/book-package",
    async () => (await import("@/app/api/appointments/book-package/route")).POST,
  ],
  ["POST", "/api/ai/image/generate", async () => (await import("@/app/api/ai/image/generate/route")).POST],
  ["POST", "/api/ai/image/banner", async () => (await import("@/app/api/ai/image/banner/route")).POST],
  [
    "POST",
    "/api/ai/image/service-illustration",
    async () => (await import("@/app/api/ai/image/service-illustration/route")).POST,
  ],
  // Opinie
  ["GET", "/api/reviews", async () => (await import("@/app/api/reviews/route")).GET],
  [
    "PATCH",
    "/api/reviews/x1/moderate",
    async () => (await import("@/app/api/reviews/[id]/moderate/route")).PATCH,
  ],
  [
    "PATCH",
    "/api/reviews/x1/respond",
    async () => (await import("@/app/api/reviews/[id]/respond/route")).PATCH,
  ],
  [
    "DELETE",
    "/api/reviews/x1/respond",
    async () => (await import("@/app/api/reviews/[id]/respond/route")).DELETE,
  ],
  [
    "GET",
    "/api/client/reviews",
    async () => (await import("@/app/api/client/reviews/route")).GET as unknown as Handler,
  ],
  [
    "GET",
    "/api/client/appointments/x1/review",
    async () =>
      (await import("@/app/api/client/appointments/[id]/review/route")).GET as unknown as Handler,
  ],
  [
    "POST",
    "/api/client/appointments/x1/review",
    async () =>
      (await import("@/app/api/client/appointments/[id]/review/route")).POST as unknown as Handler,
  ],
  [
    "POST",
    "/api/ai/content/generate-review-response",
    async () => (await import("@/app/api/ai/content/generate-review-response/route")).POST,
  ],
  [
    "GET",
    "/api/ai/business/review-alerts",
    async () => (await import("@/app/api/ai/business/review-alerts/route")).GET,
  ],
  // Katalog salonów (lista) i ulubione
  [
    "GET",
    "/api/salons",
    async () => (await import("@/app/api/salons/route")).GET as unknown as Handler,
  ],
  [
    "GET",
    "/api/favorites/salons",
    async () => (await import("@/app/api/favorites/salons/route")).GET as unknown as Handler,
  ],
  ["POST", "/api/favorites/salons", async () => (await import("@/app/api/favorites/salons/route")).POST],
  [
    "DELETE",
    "/api/favorites/salons",
    async () => (await import("@/app/api/favorites/salons/route")).DELETE,
  ],
  [
    "GET",
    "/api/favorites/salons/check",
    async () => (await import("@/app/api/favorites/salons/check/route")).GET,
  ],
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("trasy zamrożone odpowiadają 404 same, bez proxy", () => {
  it.each(ROUTES)("%s %s → 404 MODULE_DISABLED", async (method, path, load) => {
    const handler = await load();
    const url = `http://localhost:3000${path}?salonId=abc&email=a%40b.pl`;
    const response = await handler(
      createMockRequest(url, method === "GET" ? {} : { method, body: { prompt: "x" } })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      code: MODULE_DISABLED_CODE,
      error: MODULE_DISABLED_MESSAGE,
    });
    // Bramka stoi przed sesją, planem, bazą i modelem.
    expect(mockRequireAuth).not.toHaveBeenCalled();
    expect(mockRequireProAI).not.toHaveBeenCalled();
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockGenerateImage).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockGetUserSalon).not.toHaveBeenCalled();
    expect(mockForSalon).not.toHaveBeenCalled();
  });
});

/**
 * Moduły, których trasy mają mieć bramkę w samym handlerze. Nowa trasa
 * w katalogu tych modułów bez wywołania `frozenModuleResponse("<moduł>")`
 * w każdym eksportowanym handlerze = czerwono.
 */
const ROUTE_GUARDED_MODULES: ModuleKey[] = [
  "complexPromotions",
  "imageGen",
  "reviews",
  "salonCatalog",
  "favoriteSalons",
];

const API_DIR = join(process.cwd(), "src/app/api");

function listRouteFiles(dir: string = API_DIR): Array<{ file: string; path: string }> {
  const out: Array<{ file: string; path: string }> = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listRouteFiles(full));
    else if (name === "route.ts") {
      const rel = relative(API_DIR, dir).split(sep).join("/");
      out.push({ file: full, path: `/api/${rel}`.replace(/\[[^\]]+\]/g, "x1") });
    }
  }
  return out;
}

describe("każda trasa modułu z bramką w handlerze ją ma (system plików)", () => {
  const guarded = listRouteFiles()
    .map((r) => ({ ...r, module: frozenModuleForApiPath(r.path) }))
    .filter((r): r is typeof r & { module: ModuleKey } =>
      r.module !== null && ROUTE_GUARDED_MODULES.includes(r.module)
    );

  it("lista tras nie jest pusta (kontrola)", () => {
    // Jedna trasa może mieć kilka metod (PATCH i DELETE odpowiedzi salonu).
    expect(guarded.map((r) => r.path).sort()).toEqual(
      [...new Set(ROUTES.map(([, path]) => path))].sort()
    );
  });

  it.each(guarded.map((r) => [r.path, r] as const))("%s", (_path, route) => {
    const source = readFileSync(route.file, "utf8");
    const handlers = source.match(/^export async function \w+/gm) ?? [];
    const guards =
      source.match(new RegExp(`frozenModuleResponse\\("${route.module}"\\)`, "g")) ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    expect(guards.length, `${route.path}: handlery ${handlers.length}, bramki ${guards.length}`).toBe(
      handlers.length
    );
  });

  it("poprawianie zdjęć galerii (/api/ai/image/enhance) nie ma bramki", () => {
    const source = readFileSync(join(API_DIR, "ai/image/enhance/route.ts"), "utf8");
    expect(source).not.toMatch(/frozenModuleResponse/);
    expect(frozenModuleForApiPath("/api/ai/image/enhance")).toBeNull();
  });
});
