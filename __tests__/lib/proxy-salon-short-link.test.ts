// @vitest-environment node
/**
 * Krótki adres salonu `/s/<slug>` w `src/proxy.ts` i rejestrze modułów.
 *
 * Klient trafia do salonu wyłącznie z linku albo przycisku na Instagramie
 * i Facebooku, często bez konta. Proxy ma przepuścić `/s/...` bez
 * sesji (bez przekierowania na logowanie) i bez blokady modułu zamrożonego
 * (katalog salonów `salonCatalog` obejmuje tylko listę `/salons`). O 404 dla
 * nieznanego adresu decyduje sama strona, nie proxy.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { frozenModuleForPath } from "@/lib/features";
import { proxy } from "@/proxy";

const ORIGIN = "http://localhost:3000";
const SESSION = "better-auth.session_token=test-session";
const PATHS = ["/s/beauty-studio-demo", "/s/salon-ada-2", "/s/nie-ma-takiego"];

function request(path: string, method: string, cookie?: string) {
  return new NextRequest(`${ORIGIN}${path}`, { method, headers: cookie ? { cookie } : {} });
}

/** Odpowiedź „przepuść dalej” z NextResponse.next(). */
function passedThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

describe("proxy: krótki adres salonu /s/<slug>", () => {
  describe.each(PATHS)("%s", (path) => {
    it.each(["GET", "HEAD"])("%s bez sesji → przepuszczone, bez przekierowania", async (method) => {
      const response = await proxy(request(path, method));

      expect(passedThrough(response)).toBe(true);
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    });

    it("GET z sesją → przepuszczone tak samo", async () => {
      const response = await proxy(request(path, "GET", SESSION));

      expect(passedThrough(response)).toBe(true);
      expect(response.headers.get("location")).toBeNull();
    });

    it("nie należy do modułu zamrożonego", () => {
      expect(frozenModuleForPath(path)).toBeNull();
    });
  });

  it("kontrola: lista salonów /salons nadal zamrożona (krótki adres jej nie odmraża)", () => {
    expect(frozenModuleForPath("/salons")).toEqual({ kind: "publicPage", module: "salonCatalog" });
  });

  it("strona salonu /salons/<id> (cel przekierowania) i rezerwacja nie są zamrożone", () => {
    expect(frozenModuleForPath("/salons/00000000-0000-4000-8000-000000000001")).toBeNull();
    expect(frozenModuleForPath("/salons/00000000-0000-4000-8000-000000000001/book")).toBeNull();
  });

  it("PUT /api/salons/<id>/slug bez tokenu CSRF → 403 (zmiana adresu chroniona jak inne zapisy)", async () => {
    const response = await proxy(request("/api/salons/00000000-0000-4000-8000-000000000001/slug", "PUT", SESSION));
    expect(response.status).toBe(403);
  });
});
