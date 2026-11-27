/**
 * Mapa strony i manifest PWA a zamrożony katalog salonów (`salonCatalog`).
 *
 * Lista salonów i strona dla klientów przekierowują na `/` — w mapie strony
 * ich nie ma, a aplikacja z ekranu głównego startuje na `/`. Dawne
 * `/dla-salonow` też przekierowuje, więc nie jest indeksowane.
 */
import { describe, it, expect } from "vitest";
import manifest from "@/app/manifest";
import sitemap from "@/app/sitemap";

const BASE = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

describe("sitemap", () => {
  const paths = sitemap().map((entry) => entry.url.slice(BASE.length) || "/");

  it("strona główna i cennik są w mapie strony", () => {
    expect(paths).toEqual(["/", "/pricing"]);
  });

  it.each(["/salons", "/dla-klientow", "/dla-salonow"])("%s nie jest w mapie strony", (path) => {
    expect(paths).not.toContain(path);
  });
});

describe("manifest", () => {
  it("start_url to strona główna, nie lista salonów", () => {
    expect(manifest().start_url).toBe("/");
  });
});
