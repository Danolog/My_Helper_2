// @vitest-environment node
/**
 * #260: strażnik wyjątków audytu zależności (`pnpm.auditConfig.ignoreGhsas`).
 *
 * Każdy wyjątek audytu ma uzasadnienie i termin. Lista wyjątków jest dziś pusta.
 * Reguły:
 *  1. Lista `ignoreGhsas` jest równa zamkniętej liście EXPECTED niżej —
 *     dopisanie wyjątku wymaga zmiany tego testu. Przy pustej liście oczekiwanej
 *     brak sekcji `pnpm.auditConfig` albo brak `ignoreGhsas` jest zgodny
 *     z oczekiwaniem, podobnie jak `ignoreGhsas: []`.
 *  2. Każdy identyfikator ma dokładnie jeden wpis w tablicy `"//"` package.json:
 *     `pnpm.auditConfig.ignoreGhsas <GHSA>: …`, z numerem zgłoszenia (`#<liczba>`)
 *     i datą `Przegląd do RRRR-MM-DD`.
 *  3. Data przeglądu nie minęła (UTC; w dniu przeglądu jeszcze zielono).
 *  4. Brak wpisów `"//"` o `ignoreGhsas` bez pozycji na liście.
 *  5. `pnpm.auditConfig` nie ma innych kluczy niż `ignoreGhsas`.
 * Testy kontrolne niżej pokazują, że każda reguła łapie podrzucone naruszenie.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

/** Zamknięta lista wyjątków. Zmiana = nowy wpis w `"//"` z uzasadnieniem, zgłoszeniem i datą przeglądu. */
const EXPECTED: string[] = [];

const NOTE_PREFIX = "pnpm.auditConfig.ignoreGhsas ";

export type Kind = "lista" | "wpis" | "termin" | "sierota" | "klucze";
export type Violation = { kind: Kind; message: string };

/** Poprawna data kalendarzowa RRRR-MM-DD (np. 2026-02-30 odpada). */
function isCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Dzisiejsza data w UTC jako RRRR-MM-DD. */
export const todayUtc = (now: Date = new Date()) => now.toISOString().slice(0, 10);

/**
 * Sprawdza reguły 1–5 na obiekcie package.json.
 * `today` w formacie RRRR-MM-DD (UTC).
 */
