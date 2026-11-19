/**
 * Niezmiennik, na którym stoi „brak wiersza pod blokadą → 2xx + warn” w
 * webhooku (T3, ostrzeżenie #3):
 *
 *   jedyna ścieżka zapisująca `salon_subscriptions.stripe_subscription_id`
 *   to confirm (`src/lib/subscription-confirmation.ts`), który czyta Stripe
 *   na świeżo pod tą samą blokadą stripe_sub.
 *
 * Dzięki temu zdarzenie „przed wierszem” nie gubi stanu: wiersz powstaje
 * tylko z bieżącego odczytu Stripe. Gdyby inna ścieżka zaczęła zapisywać
 * `stripeSubscriptionId` (np. przywrócona symulacja `sim_*`), ten test pada.
 *
 * Kontrakt okresu: `currentPeriodStart` / `currentPeriodEnd` to ostatni
 * opłacony okres, a w subskrypcji w okresie próbnym — okres próbny. W treści
 * `.set(…)`/`.values(…)` występują tylko w potwierdzeniu Checkoutu,
 * w rejestracji (okres próbny) i w webhooku — tam wyłącznie w
 * `handleInvoicePaid`, z wartością `paidPeriodStartSql(…)` /
 * `paidPeriodEndSql(…)`. Typ `SubscriptionStateUpdate` (zapis `.set(state)`)
 * nie obejmuje pól okresu, a surowy SQL poza schematem nie używa nazw kolumn
 * okresu.
 *
 * Analiza tekstowa źródeł: każde `.insert(salonSubscriptions)` /
 * `.update(salonSubscriptions)` → argument następnego `.values(…)`/`.set(…)`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");
const ALLOWED_WRITER = "src/lib/subscription-confirmation.ts";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Tekst w nawiasach zaczynających się na `open` (indeks znaku `(` albo `{` dla `pair = "{}"`). */
function balanced(text: string, open: number, pair = "()"): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === pair[0]) depth++;
    else if (text[i] === pair[1] && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error("unbalanced parentheses");
}

/** Źródło z końcami linii LF (pozycje w `SubscriptionWrite.index` liczone na tym tekście). */
function readSource(file: string): string {
  return readFileSync(resolve(ROOT, file), "utf8").replace(/\r\n/g, "\n");
}

interface SubscriptionWrite {
  file: string;
  payload: string;
  /** Odbiorca wywołania: identyfikator przed `.insert(`/`.update(` (np. `tx`, `db`). */
  receiver: string;
  /** Pozycja `.insert(`/`.update(` w tekście pliku (LF). */
  index: number;
}

