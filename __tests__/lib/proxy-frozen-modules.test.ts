// @vitest-environment node
/**
 * Strażnik egzekucji zamrożenia w `src/proxy.ts` (krok B1).
 *
 * Proxy to kod Next.js wykonywany przed każdą stroną i każdym endpointem.
 * Dla modułu zamrożonego (`hardOff` w `src/lib/features.ts`):
 * - trasa API → 404 z kodem `MODULE_DISABLED`, dla KAŻDEJ metody HTTP
 *   i zanim zadziała kontrola CSRF,
 * - strona panelu → przekierowanie na `/dashboard`.
 * Trasy i strony sąsiednie przechodzą bez zmian.
 *
 * Lista ścieżek pochodzi z rejestru (`API_MODULE_PATTERNS`) — test nie ma
 * własnej listy modułów, dopasowuje wzorce do tras z systemu plików.
 */
import { NextRequest } from "next/server";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it, expect } from "vitest";
import {
  API_MODULE_PATTERNS,
  MODULE_DISABLED_CODE,
  MODULE_DISABLED_MESSAGE,
  ROUTE_MODULE_MAP,
  isModuleFrozen,
} from "@/lib/features";
import { proxy } from "@/proxy";

const ORIGIN = "http://localhost:3000";
const API_DIR = join(process.cwd(), "src/app/api");
const METHODS = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"] as const;

function listApiRoutes(dir: string = API_DIR): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listApiRoutes(full));
    } else if (name === "route.ts") {
      const rel = relative(API_DIR, dir).split(sep).join("/");
      out.push(`/api/${rel}`.replace(/\[[^\]]+\]/g, "x1"));
    }
  }
  return out.sort();
}

const ALL_ROUTES = listApiRoutes();
const FROZEN_ROUTES = ALL_ROUTES.filter((route) =>
  API_MODULE_PATTERNS.some((p) => isModuleFrozen(p.module) && p.pattern.test(route))
);
const FROZEN_PAGES = ROUTE_MODULE_MAP.filter((e) => isModuleFrozen(e.module)).map(
  (e) => e.prefix
);

function request(path: string, method: string = "GET", cookie?: string) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: cookie ? { cookie } : {},
  });
}

const SESSION = "better-auth.session_token=test-session";

/**
 * Żądanie z DOKŁADNIE taką ścieżką, jaką podano — bez parsera URL, który
 * sam usuwa segmenty `.` i `..`. Proxy nie może polegać na tym, że ktoś
 * wcześniej ścieżkę uporządkował.
 */
function rawRequest(pathname: string, method: string = "GET"): NextRequest {
  return {
    nextUrl: { pathname, search: "" },
    url: `${ORIGIN}/`,
    method,
    headers: new Headers(),
    cookies: { get: () => undefined, has: () => false },
  } as unknown as NextRequest;
}

/** Odpowiedź „przepuść dalej” z NextResponse.next(). */
function passedThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