export function findAuditExceptionViolations(pkg: unknown, expected: string[], today: string): Violation[] {
  const out: Violation[] = [];
  const p = (pkg ?? {}) as { "//"?: unknown; pnpm?: { auditConfig?: unknown } };
  const auditConfig = p.pnpm?.auditConfig as Record<string, unknown> | undefined;
  const rawList = auditConfig?.ignoreGhsas;
  const list = Array.isArray(rawList) ? rawList.map(String) : [];

  // 1. Lista równa zamkniętej liście oczekiwanej.
  const listOk =
    expected.length === 0
      ? rawList === undefined || (Array.isArray(rawList) && list.length === 0)
      : Array.isArray(rawList) && JSON.stringify(list) === JSON.stringify(expected);
  if (!listOk) {
    out.push({
      kind: "lista",
      message: `pnpm.auditConfig.ignoreGhsas = ${JSON.stringify(rawList)}, oczekiwano ${JSON.stringify(expected)} — nowy wyjątek wymaga zmiany listy EXPECTED w tym teście`,
    });
  }

  // 5. Tylko klucz ignoreGhsas.
  if (auditConfig && typeof auditConfig === "object") {
    const extra = Object.keys(auditConfig).filter((k) => k !== "ignoreGhsas");
    if (extra.length > 0) {
      out.push({ kind: "klucze", message: `pnpm.auditConfig ma niedozwolone klucze: ${extra.join(", ")} — dozwolony tylko ignoreGhsas` });
    }
  }

  const notes = (Array.isArray(p["//"]) ? p["//"] : []).filter((n): n is string => typeof n === "string");
  const ghsaNotes = notes.filter((n) => n.includes("ignoreGhsas"));
  const noteId = (n: string) => (n.startsWith(NOTE_PREFIX) ? /^(\S+):/.exec(n.slice(NOTE_PREFIX.length))?.[1] : undefined);

  // 2–3. Każdy identyfikator: dokładnie jeden wpis, zgłoszenie, data przeglądu, termin.
  for (const id of new Set(list)) {
    const own = ghsaNotes.filter((n) => noteId(n) === id);
    if (own.length !== 1) {
      out.push({ kind: "wpis", message: `${id}: ${own.length} wpisów w "//" (wymagany dokładnie jeden, zaczynający się od "${NOTE_PREFIX}${id}:")` });
      continue;
    }
    const note = own[0]!;
    if (!/#\d+\b/.test(note)) out.push({ kind: "wpis", message: `${id}: wpis w "//" bez numeru zgłoszenia (#<liczba>)` });
    const date = /Przegląd do (\S+?)\.?(?:\s|$)/.exec(note)?.[1];
    if (!date) {
      out.push({ kind: "wpis", message: `${id}: wpis w "//" bez daty "Przegląd do RRRR-MM-DD"` });
    } else if (!isCalendarDate(date)) {
      out.push({ kind: "wpis", message: `${id}: "Przegląd do ${date}" — to nie jest poprawna data RRRR-MM-DD` });
    } else if (today > date) {
      out.push({
        kind: "termin",
        message: `${id}: termin przeglądu ${date} minął (dziś ${today} UTC) — przejrzyj wyjątek: usuń go (podnieś wersję pakietu i skasuj wpis) albo przedłuż z nową datą i nowym uzasadnieniem`,
      });
    }
  }

  // 4. Wpisy osierocone.
  for (const n of ghsaNotes) {
    const id = noteId(n);
    if (!id || !list.includes(id)) {
      out.push({ kind: "sierota", message: `wpis w "//" bez pozycji na liście ignoreGhsas: ${n.slice(0, 80)}` });
    }
  }
  return out;
}

const readPkg = () => JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as Record<string, unknown>;
const of = (v: Violation[], kind: Kind) => v.filter((x) => x.kind === kind).map((x) => x.message);

describe("#260 strażnik: wyjątki audytu zależności", () => {
  const v = findAuditExceptionViolations(readPkg(), EXPECTED, todayUtc());

  it("lista ignoreGhsas równa zamkniętej liście oczekiwanej", () => {
    expect(of(v, "lista")).toEqual([]);
  });

  it("każdy wyjątek ma dokładnie jeden wpis w \"//\" z numerem zgłoszenia i datą przeglądu", () => {
    expect(of(v, "wpis")).toEqual([]);
  });

  it("termin przeglądu wyjątku nie minął", () => {
    expect(of(v, "termin")).toEqual([]);
  });

  it("brak osieroconych wpisów \"//\" o ignoreGhsas", () => {
    expect(of(v, "sierota")).toEqual([]);
  });

  it("pnpm.auditConfig ma tylko klucz ignoreGhsas", () => {
    expect(of(v, "klucze")).toEqual([]);
  });
});

describe("#260 strażnik — testy kontrolne (podrzucone naruszenia są łapane)", () => {
  const ID = "GHSA-aaaa-bbbb-cccc";
  const note = (id: string, rest = "uzasadnienie. Przegląd do 2026-12-17. #1") => `${NOTE_PREFIX}${id}: ${rest}`;
  const pkg = (list: string[], notes: string[], extra: Record<string, unknown> = {}) => ({
    "//": ["pnpm.overrides x: inny wpis. #2", ...notes],
    pnpm: { overrides: {}, auditConfig: { ignoreGhsas: list, ...extra } },
  });
  const check = (p: unknown, today = "2026-11-17") => findAuditExceptionViolations(p, [ID], today);

  it("poprawne dane: zero naruszeń, także w dniu przeglądu", () => {
    expect(check(pkg([ID], [note(ID)]))).toEqual([]);
    expect(check(pkg([ID], [note(ID)]), "2026-12-17")).toEqual([]);
  });

  it("brak auditConfig: lista niezgodna", () => {
    const v = check({ "//": [], pnpm: { overrides: {} } });
    expect(v.map((x) => x.kind)).toEqual(["lista"]);
  });

  it("drugi wyjątek bez zmiany listy oczekiwanej", () => {
    const v = check(pkg([ID, "GHSA-xxxx-yyyy-zzzz"], [note(ID), note("GHSA-xxxx-yyyy-zzzz")]));
    expect(v.map((x) => x.kind)).toEqual(["lista"]);
  });

  it("wpis bez daty przeglądu", () => {
    const v = check(pkg([ID], [note(ID, "uzasadnienie. #1")]));
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain("bez daty");
  });

  it("niepoprawna data kalendarzowa", () => {
    const v = check(pkg([ID], [note(ID, "uzasadnienie. Przegląd do 2026-02-30. #1")]));
    expect(v.map((x) => x.kind)).toEqual(["wpis"]);
    expect(v[0]!.message).toContain("nie jest poprawna data");
  });

  it("wpis bez numeru zgłoszenia", () => {
    const v = check(pkg([ID], [note(ID, "uzasadnienie. Przegląd do 2026-12-17.")]));
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain("bez numeru zgłoszenia");
  });

  it("data przeglądu wczorajsza: czerwono z instrukcją", () => {
    const v = check(pkg([ID], [note(ID, "uzasadnienie. Przegląd do 2026-11-16. #1")]));
    expect(v.map((x) => x.kind)).toEqual(["termin"]);
    expect(v[0]!.message).toMatch(/usuń go.*albo przedłuż z nową datą i nowym uzasadnieniem/);
  });

  it("dzień po dacie przeglądu: czerwono", () => {
    expect(check(pkg([ID], [note(ID)]), "2026-12-18").map((x) => x.kind)).toEqual(["termin"]);
  });

  it("dwa wpisy dla jednego identyfikatora", () => {
    expect(check(pkg([ID], [note(ID), note(ID)])).map((x) => x.kind)).toEqual(["wpis"]);
  });

  it("identyfikator na liście bez wpisu", () => {
    const v = check(pkg([ID], []));
    expect(v.map((x) => x.kind)).toEqual(["wpis"]);
    expect(v[0]!.message).toContain("0 wpisów");
  });

  it("dodatkowy klucz w auditConfig", () => {
    const v = check(pkg([ID], [note(ID)], { ignoreUnfixed: true }));
    expect(v.map((x) => x.kind)).toEqual(["klucze"]);
    expect(v[0]!.message).toContain("ignoreUnfixed");
    expect(check(pkg([ID], [note(ID)], { ignoreCves: ["CVE-1"] })).map((x) => x.kind)).toEqual(["klucze"]);
  });

  it("osierocony wpis", () => {
    const v = check(pkg([ID], [note(ID), note("GHSA-xxxx-yyyy-zzzz")]));
    expect(v.map((x) => x.kind)).toEqual(["sierota"]);
    expect(check(pkg([ID], [note(ID), "luźna notka o ignoreGhsas. #3"])).map((x) => x.kind)).toEqual(["sierota"]);
  });

  describe("pusta lista oczekiwana", () => {
    const checkEmpty = (p: unknown) => findAuditExceptionViolations(p, [], "2026-11-17");

    it("brak auditConfig: zero naruszeń", () => {
      expect(checkEmpty({ "//": [], pnpm: { overrides: {} } })).toEqual([]);
    });

    it("auditConfig z pustą listą ignoreGhsas: zero naruszeń", () => {
      expect(checkEmpty({ "//": [], pnpm: { overrides: {}, auditConfig: { ignoreGhsas: [] } } })).toEqual([]);
      expect(checkEmpty({ "//": [], pnpm: { overrides: {}, auditConfig: {} } })).toEqual([]);
    });

    it("wyjątek na liście przy pustej liście oczekiwanej", () => {
      const v = checkEmpty({ "//": [note(ID)], pnpm: { overrides: {}, auditConfig: { ignoreGhsas: [ID] } } });
      expect(v.map((x) => x.kind)).toEqual(["lista"]);
    });

    it("dodatkowy klucz w auditConfig bez ignoreGhsas", () => {
      const v = checkEmpty({ "//": [], pnpm: { overrides: {}, auditConfig: { ignoreUnfixed: true } } });
      expect(v.map((x) => x.kind)).toEqual(["klucze"]);
    });
  });
});
