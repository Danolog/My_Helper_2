// @vitest-environment node
/**
 * next.config.ts — zasobnik GCS w `images.remotePatterns` (K-4, #116 pkt 2).
 *
 * `remotePatterns` znają tylko `storage.googleapis.com/<bucket>/**`.
 * `GCS_PUBLIC_BASE_URL` z innym hostem dałby adresy, których `next/image`
 * nie przepuści (obrazy cicho przestają się wyświetlać), więc budowa ma się
 * przerwać. Niepoprawna konfiguracja GCS też przerywa budowę.
 * Konfiguracja liczy się przy imporcie — każdy przypadek ładuje moduł od nowa.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadNextConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of ["GCS_BUCKET", "GCS_PUBLIC_BASE_URL", "STORAGE_DRIVER"]) {
    vi.stubEnv(key, env[key]);
  }
  return (await import("../../next.config")).default;
}

function gcsPatterns(config: Awaited<ReturnType<typeof loadNextConfig>>) {
  return (config.images?.remotePatterns ?? []).filter(
    (p) => typeof p === "object" && "hostname" in p && String(p.hostname).includes("googleapis"),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config — GCS w images.remotePatterns (#116 pkt 2)", () => {
  it("bez GCS_BUCKET: brak wpisu GCS, budowa przechodzi", async () => {
    expect(gcsPatterns(await loadNextConfig({}))).toEqual([]);
  });

  it("GCS_BUCKET bez GCS_PUBLIC_BASE_URL: dokładnie jeden wpis zawężony do zasobnika", async () => {
    expect(gcsPatterns(await loadNextConfig({ GCS_BUCKET: "mh-media" }))).toEqual([
      { protocol: "https", hostname: "storage.googleapis.com", pathname: "/mh-media/**" },
    ]);
  });

  it.each(["https://storage.googleapis.com/mh-media", "https://storage.googleapis.com/mh-media/"])(
    "GCS_PUBLIC_BASE_URL na storage.googleapis.com (%s): budowa przechodzi, wpis bez zmian",
    async (base) => {
      expect(gcsPatterns(await loadNextConfig({ GCS_BUCKET: "mh-media", GCS_PUBLIC_BASE_URL: base }))).toEqual([
        { protocol: "https", hostname: "storage.googleapis.com", pathname: "/mh-media/**" },
      ]);
    },
  );

  it.each([
    "https://media.example.pl/mh-media",
    "https://cdn.mojsalon.pl/mh-media/",
    "https://storage.googleapis.com.evil.pl/mh-media",
    "https://www.googleapis.com/mh-media",
    "https://evilgoogleapis.com/mh-media",
  ])(
    "GCS_PUBLIC_BASE_URL z innym hostem (%s): budowa się przerywa, bez wartości w komunikacie",
    async (base) => {
      const load = loadNextConfig({ GCS_BUCKET: "mh-media", GCS_PUBLIC_BASE_URL: base });
      await expect(load).rejects.toThrow(/host other than storage\.googleapis\.com is not supported/);
      const message = await load.then(
        () => "",
        (e: unknown) => String(e instanceof Error ? e.message : e),
      );
      expect(message).not.toContain(new URL(base).hostname);
    },
  );

  it.each([
    ["obcy zasobnik w ścieżce", { GCS_BUCKET: "mh-media", GCS_PUBLIC_BASE_URL: "https://storage.googleapis.com/evil" }],
    ["http zamiast https", { GCS_BUCKET: "mh-media", GCS_PUBLIC_BASE_URL: "http://storage.googleapis.com/mh-media" }],
    ["wirtualny host zasobnika", { GCS_BUCKET: "mh-media", GCS_PUBLIC_BASE_URL: "https://mh-media.storage.googleapis.com/mh-media" }],
    ["niepoprawna nazwa zasobnika", { GCS_BUCKET: "MH_Media!" }],
  ])("niepoprawna konfiguracja GCS (%s): budowa się przerywa", async (_label, env) => {
    await expect(loadNextConfig(env)).rejects.toThrow(/GCS_(BUCKET|PUBLIC_BASE_URL)/);
  });

  it("GCS_PUBLIC_BASE_URL bez GCS_BUCKET: GCS wyłączony, brak wpisu i budowa przechodzi", async () => {
    expect(gcsPatterns(await loadNextConfig({ GCS_PUBLIC_BASE_URL: "https://media.example.pl/mh-media" }))).toEqual([]);
  });
});
