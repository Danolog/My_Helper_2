// @vitest-environment node
/**
 * Repozytorium jest publiczne: żaden plik śledzony przez git nie może zawierać
 * odwołania do lokalnego katalogu roboczego ani ścieżki bezwzględnej do
 * katalogu domowego (macOS i Linux). Jedyny wyjątek: `.gitignore` może
 * wymieniać katalog roboczy (żeby go ignorować).
 *
 * Wzorce są sklejane z części, żeby ten plik sam nie zawierał zakazanych
 * ciągów. Sprawdzany jest każdy śledzony wpis: pliki tekstowe (trafienie jako
 * `plik:linia`), pliki binarne — z bajtem zerowym w pierwszych 8 kB (trafienie
 * jako `plik (binarny)`) — oraz dowiązania symboliczne, dla których sprawdzany
 * jest napis celu dowiązania, a nie plik docelowy (trafienie jako
 * `plik (cel dowiązania)`). Pomijane są tylko wpisy nieistniejące w drzewie
 * roboczym (ENOENT) i katalogi (np. podmoduły); każdy inny błąd odczytu
 * kończy test błędem z nazwą pliku i kodem.
 */
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");

const WORKDIR_REF = ["scratch", "pad", "/"].join("");
const HOME_MAC = ["/", "Users", "/"].join("");
const HOME_LINUX = ["/", "home", "/"].join("");

interface Rule {
  name: string;
  needle: string;
  except: ReadonlySet<string>;
}

const RULES: Rule[] = [
  { name: "katalog roboczy", needle: WORKDIR_REF, except: new Set([".gitignore"]) },
  { name: "ścieżka domowa macOS", needle: HOME_MAC, except: new Set() },
  { name: "ścieżka domowa Linux", needle: HOME_LINUX, except: new Set() },
];

type EntryKind = "plik" | "dowiązanie";

interface Entry {
  file: string;
  kind: EntryKind;
  content: Buffer;
}

interface FsOps {
  lstat(path: string): { isSymbolicLink(): boolean; isDirectory(): boolean };
  readlink(path: string): string;
  readFile(path: string): Buffer;
}

const REAL_FS: FsOps = {
  lstat: (p) => lstatSync(p),
  readlink: (p) => readlinkSync(p, "utf8"),
  readFile: (p) => readFileSync(p),
};

const SKIPPED_CODES = new Set(["ENOENT", "EISDIR"]);

/**
 * Odczyt wpisu: dla dowiązania symbolicznego zwraca napis celu (pliku
 * docelowego nie czyta). `null` tylko dla wpisu nieistniejącego albo katalogu;
 * każdy inny błąd jest zgłaszany z nazwą pliku i kodem.
 */
function readEntry(file: string, root: string, fs: FsOps = REAL_FS): Entry | null {
  const path = join(root, file);
  try {
    const st = fs.lstat(path);
    if (st.isDirectory()) return null;
    if (st.isSymbolicLink()) {
      return { file, kind: "dowiązanie", content: Buffer.from(fs.readlink(path), "utf8") };
    }
    return { file, kind: "plik", content: fs.readFile(path) };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== undefined && SKIPPED_CODES.has(code)) return null;
    throw new Error(`${file}: błąd odczytu (${code ?? String(e)})`);
  }
}

/** Trafienia wzorca w jednym wpisie — bez dostępu do plików. */
function scanEntry(file: string, kind: EntryKind, content: Buffer, needle: string): string[] {
  if (!content.includes(needle)) return [];
  if (kind === "dowiązanie") return [`${file} (cel dowiązania)`];
  if (content.subarray(0, 8192).includes(0)) return [`${file} (binarny)`];
  const out: string[] = [];
  content
    .toString("utf8")
    .split("\n")
    .forEach((line, i) => {
      if (line.includes(needle)) out.push(`${file}:${i + 1}`);
    });
  return out;
}

