/**
 * Atrapa bazy dla publicznych tras katalogu salonu (`salons/[id]`, usługa,
 * profil pracownika) czytających przez `forSalon(id).raw(tx => …)`.
 *
 * Tabele to fikstury w pamięci. Każde `tx.select(cols)` wykonuje ZBUDOWANY
 * przez trasę warunek WHERE i warunki złączeń (operatory drizzle są atrapami
 * `{ type, args }`, kolumny napisami `"tabela.kolumna"`), grupuje, sortuje,
 * tnie `limit` i zwraca wyłącznie wybrane kolumny. Testy sprawdzają więc
 * znaczenie warunków (np. jawne eq(salonId)), a nie to, że atrapa „coś” oddała.
 *
 * `select()` bez listy kolumn zwraca cały wiersz tabeli bazowej i jest
 * odnotowany w `selectCalls` z `cols: null` — testy list kolumn to wyłapują.
 *
 * Moduł jest importowany zarówno z fabryk `vi.mock` (przez `await import`),
 * jak i z testów — vitest daje tę samą instancję, więc stan jest wspólny.
 */
import { vi } from "vitest";

export type Row = Record<string, unknown>;

interface Node {
  type: string;
  args: unknown[];
}

export const tables: Record<string, Row[]> = {};

export interface SelectCall {
  table: string;
  cols: Record<string, unknown> | null;
  where: unknown;
  joins: string[];
}

export const selectCalls: SelectCall[] = [];
export const state = {
  transactions: 0,
  /** Ustawiony błąd rzuca przy najbliższym `tx.select`. */
  failSelect: null as Error | null,
};

export function resetFixture(init: Record<string, Row[]> = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const [k, rows] of Object.entries(init)) tables[k] = rows.map((r) => ({ ...r }));
  selectCalls.length = 0;
  state.transactions = 0;
  state.failSelect = null;
  cacheStore.clear();
}

const isNode = (v: unknown): v is Node =>
  typeof v === "object" && v !== null && "type" in v && Array.isArray((v as Node).args);

const COLUMN_REF = /^[A-Za-z]+\.[A-Za-z]+$/;

/** Wiersz złączenia: klucze `tabela.kolumna`; `__null` = tabele z leftJoin bez dopasowania. */
type JoinedRow = Row & { __null?: Set<string> };

function lookup(ref: string, row: JoinedRow, inQuery: Set<string>): unknown {
  const [table] = ref.split(".");
  if (!inQuery.has(table!)) throw new Error(`fixture: kolumna ${ref} spoza tabel zapytania`);
  if (row.__null?.has(table!)) return null;
  if (!(ref in row)) throw new Error(`fixture: wiersz ${table} nie ma kolumny ${ref}`);
  return row[ref];
}

function value(v: unknown, row: JoinedRow, inQuery: Set<string>): unknown {
  if (typeof v === "string" && COLUMN_REF.test(v) && inQuery.has(v.split(".")[0]!)) {
    return lookup(v, row, inQuery);
  }
  return v;
}

function matches(node: unknown, row: JoinedRow, inQuery: Set<string>): boolean {
  if (node === undefined) return true; // drizzle and() pomija undefined
  if (!isNode(node)) throw new Error(`fixture: nieznany węzeł ${JSON.stringify(node)}`);
  const [a, b] = node.args;
  switch (node.type) {
    case "and":
      return node.args.every((n) => matches(n, row, inQuery));
    case "eq":
      return value(a, row, inQuery) === value(b, row, inQuery);
    case "inArray":
      return (b as unknown[]).includes(value(a, row, inQuery));
    case "sql": {
      const [strings, ...values] = node.args as [TemplateStringsArray, ...unknown[]];
      const text = Array.from(strings).join("?");
      if (/^\?\s+IS NOT NULL$/i.test(text.trim())) return value(values[0], row, inQuery) != null;
      throw new Error(`fixture: nieobsługiwany sql: ${text}`);
    }
    default:
      throw new Error(`fixture: nieobsługiwany operator ${node.type}`);
  }
}

function prefixed(table: string, row: Row): JoinedRow {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [`${table}.${k}`, v]));
}

