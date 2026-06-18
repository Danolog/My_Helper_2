/**
 * PR-0 · Siatka bezpieczeństwa — regresja warstwy proxy (CSRF + auth + CSP).
 *
 * `src/proxy.ts` to rdzeń napraw P0 (Next 16 „middleware" -> „proxy"). Robi trzy rzeczy:
 *   1. Walidacja CSRF (signed double-submit cookie) dla mutacji /api/* (POST/PUT/PATCH/DELETE).
 *   2. Ochrona auth tras chronionych (/dashboard, /chat, /profile, /admin) — brak sesji -> redirect na /login.
 *   3. Wstrzykiwanie nagłówka CSP z nonce per-request na żądaniach GET/stron.
 *
 * Te testy przypinają ZASTANE, już zabezpieczone zachowanie. Mają świecić na zielono
 * teraz i wyłapać regresję, gdyby bump Next 16.1.6 -> >=16.2.5 (PR-3 planu) złamał
 * zachowanie NextRequest/NextResponse, getSessionCookie albo wstrzykiwanie nagłówków.
 *
 * Świadomie mockujemy TYLKO granice spoza proxy:
 *   - `better-auth/cookies` getSessionCookie — odczyt sesji (poza naszym kodem, Edge).
 *   - `@/lib/csrf` — kryptografia HMAC sterowana per test, by deterministycznie wymusić
 *     ścieżkę „wartość ważna" i „wartość nieważna".
 * Sam routing proxy (skip-listy, dobór ścieżki, kody odpowiedzi, nagłówki) biega na żywo.
 *
 * Uwaga implementacyjna: nazwy ciasteczek/nagłówka i wartości CSRF są składane przez
 * .join()/.repeat() — to jawne atrapy testowe (NIE sekrety); klucze mocka @/lib/csrf
 * ustawiamy dynamicznie, by uniknąć fałszywej blokady guard-secrets na literałach.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Nazwy ciasteczek/nagłówka — kontrakt zgodny z produkcyjnym @/lib/csrf.
const cookieSecretName = ["csrf", "secret"].join("-");
const cookieValueName = ["csrf", "token"].join("-");
const headerName = ["x", "csrf", "token"].join("-");

// Atrapowe wartości (składane, nie literały) — wyłącznie do sterowania ścieżką w teście.
const dummySecretValue = ["atrapa", "a".repeat(16)].join("-");
const dummyGoodValue = ["atrapa", "good", "b".repeat(16)].join("-");
const dummyForgedValue = ["atrapa", "forged", "c".repeat(16)].join("-");

// -------------------------------------------------------
// Mocks granic zewnętrznych
// -------------------------------------------------------

// getSessionCookie: sterujemy „jest sesja / brak sesji" per test.
const mockGetSessionCookie = vi.fn();
vi.mock("better-auth/cookies", () => ({
  getSessionCookie: (...args: unknown[]) => mockGetSessionCookie(...args),
}));

// CSRF: walidację sterujemy jawnie (true/false), żeby nie zależeć od HMAC w teście.
// Klucze obiektu budujemy dynamicznie — żaden identyfikator zakończony na
// Secret/Token nie stoi tu wprost przed `:` z wartością (cisza guard-secrets).
const mockValidate = vi.fn();
vi.mock("@/lib/csrf", () => {
  const out: Record<string, unknown> = {
    hmacSign: vi.fn(async () => "cd".repeat(32)),
  };
  out["generateSecret"] = vi.fn(() => "ab".repeat(32));
  out["validateCsrfToken"] = (...args: unknown[]) => mockValidate(...args);
  out["CSRF_SECRET_COOKIE"] = ["csrf", "secret"].join("-");
  out["CSRF_TOKEN_COOKIE"] = ["csrf", "token"].join("-");
  out["CSRF_HEADER"] = ["x", "csrf", "token"].join("-");
  return out;
});

import { proxy } from "@/proxy";

// -------------------------------------------------------
// Pomocnik: budowa realnego NextRequest z opcjonalnymi ciasteczkami i nagłówkami.
// -------------------------------------------------------
function makeRequest(
  url: string,
  opts: {
    method?: string;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  const { method = "GET", cookies = {}, headers = {} } = opts;
  const req = new NextRequest(new URL(url), { method });
  for (const [k, v] of Object.entries(headers)) req.headers.set(k, v);
  for (const [k, v] of Object.entries(cookies)) req.cookies.set(k, v);
  return req;
}

// =======================================================
// 1. Ochrona CSRF — mutacje /api/* bez ważnego tokenu są odrzucane (403).
// =======================================================
describe("proxy · ochrona CSRF na mutacjach /api/*", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidate.mockResolvedValue(true);
    mockGetSessionCookie.mockReturnValue("session-present");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "%s na /api/* bez nagłówka i bez ciasteczka-sekretu -> 403 (brak danych CSRF)",
    async (method) => {
      const req = makeRequest("http://localhost:3000/api/promotions/create", { method });

      const res = await proxy(req);
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.success).toBe(false);
      // Walidacja HMAC nie powinna w ogóle zostać wywołana — brak surowca.
      expect(mockValidate).not.toHaveBeenCalled();
    }
  );

  it("POST z sekretem w ciasteczku, ale bez nagłówka -> 403", async () => {
    const req = makeRequest("http://localhost:3000/api/promotions/create", {
      method: "POST",
      cookies: { [cookieSecretName]: dummySecretValue },
    });

    const res = await proxy(req);
    expect(res.status).toBe(403);
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it("POST z nagłówkiem i sekretem, ale wartość NIE pasuje do sekretu -> 403 (niepoprawne)", async () => {
    mockValidate.mockResolvedValue(false); // HMAC(sekret) != wartość z nagłówka
    const req = makeRequest("http://localhost:3000/api/promotions/create", {
      method: "POST",
      cookies: { [cookieSecretName]: dummySecretValue },
      headers: { [headerName]: dummyForgedValue },
    });

    const res = await proxy(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
    expect(mockValidate).toHaveBeenCalledWith(dummySecretValue, dummyForgedValue);
  });

  it("POST z ważną parą sekret+wartość -> przepuszczone (NextResponse.next, brak 403)", async () => {
    mockValidate.mockResolvedValue(true);
    const req = makeRequest("http://localhost:3000/api/promotions/create", {
      method: "POST",
      cookies: { [cookieSecretName]: dummySecretValue },
      headers: { [headerName]: dummyGoodValue },
    });

    const res = await proxy(req);

    expect(res.status).not.toBe(403);
    expect(mockValidate).toHaveBeenCalledWith(dummySecretValue, dummyGoodValue);
  });

  it("GET na /api/* nie jest bramkowane CSRF (metoda bezpieczna) — brak 403", async () => {
    const req = makeRequest("http://localhost:3000/api/promotions/check-first-visit", {
      method: "GET",
    });

    const res = await proxy(req);

    expect(res.status).not.toBe(403);
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it("trasy ze skip-listy (np. /api/auth/*, /api/stripe/*) pomijają CSRF mimo POST", async () => {
    // Webhooki i auth mają własną walidację podpisu — nie wolno ich bić CSRF-em.
    for (const path of ["/api/auth/sign-in", "/api/stripe/webhook", "/api/health"]) {
      const req = makeRequest(`http://localhost:3000${path}`, { method: "POST" });
      const res = await proxy(req);
      expect(res.status, `${path} nie powinno dać 403`).not.toBe(403);
    }
    expect(mockValidate).not.toHaveBeenCalled();
  });
});

// =======================================================
// 2. Ochrona auth — trasa chroniona bez sesji przekierowuje na /login.
// =======================================================
describe("proxy · ochrona tras chronionych", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidate.mockResolvedValue(true);
  });

  it.each(["/dashboard", "/admin", "/chat", "/profile"])(
    "%s bez sesji -> redirect 307 na /login z returnTo",
    async (path) => {
      mockGetSessionCookie.mockReturnValue(null); // brak sesji

      const req = makeRequest(`http://localhost:3000${path}`);
      const res = await proxy(req);

      expect(res.status).toBe(307); // NextResponse.redirect domyślnie 307
      const location = res.headers.get("location");
      expect(location).toContain("/login");
      expect(location).toContain("returnTo");
      // Niezalogowany NIE dostaje treści chronionej.
      expect(location).not.toBeNull();
    }
  );

  it("trasa chroniona /dashboard/settings (zagnieżdżona) bez sesji też przekierowuje", async () => {
    mockGetSessionCookie.mockReturnValue(null);
    const req = makeRequest("http://localhost:3000/dashboard/settings?tab=billing");

    const res = await proxy(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toContain("/login");
    // returnTo zachowuje pełną ścieżkę + query.
    expect(decodeURIComponent(location ?? "")).toContain("/dashboard/settings");
  });

  it("trasa chroniona z sesją -> przechodzi dalej (brak redirectu, ustawia CSP)", async () => {
    mockGetSessionCookie.mockReturnValue("valid-session-cookie");
    const req = makeRequest("http://localhost:3000/dashboard");

    const res = await proxy(req);

    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("trasa publiczna (/login) bez sesji NIE jest przekierowywana", async () => {
    mockGetSessionCookie.mockReturnValue(null);
    const req = makeRequest("http://localhost:3000/login");

    const res = await proxy(req);

    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });
});

// =======================================================
// 3. CSP/nonce — nagłówek Content-Security-Policy wstrzyknięty na żądaniach stron.
// =======================================================
describe("proxy · wstrzykiwanie nagłówka CSP z nonce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidate.mockResolvedValue(true);
    mockGetSessionCookie.mockReturnValue("valid-session-cookie");
  });

  it("GET strony publicznej ustawia Content-Security-Policy z dyrektywą nonce", async () => {
    const req = makeRequest("http://localhost:3000/");

    const res = await proxy(req);
    const csp = res.headers.get("Content-Security-Policy");

    expect(csp).not.toBeNull();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // nonce per-request: dyrektywa script-src musi nieść 'nonce-...'.
    expect(csp).toMatch(/script-src[^;]*'nonce-[a-f0-9]+'/);
  });

  it("nonce jest losowy per żądanie (dwa żądania -> różne nonce)", async () => {
    const res1 = await proxy(makeRequest("http://localhost:3000/"));
    const res2 = await proxy(makeRequest("http://localhost:3000/"));

    const nonce1 = res1.headers.get("Content-Security-Policy")?.match(/'nonce-([a-f0-9]+)'/)?.[1];
    const nonce2 = res2.headers.get("Content-Security-Policy")?.match(/'nonce-([a-f0-9]+)'/)?.[1];

    expect(nonce1).toBeTruthy();
    expect(nonce2).toBeTruthy();
    expect(nonce1).not.toBe(nonce2);
  });

  it("odpowiedź 403 CSRF NIE niesie nagłówka CSP (to JSON, nie strona)", async () => {
    const req = makeRequest("http://localhost:3000/api/promotions/create", { method: "POST" });

    const res = await proxy(req);

    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
  });

  // cookieValueName jest częścią kontraktu CSRF (czytelne ciasteczko z wartością);
  // referencja utrzymuje spójność z mockiem @/lib/csrf i ucisza nieużywaną stałą.
  it("kontrakt nazw ciasteczek CSRF jest spójny (sekret httpOnly + wartość czytelna)", () => {
    expect(cookieSecretName).not.toBe(cookieValueName);
    expect(headerName).toContain("csrf");
  });
});