describe("proxy: trasy API modułów zamrożonych", () => {
  it("rejestr wskazuje trasy do zamrożenia (kontrola, że test nie jest pusty)", () => {
    expect(FROZEN_ROUTES.length).toBeGreaterThanOrEqual(44);
    expect(FROZEN_ROUTES).toContain("/api/ai/voice/incoming");
    expect(FROZEN_ROUTES).toContain("/api/ai/video/generate");
    expect(FROZEN_ROUTES).toContain("/api/scheduled-posts");
    expect(FROZEN_ROUTES).toContain("/api/salons/x1/fiscal-settings");
    expect(FROZEN_ROUTES).toContain("/api/push/subscribe");
    expect(FROZEN_ROUTES).toContain("/api/push/unsubscribe");
    expect(FROZEN_ROUTES).toContain("/api/push/test");
    expect(FROZEN_ROUTES).toContain("/api/cron/push-reminders");
    expect(FROZEN_ROUTES).toContain("/api/cron/push-reminders-24h");
    expect(FROZEN_ROUTES).toContain("/api/invoices");
    expect(FROZEN_ROUTES).toContain("/api/clients/x1/loyalty/redeem");
    expect(FROZEN_ROUTES).toContain("/api/newsletters/x1/send");
    expect(FROZEN_ROUTES).toContain("/api/notifications/birthday");
    expect(FROZEN_ROUTES).toContain("/api/notifications/we-miss-you");
    expect(FROZEN_ROUTES).toContain("/api/ai/notifications/personalize");
  });

  describe.each(FROZEN_ROUTES)("%s", (route) => {
    it.each(METHODS)("%s → 404 MODULE_DISABLED", async (method) => {
      const response = await proxy(request(route, method, SESSION));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        success: false,
        code: MODULE_DISABLED_CODE,
        error: MODULE_DISABLED_MESSAGE,
      });
    });
  });

  it("blokada działa przed kontrolą CSRF (POST bez tokenu → 404, nie 403)", async () => {
    const response = await proxy(request("/api/invoices", "POST"));
    expect(response.status).toBe(404);
  });

  it.each([
    "/api/invoices/",
    "/api/invoices?salonId=abc",
    "/api/invoices/abc/send-email/?x=1",
    "/api//invoices",
    "/api/%69nvoices",
    "/API/Invoices",
    "/Api/invoices/abc",
    "/api/notifications/birthday?salonId=abc",
  ])("wariant zapisu ścieżki %s → 404", async (path) => {
    const response = await proxy(request(path, "GET", SESSION));
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe(MODULE_DISABLED_CODE);
  });

  // Możliwe obejście (przegląd bezpieczeństwa): ścieżka zapisana inaczej niż
  // w rejestrze. Każdy wariant ma dostać tę samą blokadę co postać kanoniczna.
  it.each([
    "//api/invoices",
    "/api//clients//abc//loyalty",
    "/api/./invoices",
    "/api/x/../invoices",
    "/api/x/y/../../invoices/abc/send-email",
    "/api/clients/abc/x/../loyalty/redeem",
    "/%61pi/invoices",
    "/api/%6Eewsletters",
    "/api/%70ush/subscribe",
    "/API/Clients/abc/Loyalty/",
  ])("surowa ścieżka %s → 404 MODULE_DISABLED (każda metoda)", async (path) => {
    for (const method of METHODS) {
      const response = await proxy(rawRequest(path, method));
      expect(response.status, `${method} ${path}`).toBe(404);
      expect((await response.json()).code).toBe(MODULE_DISABLED_CODE);
    }
  });

  it.each([
    "//dashboard/invoices",
    "/dashboard/./invoices",
    "/dashboard/x/../invoices/abc",
    "/x/../dashboard/content-generator/newsletters",
    "/Dashboard/%69nvoices/",
  ])("surowa ścieżka strony %s → przekierowanie na /dashboard", async (path) => {
    const response = await proxy(rawRequest(path));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  it.each([
    "/api/invoices/../clients",
    "/api/clients/abc/loyalty/../appointments",
  ])("surowa ścieżka %s wychodzi z modułu zamrożonego — nie jest blokowana", async (path) => {
    const response = await proxy(rawRequest(path));
    expect(response.status).not.toBe(404);
  });

  it("komunikat blokady to tekst uzgodniony z produktem", () => {
    expect(MODULE_DISABLED_MESSAGE).toBe("Ta funkcja jest obecnie niedostępna.");
    expect(MODULE_DISABLED_CODE).toBe("MODULE_DISABLED");
  });
});

describe("proxy: ścieżka dwuznaczna jest odrzucana z góry", () => {
  // Zakodowany separator, zakodowana kropka, podwójne albo błędne kodowanie:
  // router i bramka mogłyby przeczytać taką ścieżkę różnie, więc nie
  // zgadujemy — 404, zanim zadziała cokolwiek innego (także dla tras
  // niezamrożonych). Aplikacja nie ma poprawnych ścieżek tego rodzaju.
  const ambiguous = [
    // do zamrożonego modułu
    "/api/x/..%2finvoices",
    "/api/x/..%2Finvoices",
    "/api%2finvoices",
    "/api%2Finvoices",
    "/api%5cinvoices",
    "/api/x/..%5cinvoices",
    "/api\\invoices",
    "/api/x/%2e%2e/invoices",
    "/api/%2e/notifications/birthday",
    "/api%252finvoices",
    "/api/x/%252e%252e/invoices",
    "/api/%2569nvoices",
    "/api/%69nvoices/%zz",
    "/api/invoices%00",
    "/dashboard%2Finvoices",
    "/dashboard/x/%2e%2e/settings/loyalty",
    // do tras niezamrożonych — ta sama odmowa
    "/api%2Fclients",
    "/api/cron/..%2fclients",
    "/api/auth/%2e%2e/clients",
    "/dashboard%2Fclients",
    "/api/%zz",
    "/api/clients%",
    "/salons/%C5",
    // po jednym dekodowaniu nadal jest znak procentu
    "/api/search/100%25",
    "/salons/a%25b",
  ];

  it.each(ambiguous)("%s → 404 INVALID_PATH (każda metoda)", async (path) => {
    for (const method of METHODS) {
      const response = await proxy(rawRequest(path, method));
      expect(response.status, `${method} ${path}`).toBe(404);
      expect((await response.json()).code, `${method} ${path}`).toBe("INVALID_PATH");
    }
  });

  it("odmowa działa przed kontrolą CSRF i auth", async () => {
    // POST bez tokenu CSRF dostałby 403, strona panelu bez sesji — logowanie.
    expect((await proxy(rawRequest("/api%2Fclients", "POST"))).status).toBe(404);
    expect((await proxy(rawRequest("/dashboard%2Fclients"))).status).toBe(404);
  });

  it.each([
    "/api/clients",
    "/api/clients/x1",
    "/api/clients/%C5%82ukasz",
    "/api/clients/Jan%20Kowalski",
    "/api/salons/%C5%BB%C3%B3%C5%82ty",
    "/api/%68ealth",
  ])("poprawna ścieżka API %s przechodzi dalej", async (path) => {
    const response = await proxy(request(path, "GET", SESSION));
    expect(response.status).toBe(200);
    expect(passedThrough(response)).toBe(true);
  });

  it.each([
    "/salons/%C5%82ukasz",
    "/salons/Salon%20Pi%C4%99kna",
    "/dashboard/clients/abc%2Ddef",
  ])("poprawna strona %s przechodzi dalej", async (path) => {
    const response = await proxy(request(path, "GET", SESSION));
    expect(response.status).toBe(200);
    expect(passedThrough(response)).toBe(true);
  });
});