function aggregate(node: Node, group: JoinedRow[], inQuery: Set<string>): unknown {
  const col = node.args[0] as string;
  const vals = group.map((r) => value(col, r, inQuery)).filter((v) => v != null);
  if (node.type === "count") return vals.length;
  if (node.type === "avg") {
    if (vals.length === 0) return null;
    // Postgres numeric avg → drizzle zwraca napis.
    return String(vals.reduce((s: number, v) => s + Number(v), 0) / vals.length);
  }
  throw new Error(`fixture: nieobsługiwana agregacja ${node.type}`);
}

function select(cols?: Record<string, unknown>) {
  const call: SelectCall = { table: "", cols: cols ?? null, where: undefined, joins: [] };
  selectCalls.push(call);
  if (state.failSelect) {
    const err = state.failSelect;
    state.failSelect = null;
    throw err;
  }
  const joins: { table: string; on: unknown; left: boolean }[] = [];
  let order: unknown[] = [];
  let groupBy: string[] = [];
  let limit: number | undefined;

  const run = (): Row[] => {
    const inQuery = new Set([call.table, ...joins.map((j) => j.table)]);
    let rows: JoinedRow[] = (tables[call.table] ?? []).map((r) => prefixed(call.table, r));
    for (const j of joins) {
      const next: JoinedRow[] = [];
      for (const left of rows) {
        const hits = (tables[j.table] ?? [])
          .map((r) => ({ ...left, ...prefixed(j.table, r) }) as JoinedRow)
          .filter((r) => matches(j.on, r, inQuery));
        if (hits.length > 0) next.push(...hits);
        else if (j.left) next.push({ ...left, __null: new Set([...(left.__null ?? []), j.table]) });
      }
      rows = next;
    }
    rows = rows.filter((r) => matches(call.where, r, inQuery));
    for (const o of [...order].reverse()) {
      const desc = isNode(o) && o.type === "desc";
      const col = (isNode(o) ? o.args[0] : o) as string;
      rows = [...rows].sort((x, y) => {
        const a = value(col, x, inQuery) as number | Date;
        const b = value(col, y, inQuery) as number | Date;
        const d = (a instanceof Date ? a.getTime() : a) - (b instanceof Date ? b.getTime() : b);
        return desc ? -d : d;
      });
    }

    let out: Row[];
    if (!cols) {
      out = rows.map((r) =>
        Object.fromEntries(
          Object.entries(r)
            .filter(([k]) => k.startsWith(`${call.table}.`))
            .map(([k, v]) => [k.slice(call.table.length + 1), v])
        )
      );
    } else if (Object.values(cols).some(isNode)) {
      const groups = new Map<string, JoinedRow[]>();
      if (groupBy.length === 0) groups.set("", rows);
      for (const r of groupBy.length > 0 ? rows : []) {
        const key = JSON.stringify(groupBy.map((g) => value(g, r, inQuery)));
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      out = [...groups.values()].map((group) =>
        Object.fromEntries(
          Object.entries(cols).map(([k, c]) => [
            k,
            isNode(c) ? aggregate(c, group, inQuery) : group[0] ? value(c, group[0], inQuery) : null,
          ])
        )
      );
    } else {
      out = rows.map((r) =>
        Object.fromEntries(Object.entries(cols).map(([k, c]) => [k, value(c, r, inQuery)]))
      );
    }
    return limit === undefined ? out : out.slice(0, limit);
  };

  const chain = {
    from(table: { _table: string }) {
      call.table = table._table;
      return chain;
    },
    innerJoin(table: { _table: string }, on: unknown) {
      joins.push({ table: table._table, on, left: false });
      call.joins.push(table._table);
      return chain;
    },
    leftJoin(table: { _table: string }, on: unknown) {
      joins.push({ table: table._table, on, left: true });
      call.joins.push(table._table);
      return chain;
    },
    where(predicate: unknown) {
      call.where = predicate;
      return chain;
    },
    orderBy(...o: unknown[]) {
      order = o;
      return chain;
    },
    groupBy(...g: string[]) {
      groupBy = g;
      return chain;
    },
    limit(n: number) {
      limit = n;
      return chain;
    },
    then(resolve: (rows: Row[]) => unknown, reject: (e: unknown) => unknown) {
      try {
        return Promise.resolve(run()).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(resolve, reject);
      }
    },
  };
  return chain;
}

function update(table: { _table: string }) {
  let data: Row = {};
  let where: unknown;
  const chain = {
    set(d: Row) {
      data = d;
      return chain;
    },
    where(p: unknown) {
      where = p;
      return chain;
    },
    returning() {
      const name = table._table;
      const inQuery = new Set([name]);
      const hit = (tables[name] ?? []).filter((r) => matches(where, prefixed(name, r), inQuery));
      for (const r of hit) Object.assign(r, data);
      return Promise.resolve(hit.map((r) => ({ ...r })));
    },
  };
  return chain;
}

export const executeCalls: unknown[] = [];

export const tx = {
  select: (cols?: Record<string, unknown>) => select(cols),
  update: (table: { _table: string }) => update(table),
  execute: (q: unknown) => {
    executeCalls.push(q);
    return Promise.resolve(undefined);
  },
};

export const db = {
  transaction: (fn: (t: typeof tx) => unknown) => {
    state.transactions++;
    return Promise.resolve().then(() => fn(tx));
  },
};

/** Atrapa schematu: kolumny jako napisy `tabela.kolumna`, `_table` = nazwa. */
export function createTable(name: string) {
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "_table") return name;
        if (typeof prop === "symbol") return undefined;
        return `${name}.${String(prop)}`;
      },
    }
  );
}

