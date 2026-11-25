// @vitest-environment node
/**
 * Strony dokumentów prawnych w `src/proxy.ts`.
 *
 * Proxy przekierowuje na logowanie tylko ścieżki chronione
 * (`/dashboard`, `/profile`, `/admin`). Strony prawne muszą przejść bez
 * sesji: o odpowiedzi (404 przed publikacją, 200 po niej) decyduje sama
 * strona, nie proxy. Ten sam wynik z sesją — bez różnicy ról.
 */
import { NextRequest } from "next/server";
import { describe, it, expect } from "vitest";
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_KEYS } from "@/lib/legal/documents";
import { proxy } from "@/proxy";

const ORIGIN = "http://localhost:3000";
const SESSION = "better-auth.session_token=test-session";
const HREFS = LEGAL_DOCUMENT_KEYS.map((key) => LEGAL_DOCUMENTS[key].href);

function request(path: string, method: string, cookie?: string) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: cookie ? { cookie } : {},
  });
}

/** Odpowiedź „przepuść dalej” z NextResponse.next(). */
function passedThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

describe("proxy: strony dokumentów prawnych", () => {
  it("kontrola: pięć ścieżek", () => {
    expect(HREFS).toHaveLength(5);
  });

  describe.each(HREFS)("%s", (href) => {
    it.each(["GET", "HEAD"])("%s bez sesji → przepuszczone, bez przekierowania na /login", async (method) => {
      const response = await proxy(request(href, method));

      expect(passedThrough(response)).toBe(true);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    });

    it("GET z sesją → przepuszczone tak samo", async () => {
      const response = await proxy(request(href, "GET", SESSION));

      expect(passedThrough(response)).toBe(true);
      expect(response.headers.get("location")).toBeNull();
    });

    it("z ukośnikiem na końcu bez sesji → bez przekierowania na /login", async () => {
      const response = await proxy(request(`${href}/`, "GET"));

      expect(response.headers.get("location") ?? "").not.toContain("/login");
    });
  });
});
