/**
 * #165: ewaluator warunku WHERE z PRAWDZIWEGO drizzle (obiekt SQL) na
 * wierszu-fiksturze. Warunek renderuje PgDialect, a wąską gramatykę wyniku
 * (`"t"."kolumna" op $n`, `and`, `or`, `not`, nawiasy) czyta mały parser —
 * bez eval/new Function.
 *
 * Pozwala testom tras z atrapą bazy sprawdzić znaczenie predykatu kolizji
 * (styk, nakładanie, anulowana), a nie tylko to, że trasa zwróci 409, gdy
 * atrapa „coś” zwróci. Klucze wiersza: nazwy kolumn w bazie (`start_time`).
 * Spoza gramatyki albo brak kolumny w wierszu: wyjątek, nie ciche `false`.
 */
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

type Token =
  | { k: "("; } | { k: ")"; } | { k: "and" } | { k: "or" } | { k: "not" }
  | { k: "col"; name: string } | { k: "param"; index: number } | { k: "op"; op: string };

function tokenize(sql: string): Token[] {
  const re = /\s*(?:(\()|(\))|(and|or|not)\b|"[a-z_]+"\."([a-z_]+)"|\$(\d+)|(<=|>=|<>|=|<|>))/y;
  const out: Token[] = [];
  let pos = 0;
  while (pos < sql.length) {
    re.lastIndex = pos;
    const m = re.exec(sql);
    if (!m) {
      if (/^\s*$/.test(sql.slice(pos))) break;
      throw new Error(`sql-predicate: poza gramatyką przy "${sql.slice(pos, pos + 20)}" w: ${sql}`);
    }
    pos = re.lastIndex;
    if (m[1]) out.push({ k: "(" });
    else if (m[2]) out.push({ k: ")" });
    else if (m[3]) out.push({ k: m[3] as "and" | "or" | "not" });
    else if (m[4]) out.push({ k: "col", name: m[4] });
    else if (m[5]) out.push({ k: "param", index: Number(m[5]) - 1 });
    else if (m[6]) out.push({ k: "op", op: m[6] });
  }
  return out;
}

const norm = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v);

function compare(op: string, a: unknown, b: unknown): boolean {
  const x = norm(a) as string | number;
  const y = norm(b) as string | number;
  switch (op) {
    case "=": return x === y;
    case "<>": return x !== y;
    case "<": return x < y;
    case ">": return x > y;
    case "<=": return x <= y;
    case ">=": return x >= y;
    default: throw new Error(`sql-predicate: operator ${op}`);
  }
}

export function sqlMatches(where: SQL, row: Record<string, unknown>): boolean {
  const { sql, params } = new PgDialect().sqlToQuery(where);
  const tokens = tokenize(sql);
  let i = 0;
  const peek = () => tokens[i];
  const take = (k: Token["k"]) => {
    const t = tokens[i++];
    if (!t || t.k !== k) throw new Error(`sql-predicate: oczekiwano ${k} w: ${sql}`);
    return t;
  };

  // or < and < not < porównanie (jak w Postgresie)
  const orExpr = (): boolean => {
    let v = andExpr();
    while (peek()?.k === "or") { i++; const r = andExpr(); v = v || r; }
    return v;
  };
  const andExpr = (): boolean => {
    let v = notExpr();
    while (peek()?.k === "and") { i++; const r = notExpr(); v = v && r; }
    return v;
  };
  const notExpr = (): boolean => {
    if (peek()?.k === "not") { i++; return !notExpr(); }
    if (peek()?.k === "(") { i++; const v = orExpr(); take(")"); return v; }
    const col = take("col") as Extract<Token, { k: "col" }>;
    const op = take("op") as Extract<Token, { k: "op" }>;
    const param = take("param") as Extract<Token, { k: "param" }>;
    if (!(col.name in row)) throw new Error(`sql-predicate: wiersz nie ma kolumny ${col.name}`);
    return compare(op.op, row[col.name], params[param.index]);
  };

  const result = orExpr();
  if (i !== tokens.length) throw new Error(`sql-predicate: nadmiarowe tokeny w: ${sql}`);
  return result;
}
