// Setup script for Feature #131 - Invalid promo code handling
// Creates test promo codes: expired, overused (limit reached), and valid for comparison

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { promotions, promoCodes } from "../src/lib/schema";
import { eq, and } from "drizzle-orm";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  const client = new pg.Client({ connectionString: process.env.POSTGRES_URL });
  await client.connect();
  const db = drizzle(client);

  console.log("Setting up Feature #131 test data...");

  // Ensure we have a test promotion
  let promotionId: string;
  const existingPromos = await db
    .select()
    .from(promotions)
    .where(
      and(
        eq(promotions.salonId, DEMO_SALON_ID),
        eq(promotions.name, "TEST_F131_Promo")
      )
    );

  if (existingPromos.length > 0) {
    promotionId = existingPromos[0]!.id;
    console.log("Test promotion already exists:", promotionId);
  } else {
    const [promo] = await db
      .insert(promotions)
      .values({
        salonId: DEMO_SALON_ID,
        name: "TEST_F131_Promo",
        type: "percentage",
        value: "15.00",
        isActive: true,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        conditionsJson: {},
      })
      .returning();
    promotionId = promo!.id;
    console.log("Created test promotion:", promotionId);
  }

  // 1. Create EXPIRED promo code
  const existingExpired = await db
    .select()
    .from(promoCodes)
    .where(
      and(
        eq(promoCodes.salonId, DEMO_SALON_ID),
        eq(promoCodes.code, "EXPIRED131")
      )
    );

  if (existingExpired.length === 0) {
    const [code] = await db
      .insert(promoCodes)
      .values({
        salonId: DEMO_SALON_ID,
        code: "EXPIRED131",
        promotionId: promotionId,
        usageLimit: 100,
        usedCount: 0,
        expiresAt: new Date("2025-06-01"), // Already expired
      })
      .returning();
    console.log("Created expired code EXPIRED131:", code!.id);
  } else {
    console.log("Expired code EXPIRED131 already exists");
  }

  // 2. Create OVERUSED promo code (usedCount >= usageLimit)
  const existingOverused = await db
    .select()
    .from(promoCodes)
    .where(
      and(
        eq(promoCodes.salonId, DEMO_SALON_ID),
        eq(promoCodes.code, "MAXED131")
      )
    );

  if (existingOverused.length === 0) {
    const [code] = await db
      .insert(promoCodes)
      .values({
        salonId: DEMO_SALON_ID,
        code: "MAXED131",
        promotionId: promotionId,
        usageLimit: 3,
        usedCount: 3, // Usage limit already reached
        expiresAt: new Date("2026-12-31"),
      })
      .returning();
    console.log("Created overused code MAXED131:", code!.id);
  } else {
    console.log("Overused code MAXED131 already exists");
  }

  // 3. Create a VALID promo code for comparison testing
  const existingValid = await db
    .select()
    .from(promoCodes)
    .where(
      and(
        eq(promoCodes.salonId, DEMO_SALON_ID),
        eq(promoCodes.code, "VALID131")
      )
    );

  if (existingValid.length === 0) {
    const [code] = await db
      .insert(promoCodes)
      .values({
        salonId: DEMO_SALON_ID,
        code: "VALID131",
        promotionId: promotionId,
        usageLimit: 100,
        usedCount: 0,
        expiresAt: new Date("2026-12-31"),
      })
      .returning();
    console.log("Created valid code VALID131:", code!.id);
  } else {
    console.log("Valid code VALID131 already exists");
  }

  console.log("\n--- Test Data Summary ---");
  console.log("Promotion: TEST_F131_Promo (15% off, active 2026)");
  console.log("Codes:");
  console.log("  - EXPIRED131: expired 2025-06-01 (should show 'Kod wygasl')");
  console.log("  - MAXED131: usedCount=3, usageLimit=3 (should show 'Limit uzycia wyczerpany')");
  console.log("  - VALID131: valid, 0/100 used (should succeed)");
  console.log("  - (any random text): not in DB (should show 'Nieprawidlowy kod')");

  await client.end();
  console.log("\nDone!");
}

main().catch(console.error);
