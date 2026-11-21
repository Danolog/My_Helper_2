// @vitest-environment node
/**
 * #165: strażnik statyczny — kolizje terminów liczy WYŁĄCZNIE
 * `@/lib/appointment-overlap` (przedział półotwarty [start, end)).
 *
 * Reguły:
 *  1. Miejsca kolizji wizyt (POST/PUT wizyty, pakiet, zadatek, lista
 *     oczekujących) importują i wołają `appointmentConflictWhere`;
 *     available-slots woła `rangesOverlap`.
 *  2. W tych plikach żadnego własnego porównania `lt/lte/gt/gte` na
 *     `appointments.startTime/endTime` ani `timeBlocks.startTime/endTime`
 *     (blokady idą przez `overlapsRange`). Wyjątek: filtr zakresu dat listy
 *     GET /api/appointments, pobranie dnia w available-slots i warunek wyboru
 *     powiązanej wizyty na liście oczekujących (to nie kolizje).
 *  3. W całym `src/app/api/**` i `src/lib/**` żadnego `gte(appointments.endTime`
 *     ani pary `lte(appointments.startTime` + `gte(appointments.endTime` —
 *     to kształt dawnej kolizji „włącznie”.
 * Test kontrolny niżej pokazuje, że każda reguła łapie podrzucone naruszenie.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const MODULE = "src/lib/appointment-overlap.ts";

const CONFLICT_FILES = [
  "src/app/api/appointments/route.ts",
  "src/app/api/appointments/[id]/route.ts",
  "src/app/api/appointments/book-package/route.ts",
  "src/app/api/deposits/create-session/route.ts",
  "src/app/api/deposits/blik-booking/route.ts",
  "src/lib/waiting-list.ts",
];
const SLOTS_FILE = "src/app/api/available-slots/route.ts";

/** Dozwolone porównania czasu w plikach z reguły 2 (filtry zakresu, nie kolizje). */
const ALLOWED: Record<string, string[]> = {
  "src/app/api/appointments/route.ts": [
    "lt(appointments.startTime, new Date(endDate))",
    "gt(appointments.endTime, new Date(startDate))",
    "gte(appointments.startTime, new Date(startDate))",
    "lte(appointments.endTime, new Date(endDate))",
  ],
  [SLOTS_FILE]: [
    "gte(appointments.startTime, dayStart)",
    "lt(appointments.startTime, dayEnd)",
    "lt(timeBlocks.startTime, dayEnd)",
    "gte(timeBlocks.endTime, dayStart)",
  ],
  // Wybór i przeniesienie powiązanej wizyty przy przyjęciu oferty: tylko wizyta
  // późniejsza niż oferowany termin i jeszcze nierozpoczęta (to nie kolizja).
  "src/lib/waiting-list.ts": [
    "gt(appointments.startTime, offeredStart)",
    "gt(appointments.startTime, now)",
  ],
  // Zawężenie skanu liczników dziennego limitu rezerwacji BLIK (okno 24 h):
  // to nie kolizja terminów.
  "src/app/api/deposits/blik-booking/route.ts": [
    "gte(appointments.startTime, earliestCountedStart)",
  ],
};

const COMPARISON = /\b(lt|lte|gt|gte)\(\s*(appointments|timeBlocks)\.(startTime|endTime)\s*,\s*([^()]*(?:\([^()]*\))?[^()]*)\)/g;
const IMPORT = /from\s+["']@\/lib\/appointment-overlap["']/;

const normalize = (s: string) => s.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();

export function findOverlapViolations(files: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [file, src] of Object.entries(files)) {
    if (file === MODULE) continue;
    const isConflict = CONFLICT_FILES.includes(file);
    const isSlots = file === SLOTS_FILE;

    if (isConflict && (!IMPORT.test(src) || !/\bappointmentConflictWhere\(/.test(src))) {
      out.push(`${file}: kolizja wizyt nie idzie przez appointmentConflictWhere`);
    }
    if (isSlots && (!IMPORT.test(src) || !/\brangesOverlap\(/.test(src))) {
      out.push(`${file}: sloty nie liczą kolizji przez rangesOverlap`);
    }
    if (isConflict || isSlots) {
      const allowed = (ALLOWED[file] ?? []).map(normalize);
      for (const m of src.matchAll(COMPARISON)) {
        const text = normalize(m[0]);
        if (!allowed.includes(text)) out.push(`${file}: własne porównanie czasu ${text}`);
      }
    }
    if (/\bgte\(\s*appointments\.endTime\b/.test(src)) {
      out.push(`${file}: gte(appointments.endTime …) — kształt kolizji „włącznie”`);
    }
  }
  return out;
}

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) return walk(rel);
    return /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
  });
}

