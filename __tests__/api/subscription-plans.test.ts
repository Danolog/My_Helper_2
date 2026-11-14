/**
 * GET /api/subscription-plans — listy funkcji pochodzą z kodu
 * (`src/lib/plan-features.ts`), nie z kolumny `features_json`.
 * Stare wiersze w bazie produkcyjnej obiecują wyłączone funkcje (B9).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PLAN_FEATURES } from "@/lib/plan-features";

const rows: Array<Record<string, unknown>> = [];

vi.mock("@/lib/db", () => {
  const where = vi.fn(async () => rows);
  return {
    db: {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    },
  };
});

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { GET } from "@/app/api/subscription-plans/route";

const STALE = ["Asystent głosowy AI", "Publikacja postów social", "Drukarka fiskalna"];

function row(slug: string, featuresJson: unknown) {
  return {
    id: `id-${slug}`,
    name: slug,
    slug,
    priceMonthly: "49.00",
    featuresJson,
    isActive: true,
  };
}

describe("GET /api/subscription-plans", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it("zwraca listy z PLAN_FEATURES, ignorując nieaktualne features_json w bazie", async () => {
    rows.push(row("basic", STALE), row("pro", STALE));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    const bySlug = Object.fromEntries(
      body.data.map((p: { slug: string; features: string[] }) => [p.slug, p.features]),
    );
    expect(bySlug.basic).toEqual([...PLAN_FEATURES.basic]);
    expect(bySlug.pro).toEqual([...PLAN_FEATURES.pro]);
    expect(JSON.stringify(body)).not.toContain("głosowy");
  });

  it("plan spoza PLAN_FEATURES zachowuje listę z bazy", async () => {
    rows.push(row("enterprise", ["Dedykowany opiekun"]));
    const body = await (await GET()).json();
    expect(body.data[0].features).toEqual(["Dedykowany opiekun"]);
  });

  it("plan spoza PLAN_FEATURES bez listy w bazie dostaje pustą tablicę", async () => {
    rows.push(row("enterprise", null));
    const body = await (await GET()).json();
    expect(body.data[0].features).toEqual([]);
  });

  it("slug będący nazwą odziedziczoną (constructor) nie wywraca trasy", async () => {
    rows.push(row("constructor", ["Dedykowany opiekun"]));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].features).toEqual(["Dedykowany opiekun"]);
  });

  it("błąd bazy -> 500", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.select).mockImplementationOnce(() => {
      throw new Error("db down");
    });
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
