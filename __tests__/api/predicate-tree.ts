/**
 * #165: ewaluator warunku WHERE zbudowanego z ZAMOCKOWANYCH operatorów drizzle
 * (`{ type: "eq" | "and" | ..., args }`, kolumny jako napisy `"tabela.kolumna"`).
 *
 * Pozwala testom tras z atrapą bazy sprawdzić znaczenie predykatu kolizji
 * na wierszach-fiksturach (styk, nakładanie, anulowana), a nie tylko to,
 * czy trasa zwraca 409, gdy atrapa „coś” zwróci.
 */
export interface PredicateNode {
  type: string;
  args: unknown[];
}

const isNode = (v: unknown): v is PredicateNode =>
  typeof v === "object" && v !== null && "type" in v && Array.isArray((v as PredicateNode).args);

function value(v: unknown, row: Record<string, unknown>): unknown {
  if (typeof v === "string" && /^[A-Za-z]+\.[A-Za-z]+$/.test(v)) {
    const col = v.split(".")[1]!;
    if (!(col in row)) throw new Error(`predicate-tree: wiersz nie ma kolumny ${col}`);
    return row[col];
  }
  return v;
}

const cmp = (v: unknown): unknown => (v instanceof Date ? v.getTime() : v);

export function matchesPredicate(node: unknown, row: Record<string, unknown>): boolean {
  if (node === undefined) return true; // drizzle and() pomija undefined
  if (!isNode(node)) throw new Error(`predicate-tree: nieznany węzeł ${JSON.stringify(node)}`);
  const [a, b] = node.args;
  switch (node.type) {
    case "and":
      return node.args.every((n) => matchesPredicate(n, row));
    case "or":
      return node.args.filter((n) => n !== undefined).some((n) => matchesPredicate(n, row));
    case "not":
      return !matchesPredicate(a, row);
    case "eq":
      return cmp(value(a, row)) === cmp(value(b, row));
    case "lt":
      return (cmp(value(a, row)) as number) < (cmp(value(b, row)) as number);
    case "lte":
      return (cmp(value(a, row)) as number) <= (cmp(value(b, row)) as number);
    case "gt":
      return (cmp(value(a, row)) as number) > (cmp(value(b, row)) as number);
    case "gte":
      return (cmp(value(a, row)) as number) >= (cmp(value(b, row)) as number);
    default:
      throw new Error(`predicate-tree: nieobsługiwany operator ${node.type}`);
  }
}