function readSources(): Record<string, string> {
  const files = [...walk("src/app/api"), ...walk("src/lib")];
  return Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")]));
}

describe("#165 strażnik: kolizje tylko przez @/lib/appointment-overlap", () => {
  const sources = readSources();

  it("lista miejsc kolizji istnieje w repo (strażnik nie sprawdza pustki)", () => {
    for (const f of [...CONFLICT_FILES, SLOTS_FILE, MODULE]) expect(Object.keys(sources)).toContain(f);
  });

  it("repo: zero naruszeń", () => {
    expect(findOverlapViolations(sources)).toEqual([]);
  });

  it("dozwolone wyjątki nadal istnieją (nieaktualny wyjątek = do usunięcia)", () => {
    for (const [file, list] of Object.entries(ALLOWED)) {
      const found = [...sources[file]!.matchAll(COMPARISON)].map((m) => normalize(m[0]));
      for (const a of list) expect(found).toContain(normalize(a));
    }
  });
});

describe("#165 strażnik — test kontrolny (podrzucone naruszenia są łapane)", () => {
  const ok = readSources();
  const plant = (file: string, from: string, to: string) => {
    const src = ok[file]!;
    expect(src).toContain(from);
    return findOverlapViolations({ [file]: src.replace(from, to) });
  };

  it("trasa z własnym predykatem zamiast appointmentConflictWhere", () => {
    const v = plant(
      "src/app/api/deposits/create-session/route.ts",
      "appointmentConflictWhere({",
      "and(lt(appointments.startTime, new Date(endTime)), gt(appointments.endTime, new Date(startTime)), ({"
    );
    expect(v.some((x) => x.includes("nie idzie przez appointmentConflictWhere"))).toBe(true);
    expect(v.some((x) => x.includes("własne porównanie czasu lt(appointments.startTime"))).toBe(true);
  });

  it("rezerwacja z zadatkiem BLIK bez appointmentConflictWhere", () => {
    const v = plant("src/app/api/deposits/blik-booking/route.ts", "appointmentConflictWhere({", "({");
    expect(v.some((x) => x.includes("blik-booking/route.ts: kolizja wizyt nie idzie"))).toBe(true);
  });

  it("dawny kształt „włącznie” w dowolnym pliku src/lib", () => {
    const v = findOverlapViolations({
      "src/lib/x.ts": "and(lte(appointments.startTime, s), gte(appointments.endTime, s))",
    });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("włącznie");
  });

  it("blokada czasu liczona inline w trasie", () => {
    const v = plant(
      "src/app/api/appointments/book-package/route.ts",
      "overlapsRange(timeBlocks.startTime, timeBlocks.endTime, firstStart, lastEnd)",
      "lt(timeBlocks.startTime, lastEnd), gt(timeBlocks.endTime, firstStart)"
    );
    expect(v).toEqual([
      "src/app/api/appointments/book-package/route.ts: własne porównanie czasu lt(timeBlocks.startTime, lastEnd)",
      "src/app/api/appointments/book-package/route.ts: własne porównanie czasu gt(timeBlocks.endTime, firstStart)",
    ]);
  });

  it("lista oczekujących bez sprawdzenia kolizji", () => {
    const v = plant("src/lib/waiting-list.ts", "appointmentConflictWhere({", "({");
    expect(v.some((x) => x.includes("waiting-list.ts: kolizja wizyt nie idzie"))).toBe(true);
  });

  it("available-slots porównuje w pamięci po swojemu", () => {
    const v = plant(SLOTS_FILE, "rangesOverlap(slotStart, slotEnd, range.start, range.end)", "slotStart <= range.end && slotEnd >= range.start");
    expect(v.some((x) => x.includes("rangesOverlap"))).toBe(true);
  });

  it("wieloliniowe porównanie też jest łapane", () => {
    const v = findOverlapViolations({
      "src/app/api/appointments/[id]/route.ts":
        'import { appointmentConflictWhere } from "@/lib/appointment-overlap";\nappointmentConflictWhere(x);\nlte(\n  appointments.startTime,\n  newStartTime\n)',
    });
    expect(v).toEqual(["src/app/api/appointments/[id]/route.ts: własne porównanie czasu lte(appointments.startTime, newStartTime)"]);
  });
});
