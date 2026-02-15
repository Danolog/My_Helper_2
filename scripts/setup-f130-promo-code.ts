// Setup script for Feature #130 - Validate promo code
// Creates a test promo code linked to a percentage discount promotion

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

  console.log("Setting up Feature #130 test data...");

  // Check if test promotion already exists
  const existingPromos = await db
    .select()
    .from(promotions)
    .where(
      and(
        eq(promotions.salonId, DEMO_SALON_ID),
        eq(promotions.name, "TEST_F130_Promo")
      )
    );

  let promotionId: string;

  if (existingPromos.length > 0) {
    promotionId = existingPromos[0]!.id;
    console.log("Test promotion already exists:", promotionId);
  } else {
    // Create a percentage discount promotion (20% off)
    const [promo] = await db
      .insert(promotions)
      .values({
        salonId: DEMO_SALON_ID,
        name: "TEST_F130_Promo",
        type: "percentage",
        value: "20.00",
        isActive: true,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        conditionsJson: {},
      })
      .returning();
    promotionId = promo!.id;
    console.log("Created test promotion:", promotionId);
  }

  // Check if test promo code already exists
  const existingCodes = await db
    .select()
    .from(promoCodes)
    .where(
      and(
        eq(promoCodes.salonId, DEMO_SALON_ID),
        eq(promoCodes.code, "TEST130")
      )
    );

  if (existingCodes.length > 0) {
    console.log("Test promo code already exists:", existingCodes[0]!.id);
  } else {
    // Create a promo code with a usage limit
    const [code] = await db
      .insert(promoCodes)
      .values({
        salonId: DEMO_SALON_ID,
        code: "TEST130",
        promotionId: promotionId,
        usageLimit: 5,
        usedCount: 0,
        expiresAt: new Date("2026-12-31"),
      })
      .returning();
    console.log("Created promo code TEST130:", code!.id);
  }

  // Also create an expired promo code for testing invalid codes
  const existingExpired = await db
    .select()
    .from(promoCodes)
    .where(
      and(
        eq(promoCodes.salonId, DEMO_SALON_ID),
        eq(promoCodes.code, "EXPIRED130")
      )
    );

  if (existingExpired.length === 0) {
    const [expiredCode] = await db
      .insert(promoCodes)
      .values({
        salonId: DEMO_SALON_ID,
        code: "EXPIRED130",
        promotionId: promotionId,
        usageLimit: 10,
        usedCount: 0,
        expiresAt: new Date("2025-01-01"), // Already expired
      })
      .returning();
    console.log("Created expired promo code EXPIRED130:", expiredCode!.id);
  }

  console.log("\nTest data summary:");
  console.log("- Promotion: TEST_F130_Promo (20% off, active until 2026-12-31)");
  console.log("- Promo code: TEST130 (5 uses, expires 2026-12-31)");
  console.log("- Promo code: EXPIRED130 (expired on 2025-01-01)");

  await client.end();
  console.log("Done!");
}

main().catch(console.error);
