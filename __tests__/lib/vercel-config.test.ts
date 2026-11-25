/**
 * Konfiguracja Vercela (`vercel.json`) po przeniesieniu ruchu na domenę GCP.
 *
 * Pilnuje, że:
 * - jest dokładnie jedno przekierowanie, całej ścieżki na `app.nordsignal.cc`,
 *   i jest tymczasowe (`permanent: false`) — powrót ruchu na Vercela nie może
 *   walczyć z przekierowaniem zapamiętanym przez przeglądarki;
 * - zadania cron zostały bez zmian.
 *
 * Test czyta plik jako tekst — nie wdraża niczego.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

interface VercelRedirect {
  source: string;
  destination: string;
  permanent?: boolean;
  statusCode?: number;
  has?: unknown;
  missing?: unknown;
}

interface VercelConfig {
  redirects?: VercelRedirect[];
  crons?: { path: string; schedule: string }[];
}

const config = JSON.parse(
  readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
) as VercelConfig;

describe("vercel.json: przekierowanie na domenę GCP", () => {
  it("ma dokładnie jedno przekierowanie", () => {
    expect(config.redirects).toHaveLength(1);
  });

  it("przekierowuje każdą ścieżkę na app.nordsignal.cc tymczasowo", () => {
    expect(config.redirects?.[0]).toEqual({
      source: "/:path*",
      destination: "https://app.nordsignal.cc/:path*",
      permanent: false,
    });
  });

  it("przekierowanie nie ma warunku host — obejmuje wszystkie domeny projektu", () => {
    const [redirect] = config.redirects ?? [];
    expect(redirect?.has).toBeUndefined();
    expect(redirect?.missing).toBeUndefined();
  });
});

describe("vercel.json: zadania cron", () => {
  it("zostały bez zmian", () => {
    expect(config.crons).toEqual([
      { path: "/api/cron/cleanup-pending-deposits", schedule: "30 2 * * *" },
      { path: "/api/cron/cleanup-temporary-access", schedule: "0 3 * * *" },
    ]);
  });
});
