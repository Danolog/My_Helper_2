/**
 * Dane salonu dla AI na PRAWDZIWYM Postgresie, przez `forSalon(salonId)` (rola
 * bez BYPASSRLS + `app.current_salon_id`):
 * - `getSalonContext(A)`: nazwa i branża salonu A, nigdy B;
 * - `gatherSalonData(A)`: liczby, usługi, pracownicy, opinie i magazyn tylko z A,
 *   choć salon B ma w tych samych tabelach więcej wierszy i większe kwoty;
 * - `checkAIBudget(A)`: koszt i liczba obrazów tylko z wierszy A
 *   (`ai_generated_media` salonu B przekroczyłby limit obrazów);
 * - `trackAIUsage(A, …)`: wiersz zapisany z `salon_id = A`; `salonId` B podany
 *   w `metadata` zostaje w metadanych i nie zmienia `salon_id`;
 * - kontrola warstwy bazy: w `forSalon(A)` zapytanie bez warunku WHERE na
 *   `salons` i tak widzi tylko salon A (RLS).
 *
 * Dane: konta `it-t3-ai-…` (prefiks z notatki sprzątania w pg-harness.ts),
 * salony A i B; reszta kaskadą z salonów w `afterAll`.
 * Wymaga bazy po `pnpm db:migrate` (RLS i rola `myhelper_app`).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { gatherSalonData } from "@/lib/ai/business/chat";
import { getSalonContext, trackAIUsage } from "@/lib/ai/openrouter";
import { checkAIBudget } from "@/lib/ai/usage-limits";
import {
  aiGeneratedMedia,
  appointments,
  clients,
  employees,
  products,
  reviews,
  salons,
  services,
  user,
} from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));

const suite = h ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-ai-a-${RUN}`;
const OWNER_B = `it-t3-ai-b-${RUN}`;
const NAME_A = `IT ai A ${RUN}`;
const NAME_B = `IT ai B ${RUN}`;
const FEATURE = `it-ai-${RUN}`;
const ids = { salonA: "", salonB: "" };

/** Dwa dni temu — w oknie 30 dni `gatherSalonData`. */
const RECENT = new Date(Date.now() - 2 * 86_400_000);

async function seedSalon(salonId: string, spec: {
  employeeFirstName: string;
  serviceName: string;
  servicePrice: string;
  clientCount: number;
  completedVisits: number;
  rating: number;
  reviewCount: number;
  productName: string;
  imageRows: number;
}) {
  const db = h!.db;
  const [emp] = await db
    .insert(employees)
    .values({ salonId, firstName: spec.employeeFirstName, lastName: "Testowa" })
    .returning({ id: employees.id });
  const [svc] = await db
    .insert(services)
    .values({ salonId, name: spec.serviceName, basePrice: spec.servicePrice, baseDuration: 30 })
    .returning({ id: services.id });
  await db.insert(clients).values(
    Array.from({ length: spec.clientCount }, (_, i) => ({
      salonId,
      firstName: `IT${i}`,
      lastName: "Klient",
    })),
  );
  for (let i = 0; i < spec.completedVisits; i++) {
    const start = new Date(RECENT.getTime() + i * 3_600_000);
    await db.insert(appointments).values({
      salonId,
      employeeId: emp!.id,
      serviceId: svc!.id,
      startTime: start,
      endTime: new Date(start.getTime() + 1_800_000),
      status: "completed",
    });
  }
  await db.insert(reviews).values(
    Array.from({ length: spec.reviewCount }, () => ({ salonId, rating: spec.rating, status: "pending" })),
  );
  await db.insert(products).values({ salonId, name: spec.productName, quantity: "1", minQuantity: "5" });
  if (spec.imageRows > 0) {
    await db.insert(aiGeneratedMedia).values(
      Array.from({ length: spec.imageRows }, () => ({
        salonId,
        type: "image",
        provider: "google_imagen",
        prompt: "it-seed",
        status: "completed",
      })),
    );
  }
}

