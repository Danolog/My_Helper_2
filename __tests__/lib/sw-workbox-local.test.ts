// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Strażnik: service worker ładuje Workbox wyłącznie z własnego originu.
 *
 * workbox-sw.js doładowuje moduły leniwie (pierwszy odczyt `workbox.<moduł>`
 * robi importScripts). Bez `modulePathPrefix` sięga po swój wbudowany adres
 * CDN, a bez `debug: false` na localhost prosi o pliki .dev.js, których nie
 * dostarczamy. Brak pliku modułu = nieudana instalacja workera, bez błędu
 * widocznego na stronie — stąd testy statyczne poniżej.
 */

const PUBLIC_DIR = join(process.cwd(), "public");
const SW_SOURCE = readFileSync(join(PUBLIC_DIR, "sw.js"), "utf8");
const CDN_PATTERN = /workbox-cdn|storage\.googleapis\.com/;

function workboxPath(): string {
  const match = SW_SOURCE.match(/const WORKBOX_PATH = "([^"]+)";/);
  expect(match, "sw.js: brak stałej WORKBOX_PATH").not.toBeNull();
  return match![1]!;
}

/** Argumenty importScripts z rozwiniętym `${WORKBOX_PATH}`. */
function importedScripts(): string[] {
  const prefix = workboxPath();
  return [...SW_SOURCE.matchAll(/importScripts\(\s*([`"'])(.+?)\1\s*\)/g)].map((m) =>
    m[2]!.replace("${WORKBOX_PATH}", prefix),
  );
}

/** Moduły czytane z obiektu `workbox` (destrukturyzacja `const { … } = workbox;`). */
function usedModules(): string[] {
  const match = SW_SOURCE.match(/const \{([^}]+)\}\s*=\s*workbox;/);
  expect(match, "sw.js: brak destrukturyzacji modułów Workbox").not.toBeNull();
  return match![1]!
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

describe("sw.js — Workbox z własnego originu", () => {
  it("nie zawiera adresu CDN ani żadnego adresu http(s) w importScripts", () => {
    expect(SW_SOURCE).not.toMatch(CDN_PATTERN);
    const scripts = importedScripts();
    expect(scripts.length).toBeGreaterThan(0);
    for (const src of scripts) {
      expect(src, `importScripts spoza originu: ${src}`).toMatch(/^\/[^/]/);
    }
  });

  it("każdy plik z importScripts istnieje w public/", () => {
    for (const src of importedScripts()) {
      expect(existsSync(join(PUBLIC_DIR, src)), `brak public${src}`).toBe(true);
    }
  });

  it("setConfig z modulePathPrefix i debug: false stoi przed pierwszym odczytem modułu", () => {
    const setConfig = SW_SOURCE.indexOf(
      "workbox.setConfig({ modulePathPrefix: WORKBOX_PATH, debug: false });",
    );
    const firstModuleRead = SW_SOURCE.search(/=\s*workbox;|workbox\.(?!setConfig)[a-zA-Z]/);
    expect(setConfig).toBeGreaterThan(-1);
    expect(firstModuleRead).toBeGreaterThan(setConfig);
  });

  it("każdy używany moduł ma plik .prod.js w katalogu Workboxa", () => {
    const dir = join(PUBLIC_DIR, workboxPath());
    const modules = usedModules();
    expect(modules).toEqual(
      expect.arrayContaining(["routing", "strategies", "expiration", "cacheableResponse"]),
    );
    // workbox-core ładuje sam workbox-sw.js przy pierwszym module.
    for (const name of ["core", ...modules]) {
      const file = `workbox-${kebab(name)}.prod.js`;
      expect(existsSync(join(dir, file)), `brak ${file}`).toBe(true);
    }
  });
});

describe("public/workbox-v7.3.0 — pliki zewnętrzne bez zmian", () => {
  const dir = join(PUBLIC_DIR, "workbox-v7.3.0");
  const readme = readFileSync(join(dir, "README"), "utf8");
  const scripts = readdirSync(dir).filter((f) => f.endsWith(".js"));

  it("katalog zawiera licencję MIT i tylko pliki produkcyjne, bez map", () => {
    expect(readFileSync(join(dir, "LICENSE"), "utf8")).toContain("Permission is hereby granted");
    expect(readdirSync(dir).some((f) => f.endsWith(".map"))).toBe(false);
    for (const file of scripts) {
      expect(file === "workbox-sw.js" || file.endsWith(".prod.js"), file).toBe(true);
    }
  });

  it("suma sha256 każdego pliku zgadza się z README", () => {
    expect(scripts.length).toBe(6);
    for (const file of scripts) {
      const sum = createHash("sha256").update(readFileSync(join(dir, file))).digest("hex");
      expect(readme, `suma ${file} nie zgadza się z README`).toContain(`${sum}  ${file}`);
    }
  });

  it("adres CDN występuje tylko jako domyślna ścieżka w workbox-sw.js (nadpisana w sw.js)", () => {
    const withCdn = scripts.filter((f) => CDN_PATTERN.test(readFileSync(join(dir, f), "utf8")));
    expect(withCdn).toEqual(["workbox-sw.js"]);
  });
});