export const schemaMock = {
  salons: createTable("salons"),
  services: createTable("services"),
  employees: createTable("employees"),
  reviews: createTable("reviews"),
  serviceCategories: createTable("serviceCategories"),
  serviceVariants: createTable("serviceVariants"),
  employeeServices: createTable("employeeServices"),
  employeeServicePrices: createTable("employeeServicePrices"),
  galleryPhotos: createTable("galleryPhotos"),
  clients: createTable("clients"),
};

const node = (type: string) => vi.fn((...args: unknown[]) => ({ type, args }));

export const drizzleMock = {
  eq: node("eq"),
  and: node("and"),
  inArray: node("inArray"),
  avg: node("avg"),
  count: node("count"),
  desc: node("desc"),
  asc: node("asc"),
  // sql`…` (IS NOT NULL i set_config w forSalon) + sql.raw (SET LOCAL ROLE)
  sql: Object.assign(node("sql"), { raw: vi.fn((query: string) => ({ type: "sql.raw", query })) }),
};

/**
 * Atrapa `unstable_cache`, która rozróżnia klucze jak Next: klucz = keyParts +
 * argumenty funkcji opakowanej. Do cache trafia wynik po serializacji JSON
 * (jak w Next); wyjątek z funkcji NIE jest zapisywany.
 */
export const cacheStore = new Map<string, string>();
export const cacheConfigs: { keyParts: unknown; options: unknown }[] = [];
export const nextCacheMock = {
  unstable_cache:
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>, keyParts?: string[], options?: unknown) => {
      cacheConfigs.push({ keyParts, options });
      return async (...args: A): Promise<R> => {
        const key = JSON.stringify([keyParts ?? [], args]);
        const hit = cacheStore.get(key);
        if (hit !== undefined) return JSON.parse(hit) as R;
        const result = await fn(...args);
        const serialized = JSON.stringify(result);
        cacheStore.set(key, serialized);
        return JSON.parse(serialized) as R;
      };
    },
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
};

/** Kolumny wybrane z tabeli `table` we wszystkich zapytaniach (null = select()). */
export function columnsReadFrom(table: string): (string[] | null)[] {
  return selectCalls
    .filter((c) => c.table === table)
    .map((c) => (c.cols ? Object.values(c.cols).filter((v): v is string => typeof v === "string") : null));
}

/** Czy WHERE zapytania zawiera eq(kolumna, wartość) (na dowolnej głębokości and). */
export function whereHasEq(where: unknown, column: string, val: unknown): boolean {
  if (!isNode(where)) return false;
  if (where.type === "eq") return where.args[0] === column && where.args[1] === val;
  return where.args.some((a) => whereHasEq(a, column, val));
}
