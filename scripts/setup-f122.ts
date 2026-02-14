/**
 * Setup script for Feature #122 - Product categories
 * Creates a test user and links it to the demo salon as owner
 */
import { db } from "../src/lib/db";
import { users, salons } from "../src/lib/schema";
import { eq } from "drizzle-orm";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";
const TEST_EMAIL = "feature122@test.com";

async function setup() {
  console.log("Setting up Feature #122 test data...");

  // Check if user already exists
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.email, TEST_EMAIL))
    .limit(1);

  if (existingUser.length > 0) {
    console.log(`User ${TEST_EMAIL} already exists (id: ${existingUser[0].id})`);

    // Link to salon
    await db
      .update(salons)
      .set({ ownerId: existingUser[0].id })
      .where(eq(salons.id, DEMO_SALON_ID));
    console.log("Linked existing user to demo salon");
  } else {
    console.log(`User ${TEST_EMAIL} does not exist yet - will be created via registration`);
  }

  // Check salon exists
  const salon = await db
    .select()
    .from(salons)
    .where(eq(salons.id, DEMO_SALON_ID))
    .limit(1);

  if (salon.length === 0) {
    console.log("Demo salon not found! Creating...");
    await db.insert(salons).values({
      id: DEMO_SALON_ID,
      name: "Demo Salon",
      slug: "demo-salon",
      address: "ul. Testowa 1",
      city: "Warszawa",
      phone: "123456789",
    });
    console.log("Demo salon created");
  } else {
    console.log(`Demo salon exists: ${salon[0].name}`);
  }

  console.log("Setup complete!");
  process.exit(0);
}

setup().catch((err) => {
  console.error("Setup error:", err);
  process.exit(1);
});
