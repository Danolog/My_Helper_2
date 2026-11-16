// @vitest-environment node
/**
 * #193 P0b, warunek 2 Ethana do testu adaptera: adapter ma jawny schemat
 * 4 tabel auth, więc PRODUKCYJNA konfiguracja Better Auth nie może mieć
 * wtyczki z modelem spoza tych tabel ani limitu żądań w tabeli bazy —
 * zepsułoby to logowanie na produkcji. (Wtyczka z `salons` żyje wyłącznie
 * w system-auth-adapter.test.ts.)
 */
import { describe, expect, it, vi } from "vitest";

const AUTH_TABLES = ["account", "session", "user", "verification"];

// Konfiguracja nie może dotknąć bazy: pula systemowa i surowe db to atrapy.
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: {} }));
vi.mock("@/lib/db", () => ({ db: {} }));

type AuthOptions = {
  plugins?: { id: string; schema?: Record<string, unknown> }[];
  rateLimit?: { storage?: string };
};

describe("produkcyjne auth.ts a jawny schemat adaptera", () => {
  it("modele wtyczek ⊆ 4 tabele auth", async () => {
    const { auth } = await import("@/lib/auth");
    const opts = auth.options as AuthOptions;
    const models = (opts.plugins ?? []).flatMap((p) => Object.keys(p.schema ?? {}).map((m) => `${p.id}:${m}`));
    expect(models.filter((m) => !AUTH_TABLES.includes(m.split(":")[1]!))).toEqual([]);
  });

  it("limit żądań nie w tabeli bazy (rateLimit.storage !== \"database\")", async () => {
    const { auth } = await import("@/lib/auth");
    expect((auth.options as AuthOptions).rateLimit?.storage).not.toBe("database");
  });
});
