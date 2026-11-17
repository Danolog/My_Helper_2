/**
 * Wspólny pomocnik serializacji logów w testach.
 *
 * `JSON.stringify` zamienia obiekt `Error` na `{}` (albo same własne pola
 * wyliczalne) — bez `message`, `name` i `cause`. Asercja „log nie zawiera X”
 * na takim napisie nie widzi treści błędu. `loggedText` zbiera wywołania
 * WSZYSTKICH poziomów zmockowanego loggera i serializuje błędy z nazwą, treścią,
 * przyczyną i pozostałymi własnymi polami, rekurencyjnie (także w tablicach,
 * w zagnieżdżonych obiektach i w łańcuchu `cause`).
 *
 * Plik bez `.test.` w nazwie — Vitest go nie zbiera (`include` w vitest.config.ts).
 */

/** Poziomy loggera z `src/lib/logger.ts`; każdy musi być atrapą `vi.fn`. */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

type MockFn = { mock: { calls: unknown[][] } };

function isMockFn(value: unknown): value is MockFn {
  return typeof value === "function" && Array.isArray((value as Partial<MockFn>).mock?.calls);
}

/** Błąd jako zwykły obiekt: nazwa, treść, przyczyna i każde inne własne pole (bez stosu). */
function errorAsObject(err: Error): Record<string, unknown> {
  const out: Record<string, unknown> = { name: err.name, message: err.message };
  for (const key of Object.getOwnPropertyNames(err)) {
    if (key === "stack") continue;
    out[key] = (err as unknown as Record<string, unknown>)[key];
  }
  return out;
}

/**
 * Dowolna wartość jako tekst do asercji. Błędy rozwinięte (`errorAsObject`),
 * Map/Set jako tablice, BigInt jako napis. Obiekt napotkany drugi raz w tej samej
 * serializacji jest zastąpiony znacznikiem (cykle) — pierwsze wystąpienie
 * jest zawsze w całości, więc asercja „nie zawiera” zachowuje moc.
 */
export function serializeForAssertion(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === "bigint") return v.toString();
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[seen]";
    seen.add(v);
    if (v instanceof Error) return errorAsObject(v);
    if (v instanceof Map) return [...v.entries()];
    if (v instanceof Set) return [...v.values()];
    return v;
  });
}

/**
 * Wszystkie argumenty wszystkich wywołań loggera (każdy poziom, także pola
 * spoza `LOG_LEVELS`, jeśli są atrapami) jako jeden napis. Brak atrapy dla
 * któregoś z `LOG_LEVELS` → wyjątek: asercja na niepełnym logu byłaby pusta.
 */
export function loggedText(logger: object): string {
  const fields = logger as Record<string, unknown>;
  for (const level of LOG_LEVELS) {
    if (!isMockFn(fields[level])) {
      throw new Error(`loggedText: logger.${level} nie jest atrapą vi.fn — log tego poziomu byłby niewidoczny`);
    }
  }
  const calls = Object.entries(fields)
    .filter((entry): entry is [string, MockFn] => isMockFn(entry[1]))
    .map(([level, fn]) => [level, fn.mock.calls]);
  return serializeForAssertion(calls);
}