function subscriptionWrites(): SubscriptionWrite[] {
  const writes: SubscriptionWrite[] = [];
  for (const path of sourceFiles(SRC)) {
    const text = readSource(path);
    const re = /\.(insert|update)\(salonSubscriptions\)/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const rest = text.slice(m.index + m[0].length);
      const call = /^\s*\.(values|set)\(/.exec(rest);
      if (!call) throw new Error(`${relative(ROOT, path)}: write without .values/.set`);
      const open = m.index + m[0].length + call[0].length - 1;
      const receiver = /([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(0, m.index))?.[1] ?? "";
      writes.push({ file: relative(ROOT, path), payload: balanced(text, open), receiver, index: m.index });
    }
  }
  return writes;
}

describe("niezmiennik: stripeSubscriptionId zapisuje tylko confirm pod blokadą stripe_sub", () => {
  const writes = subscriptionWrites();

  it("znajduje zapisy salon_subscriptions (test nie jest pusty)", () => {
    expect(writes.length).toBeGreaterThanOrEqual(5);
    expect(writes.some((w) => w.file === ALLOWED_WRITER)).toBe(true);
  });

  it("poza confirm żaden zapis nie ustawia stripeSubscriptionId ani nie rozwija obiektu (`...`)", () => {
    const offenders = writes
      .filter((w) => w.file !== ALLOWED_WRITER)
      .filter((w) => w.payload.includes("stripeSubscriptionId") || /\.\.\.(?!\()/.test(w.payload))
      .map((w) => w.file);
    // Jedyne dozwolone rozwinięcie: `...(warunek ? { literał } : {})` — literał
    // jest w payloadzie, więc sprawdza go warunek `includes` powyżej.
    expect(offenders).toEqual([]);
  });

  it("typ SubscriptionStateUpdate nie obejmuje stripeSubscriptionId", () => {
    const text = readFileSync(join(SRC, "lib/subscription-sync.ts"), "utf8");
    const start = text.indexOf("export type SubscriptionStateUpdate");
    const type = text.slice(start, text.indexOf(";", start));
    expect(type).toContain('"status"');
    expect(type).not.toContain("stripeSubscriptionId");
  });

  it("surowy SQL nie zapisuje stripe_subscription_id poza schematem", () => {
    const raw = sourceFiles(SRC)
      .filter((p) => !p.endsWith("lib/schema.ts"))
      .filter((p) => readFileSync(p, "utf8").includes("stripe_subscription_id"))
      .map((p) => relative(ROOT, p));
    expect(raw).toEqual([]);
  });

  it("w confirm zapis jest po: blokadzie stripe_sub → odczycie Stripe → blokadzie salonu", () => {
    const text = readFileSync(join(ROOT, ALLOWED_WRITER), "utf8");
    const at = (needle: string) => {
      const i = text.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const lockStripe = at("await lockStripeSubscription(tx, stripeSubId)");
    const read = at("await retrieveStripeSubscriptionLocked(");
    const lockSalon = at("await lockSalonSubscriptions(tx, salonId)");
    const insert = at(".insert(salonSubscriptions)");
    const update = at(".update(salonSubscriptions)");
    expect(lockStripe).toBeLessThan(read);
    expect(read).toBeLessThan(lockSalon);
    expect(lockSalon).toBeLessThan(Math.min(insert, update));
  });
});

/**
 * T3b: KAŻDY zapis salon_subscriptions idzie przez transakcję (`tx`), a plik
 * bierze blokadę salonu — bez wyjątków dla cancel, downgrade i
 * register-subscription.
 */
describe("niezmiennik T3b: zapisy salon_subscriptions tylko w transakcji z blokadą", () => {
  const writes = subscriptionWrites();
  const LOCK_HELPERS = ["lockSalonSubscriptions(", "withSalonSubscriptionLock(", "withLockedStripeSubscriptionRow("];

  it("żaden zapis nie idzie przez `db` poza transakcją", () => {
    const outside = writes.filter((w) => w.receiver !== "tx").map((w) => `${w.file} (${w.receiver})`);
    expect(outside).toEqual([]);
  });

  it("każdy plik z zapisem bierze blokadę salonu (bezpośrednio albo przez helper)", () => {
    const files = [...new Set(writes.map((w) => w.file))];
    expect(files).toEqual(
      expect.arrayContaining([
        "src/app/api/register-subscription/route.ts",
        "src/app/api/subscriptions/cancel/route.ts",
        "src/app/api/subscriptions/downgrade/route.ts",
      ])
    );
    const unlocked = files.filter((file) => {
      const text = readFileSync(join(ROOT, file), "utf8");
      return !LOCK_HELPERS.some((h) => text.includes(h));
    });
    expect(unlocked).toEqual([]);
  });
});

const WEBHOOK = "src/app/api/stripe/webhook/route.ts";
const PERIOD_WRITERS = [ALLOWED_WRITER, WEBHOOK, "src/app/api/register-subscription/route.ts"];
const hasPeriodField = (text: string) => /\bcurrentPeriod(?:Start|End)\b/.test(text);

/**
 * Treść zapisu z dołączonymi literałami obiektów, do których się odwołuje:
 * `.set(values)` / `...values` → `const values = { … }` z tego samego pliku.
 */
function resolvedPayload(w: SubscriptionWrite): string {
  const whole = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(w.payload)?.[1];
  const spreads = [...w.payload.matchAll(/\.\.\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!);
  const text = readSource(w.file);
  const literals = [...(whole ? [whole] : []), ...spreads].flatMap((name) => {
    const decl = new RegExp(`\\bconst ${name}\\s*(?::[^=]+)?=\\s*\\{`).exec(text);
    return decl ? [balanced(text, decl.index + decl[0].length - 1, "{}")] : [];
  });
  return [w.payload, ...literals].join("\n");
}

describe("kontrakt: okres rozliczeniowy (currentPeriodStart/End) zapisują tylko potwierdzenie, invoice.paid i rejestracja", () => {
  const writes = subscriptionWrites();
  const periodWrites = writes.filter((w) => hasPeriodField(resolvedPayload(w)));
  const periodFiles = [...new Set(periodWrites.map((w) => w.file))];

  it("pola currentPeriodStart/currentPeriodEnd w treści set/values występują tylko w potwierdzeniu, webhooku i rejestracji", () => {
    expect(periodFiles.filter((file) => !PERIOD_WRITERS.includes(file))).toEqual([]);
  });

  it("kontrakt nie jest pusty: zapis pola okresu jest w każdym z trzech dozwolonych plików", () => {
    expect(PERIOD_WRITERS.filter((file) => !periodFiles.includes(file))).toEqual([]);
  });

  it("w webhooku każdy zapis z polem okresu leży w handleInvoicePaid, a pole okresu ma wartość tylko z paidPeriodStartSql( / paidPeriodEndSql(", () => {
    const text = readSource(WEBHOOK);
    const fn = text.indexOf("async function handleInvoicePaid(");
    expect(fn).toBeGreaterThan(-1);
    const paramsOpen = text.indexOf("(", fn);
    const bodyOpen = text.indexOf("{", paramsOpen + balanced(text, paramsOpen).length + 2);
    const bodyEnd = bodyOpen + balanced(text, bodyOpen, "{}").length + 1;

    const webhookPeriodWrites = periodWrites.filter((w) => w.file === WEBHOOK);
    expect(webhookPeriodWrites.length).toBeGreaterThan(0);
    const outside = webhookPeriodWrites.filter((w) => w.index < bodyOpen || w.index > bodyEnd);
    expect(outside.map((w) => w.payload.trim())).toEqual([]);

    const badValues = webhookPeriodWrites.flatMap((w) =>
      [...resolvedPayload(w).matchAll(/\bcurrentPeriod(?:Start|End)\b[^,\n}]*/g)]
        .map((m) => m[0])
        .filter(
          (field) =>
            !/^currentPeriodStart\s*:\s*paidPeriodStartSql\(/.test(field) &&
            !/^currentPeriodEnd\s*:\s*paidPeriodEndSql\(/.test(field)
        )
    );
    expect(badValues).toEqual([]);
  });

  it("treść zapisu, która nie jest literałem obiektu, to tylko `state` w webhooku albo zapis w potwierdzeniu", () => {
    // Rozwinięcia wewnątrz literału sprawdza przypadek o `...` w pierwszej grupie.
    const nonLiteral = writes
      .filter((w) => !w.payload.trim().startsWith("{"))
      .filter((w) => w.file !== ALLOWED_WRITER && !(w.file === WEBHOOK && w.payload.trim() === "state"))
      .map((w) => `${w.file}: ${w.payload.trim()}`);
    expect(nonLiteral).toEqual([]);
  });

  it("typ SubscriptionStateUpdate nie obejmuje currentPeriodStart ani currentPeriodEnd", () => {
    const text = readSource("src/lib/subscription-sync.ts");
    const start = text.indexOf("export type SubscriptionStateUpdate");
    expect(start).toBeGreaterThan(-1);
    const type = text.slice(start, text.indexOf(";", start));
    expect(type).toContain('"status"');
    expect(type).not.toContain("currentPeriodStart");
    expect(type).not.toContain("currentPeriodEnd");
  });

  it("poza schematem nazwy current_period_start/current_period_end występują tylko jako pole obiektu (`.pole`, `pole:`) albo w komentarzu, nie w surowym SQL", () => {
    const offenders = sourceFiles(SRC)
      .filter((p) => !p.endsWith("lib/schema.ts"))
      .flatMap((p) =>
        readSource(p)
          .split("\n")
          .map((line, i) => ({ line, at: `${relative(ROOT, p)}:${i + 1}` }))
          .filter(({ line }) => !/^\s*(\*|\/\/|\/\*)/.test(line))
          .filter(({ line }) =>
            [...line.matchAll(/current_period_(?:start|end)\b/g)].some((m) => {
              const before = line.slice(0, m.index);
              const after = line.slice(m.index + m[0].length);
              return !/\.$/.test(before) && !/^\??\s*:/.test(after);
            })
          )
          .map(({ at }) => at)
      );
    expect(offenders).toEqual([]);
  });
});
