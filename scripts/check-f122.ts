import { db } from "../src/lib/db";
import { user, salons, productCategories, products } from "../src/lib/schema";
import { eq } from "drizzle-orm";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  // Check salon
  const salon = await db.select().from(salons).where(eq(salons.id, DEMO_SALON_ID)).limit(1);
  if (salon.length > 0) {
    console.log("Salon:", salon[0].name, "| owner:", salon[0].ownerId);

    // Check owner
    if (salon[0].ownerId) {
      const owner = await db.select({ email: user.email, name: user.name }).from(user).where(eq(user.id, salon[0].ownerId)).limit(1);
      if (owner.length > 0) console.log("Owner:", owner[0].email, "|", owner[0].name);
    }
  }

  // Check categories
  const cats = await db.select().from(productCategories).where(eq(productCategories.salonId, DEMO_SALON_ID));
  console.log("\nProduct categories:", cats.length);
  for (const c of cats) {
    console.log(`  - ${c.name} (id: ${c.id})`);
  }

  // Check products
  const prods = await db.select({ id: products.id, name: products.name, category: products.category }).from(products).where(eq(products.salonId, DEMO_SALON_ID));
  console.log("\nProducts:", prods.length);
  for (const p of prods) {
    console.log(`  - ${p.name} | category: ${p.category || "(none)"}`);
  }

  process.exit(0);
}
main().catch(console.error);