describe("proxy: trasy sąsiednie przechodzą", () => {
  const neighbours = [
    "/api/clients",
    "/api/clients/x1",
    "/api/notifications",
    "/api/notifications/low-stock",
    "/api/cron/sms-reminders",
    "/api/cron/cleanup-pending-deposits",
    "/api/salons/x1/notification-type-settings",
    "/api/salons/x1/modules",
    "/api/appointments/x1/complete",
    "/api/ai/image/enhance",
    "/api/subscription-plans",
  ];

  it("trasy sąsiednie istnieją w repo (kontrola listy)", () => {
    for (const route of neighbours) {
      expect(ALL_ROUTES, route).toContain(route);
    }
  });

  it.each(neighbours)("GET %s nie jest blokowane", async (route) => {
    const response = await proxy(request(route, "GET", SESSION));
    expect(response.status).toBe(200);
    expect(passedThrough(response)).toBe(true);
  });

  it("żadna trasa spoza rejestru nie dostaje MODULE_DISABLED", async () => {
    const open = ALL_ROUTES.filter((route) => !FROZEN_ROUTES.includes(route));
    expect(open.length).toBeGreaterThan(100);
    for (const route of open) {
      const response = await proxy(request(route, "GET", SESSION));
      expect(response.status, route).not.toBe(404);
    }
  });

  it("POST na trasę sąsiednią nadal podlega CSRF (403 bez tokenu)", async () => {
    const response = await proxy(request("/api/clients", "POST", SESSION));
    expect(response.status).toBe(403);
  });
});

describe("proxy: strony panelu modułów zamrożonych", () => {
  it("rejestr wskazuje strony do zamrożenia (kontrola, że test nie jest pusty)", () => {
    expect(FROZEN_PAGES).toEqual(
      expect.arrayContaining([
        "/dashboard/invoices",
        "/dashboard/settings/loyalty",
        "/dashboard/content-generator/newsletters",
      ])
    );
  });

  it.each(FROZEN_PAGES)("%s → przekierowanie na /dashboard", async (page) => {
    const response = await proxy(request(page, "GET", SESSION));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  it.each([
    "/dashboard/invoices/abc-123",
    "/dashboard/invoices?status=paid",
    "/dashboard/invoices/",
    "/Dashboard/Invoices",
    "/dashboard/settings/loyalty?tab=rewards",
  ])("podstrona i parametry: %s → /dashboard", async (path) => {
    const response = await proxy(request(path, "GET", SESSION));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("bez sesji też nie pokazuje strony zamrożonej (przekierowanie)", async () => {
    const response = await proxy(request("/dashboard/invoices"));
    expect(response.status).toBe(307);
  });

  it.each([
    "/dashboard",
    "/dashboard/clients",
    "/dashboard/notifications",
    "/dashboard/settings/notifications",
    "/dashboard/products",
    "/dashboard/promotions",
  ])("strona %s z sesją przechodzi", async (path) => {
    const response = await proxy(request(path, "GET", SESSION));

    expect(response.status).toBe(200);
    expect(passedThrough(response)).toBe(true);
  });

  it("strona rdzenia bez sesji nadal prowadzi do logowania", async () => {
    const response = await proxy(request("/dashboard/clients"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login?returnTo=");
  });
});
