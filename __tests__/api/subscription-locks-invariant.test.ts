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

/** Tekst w nawiasach zaczynających się na `open` (indeks znaku `(`). */
function balanced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error("unbalanced parentheses");
}

interface SubscriptionWrite {
  file: string;
  payload: string;
  /** Odbiorca wywołania: identyfikator przed `.insert(`/`.update(` (np. `tx`, `db`). */
  receiver: string;
}

function subscriptionWrites(): SubscriptionWrite[] {
  const writes: SubscriptionWrite[] = [];
  for (const path of sourceFiles(SRC)) {
    const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    const re = /\.(insert|update)\(salonSubscriptions\)/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const rest = text.slice(m.index + m[0].length);
      const call = /^\s*\.(values|set)\(/.exec(rest);
      if (!call) throw new Error(`${relative(ROOT, path)}: write without .values/.set`);
      const open = m.index + m[0].length + call[0].length - 1;
      const receiver = /([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(0, m.index))?.[1] ?? "";
      writes.push({ file: relative(ROOT, path), payload: balanced(text, open), receiver });
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
      .filter((w) => w.payload.includes("stripeSubscriptionId") || /\.\.\.(?!state\b|\()/.test(w.payload))
      .map((w) => w.file);
    // Dozwolone rozwinięcia: `...state` (wynik subscriptionStateFromStripe, typ
    // SubscriptionStateUpdate) i `...(warunek ? { literał } : {})` — literał
    // jest w payloadzie, więc sprawdza go warunek `includes` powyżej.
    expect(offenders).toEqual([]);
  });

  it("typ SubscriptionStateUpdate (`...state` w webhooku) nie obejmuje stripeSubscriptionId", () => {
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
 * T3b (Ethan, pr62-shape §1 „ten sam wyścig”): KAŻDY zapis salon_subscriptions
 * idzie przez transakcję (`tx`), a plik bierze blokadę salonu — bez wyjątków
 * dla cancel, downgrade, expiration-warning i register-subscription.
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
        "src/app/api/subscriptions/expiration-warning/route.ts",
      ])
    );
    const unlocked = files.filter((file) => {
      const text = readFileSync(join(ROOT, file), "utf8");
      return !LOCK_HELPERS.some((h) => text.includes(h));
    });
    expect(unlocked).toEqual([]);
  });
});