function trackedFiles(): string[] {
  const r = spawnSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ls-files: kod ${r.status}`);
  return r.stdout.split("\0").filter(Boolean);
}

const files = trackedFiles();
const entries: Entry[] = [];
const skipped: string[] = [];
for (const f of files) {
  const entry = readEntry(f, REPO_ROOT);
  if (entry === null) skipped.push(f);
  else entries.push(entry);
}

function hits(rule: Rule): string[] {
  return entries
    .filter((e) => !rule.except.has(e.file))
    .flatMap((e) => scanEntry(e.file, e.kind, e.content, rule.needle));
}

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe("wykrywanie wzorca w pojedynczym wpisie", () => {
  it("plik tekstowy: trafienie jako plik:linia", () => {
    const content = Buffer.from(`a\nb ${WORKDIR_REF}x\nc\n${WORKDIR_REF}\n`, "utf8");
    expect(scanEntry("a.md", "plik", content, WORKDIR_REF)).toEqual(["a.md:2", "a.md:4"]);
  });

  it("plik binarny z wzorcem: trafienie z dopiskiem (binarny)", () => {
    const content = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
      Buffer.from(`${HOME_MAC}u/x.png`, "utf8"),
      Buffer.from([0x00]),
    ]);
    expect(scanEntry("img.png", "plik", content, HOME_MAC)).toEqual(["img.png (binarny)"]);
  });

  it("plik binarny bez wzorca: brak trafień", () => {
    const content = Buffer.from([0x00, 0x01, 0x02]);
    expect(scanEntry("img.png", "plik", content, HOME_MAC)).toEqual([]);
  });

  it("cel dowiązania z wzorcem: trafienie z dopiskiem (cel dowiązania)", () => {
    const content = Buffer.from(`${HOME_LINUX}u/plik`, "utf8");
    expect(scanEntry("link", "dowiązanie", content, HOME_LINUX)).toEqual(["link (cel dowiązania)"]);
  });
});

describe("odczyt wpisu", () => {
  const regular = { isSymbolicLink: () => false, isDirectory: () => false };
  const symlink = { isSymbolicLink: () => true, isDirectory: () => false };
  const directory = { isSymbolicLink: () => false, isDirectory: () => true };
  const unreachable = () => {
    throw new Error("nieoczekiwane wywołanie");
  };

  it("dowiązanie: sprawdzany jest cel, plik docelowy nie jest czytany", () => {
    const fs: FsOps = {
      lstat: () => symlink,
      readlink: () => `${WORKDIR_REF}cel`,
      readFile: unreachable,
    };
    const entry = readEntry("link", "/r", fs);
    expect(entry?.kind).toBe("dowiązanie");
    expect(scanEntry("link", entry!.kind, entry!.content, WORKDIR_REF)).toEqual([
      "link (cel dowiązania)",
    ]);
  });

  it("dowiązanie do nieistniejącego celu: cel nadal sprawdzany", () => {
    const fs: FsOps = {
      lstat: () => symlink,
      readlink: () => `${HOME_MAC}u/brak`,
      readFile: () => {
        throw errnoError("ENOENT");
      },
    };
    const entry = readEntry("link", "/r", fs);
    expect(entry).not.toBeNull();
    expect(scanEntry("link", entry!.kind, entry!.content, HOME_MAC)).toEqual([
      "link (cel dowiązania)",
    ]);
  });

  it("plik zwykły: czytana jest zawartość", () => {
    const fs: FsOps = {
      lstat: () => regular,
      readlink: unreachable,
      readFile: () => Buffer.from("tekst", "utf8"),
    };
    expect(readEntry("a.txt", "/r", fs)).toEqual({
      file: "a.txt",
      kind: "plik",
      content: Buffer.from("tekst", "utf8"),
    });
  });

  it("katalog, ENOENT i EISDIR: wpis pominięty", () => {
    const dir: FsOps = { lstat: () => directory, readlink: unreachable, readFile: unreachable };
    expect(readEntry("sub", "/r", dir)).toBeNull();
    for (const code of ["ENOENT", "EISDIR"]) {
      const fs: FsOps = {
        lstat: () => {
          throw errnoError(code);
        },
        readlink: unreachable,
        readFile: unreachable,
      };
      expect(readEntry("x", "/r", fs)).toBeNull();
    }
  });

  it("inny błąd odczytu (EACCES): wyjątek z nazwą pliku i kodem", () => {
    const fs: FsOps = {
      lstat: () => regular,
      readlink: unreachable,
      readFile: () => {
        throw errnoError("EACCES");
      },
    };
    expect(() => readEntry("tajny.txt", "/r", fs)).toThrow("tajny.txt: błąd odczytu (EACCES)");
  });
});

describe("pliki śledzone bez ścieżek roboczych i bezwzględnych", () => {
  it("przegląda każdy śledzony wpis z całego repozytorium, w tym dokumentację", () => {
    expect(skipped, `pominięte wpisy:\n${skipped.join("\n")}`).toEqual([]);
    expect(entries.length).toBe(files.length - skipped.length);
    expect(entries.length).toBeGreaterThan(100);
    const names = new Set(entries.map((e) => e.file));
    expect([...names].some((f) => f.startsWith("docs/") && f.endsWith(".md"))).toBe(true);
    expect(names.has("package.json")).toBe(true);
  });

  for (const rule of RULES) {
    it(`brak: ${rule.name}`, () => {
      const found = hits(rule);
      expect(found, `${rule.name} w plikach:\n${found.join("\n")}`).toEqual([]);
    });
  }
});