suite("dane salonu dla AI przez forSalon — prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_A, name: "IT ai A", email: `${OWNER_A}@example.invalid` },
      { id: OWNER_B, name: "IT ai B", email: `${OWNER_B}@example.invalid` },
    ]);
    const [a] = await db
      .insert(salons)
      .values({ name: NAME_A, ownerId: OWNER_A, industryType: "hair_salon" })
      .returning({ id: salons.id });
    const [b] = await db
      .insert(salons)
      .values({ name: NAME_B, ownerId: OWNER_B, industryType: "spa" })
      .returning({ id: salons.id });
    ids.salonA = a!.id;
    ids.salonB = b!.id;

    await seedSalon(ids.salonA, {
      employeeFirstName: "Alicja",
      serviceName: `IT usługa A ${RUN}`,
      servicePrice: "200.00",
      clientCount: 2,
      completedVisits: 1,
      rating: 5,
      reviewCount: 1,
      productName: `IT produkt A ${RUN}`,
      imageRows: 5,
    });
    await seedSalon(ids.salonB, {
      employeeFirstName: "Barbara",
      serviceName: `IT usługa B ${RUN}`,
      servicePrice: "999.99",
      clientCount: 3,
      completedVisits: 2,
      rating: 1,
      reviewCount: 2,
      productName: `IT produkt B ${RUN}`,
      imageRows: 300,
    });
  });

  afterAll(async () => {
    if (!h) return;
    try {
      for (const s of [ids.salonA, ids.salonB]) if (s) await h.db.delete(salons).where(eq(salons.id, s));
      await h.db.delete(user).where(inArray(user.id, [OWNER_A, OWNER_B]));
    } finally {
      await h.end();
    }
  });

  it("getSalonContext(A): nazwa i branża salonu A", async () => {
    await expect(getSalonContext(ids.salonA)).resolves.toEqual({
      salonName: NAME_A,
      industryType: "hair_salon",
      industryLabel: "salon fryzjerski",
    });
  });

  it("getSalonContext(B): nazwa i branża salonu B (ten sam kod, drugi salon)", async () => {
    const ctx = await getSalonContext(ids.salonB);
    expect(ctx.salonName).toBe(NAME_B);
    expect(ctx.industryType).toBe("spa");
  });

  it("gatherSalonData(A): tylko liczby i nazwy z salonu A", async () => {
    const result = await gatherSalonData(ids.salonA);

    expect(result.salonName).toBe(NAME_A);
    expect(result.industryType).toBe("hair_salon");
    const { data } = result;
    expect(data).toContain(`DANE SALONU "${NAME_A}"`);
    expect(data).toContain("- Liczba klientow: 2");
    expect(data).toContain("- Aktywni pracownicy: 1");
    expect(data).toContain("- Aktywne uslugi: 1");
    expect(data).toContain("- Laczna liczba wizyt: 1");
    expect(data).toContain("- Przychod z ukonczonych wizyt: 200.00 PLN");
    expect(data).toContain(`1. IT usługa A ${RUN} - 1 wizyt (200.00 PLN)`);
    expect(data).toContain("1. Alicja - 1 wizyt");
    expect(data).toContain("- Srednia ocena: 5.0/5.0 (1 opinii)");
    expect(data).toContain(`IT produkt A ${RUN}`);
    for (const fromB of [NAME_B, `IT usługa B ${RUN}`, "Barbara", "999.99", `IT produkt B ${RUN}`]) {
      expect(data).not.toContain(fromB);
    }
  });

  it("checkAIBudget(A): koszt i obrazy tylko z wierszy A", async () => {
    const result = await checkAIBudget(ids.salonA, "image");

    expect(result.usage).toEqual({ totalCostUSD: 0.05, imageCount: 5 });
    expect(result.allowed).toBe(true);
  });

  it("checkAIBudget(B): wiersze B liczone dla B (limit obrazów przekroczony)", async () => {
    const result = await checkAIBudget(ids.salonB, "image");

    expect(result.usage.imageCount).toBe(300);
    expect(result.allowed).toBe(false);
  });

  it("trackAIUsage(A, …): salon_id = A, salonId B w metadata nie zmienia salon_id", async () => {
    await trackAIUsage(ids.salonA, FEATURE, { salonId: ids.salonB });

    const rows = await h!.db
      .select({ salonId: aiGeneratedMedia.salonId, metadata: aiGeneratedMedia.metadata })
      .from(aiGeneratedMedia)
      .where(eq(aiGeneratedMedia.prompt, FEATURE));
    expect(rows).toEqual([
      { salonId: ids.salonA, metadata: { feature: FEATURE, salonId: ids.salonB } },
    ]);
    const inB = await h!.db
      .select({ id: aiGeneratedMedia.id })
      .from(aiGeneratedMedia)
      .where(and(eq(aiGeneratedMedia.salonId, ids.salonB), eq(aiGeneratedMedia.prompt, FEATURE)));
    expect(inB).toEqual([]);
  });

  it("kontrola warstwy bazy: forSalon(A) bez warunku WHERE widzi tylko salon A", async () => {
    const visible = await forSalon(ids.salonA).raw((tx) =>
      tx.select({ id: salons.id }).from(salons),
    );

    expect(visible).toEqual([{ id: ids.salonA }]);
  });
});
