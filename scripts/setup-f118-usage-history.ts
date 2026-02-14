import { db } from "../src/lib/db";
import { appointmentMaterials, products, appointments } from "../src/lib/schema";
import { eq, desc, and, notInArray } from "drizzle-orm";

async function setup() {
  console.log("=== Feature #118: Product Usage History Setup ===\n");

  // Get the target product - "Farba do wlosow L'Oreal"
  const allProducts = await db.select().from(products).limit(5);
  console.log("Products found:", allProducts.length);

  const targetProduct = allProducts.find(p => p.name.includes("Farba")) || allProducts[0];
  console.log("Target product:", targetProduct.name, "| ID:", targetProduct.id);
  console.log("  Price per unit:", targetProduct.pricePerUnit, "PLN/" + targetProduct.unit);

  // Check existing usage records for this product
  const existingUsage = await db
    .select()
    .from(appointmentMaterials)
    .where(eq(appointmentMaterials.productId, targetProduct.id));

  console.log("Existing usage records:", existingUsage.length);

  // Get appointment IDs that already have usage records for this product
  const usedAppointmentIds = existingUsage.map(u => u.appointmentId);

  // Get completed appointments NOT already linked
  const completedAppts = await db
    .select()
    .from(appointments)
    .where(
      usedAppointmentIds.length > 0
        ? and(
            eq(appointments.status, "completed"),
            notInArray(appointments.id, usedAppointmentIds)
          )
        : eq(appointments.status, "completed")
    )
    .orderBy(desc(appointments.startTime))
    .limit(3);

  console.log("Available completed appointments (not yet linked):", completedAppts.length);

  if (completedAppts.length === 0 && existingUsage.length >= 2) {
    console.log("\nAlready have enough usage records. Ready for testing!");
    console.log("Product ID:", targetProduct.id);
    console.log("Product URL: /dashboard/products/" + targetProduct.id);
    process.exit(0);
  }

  if (completedAppts.length === 0) {
    console.log("ERROR: No completed appointments available to link.");
    process.exit(1);
  }

  // Create additional usage records
  const notes = [
    "F118_TEST - Full root coloring",
    "F118_TEST - Touch-up highlights",
    "F118_TEST - Balayage treatment",
  ];

  const quantities = ["50.00", "30.00", "75.00"];

  const recordsToCreate = completedAppts.map((appt, i) => ({
    appointmentId: appt.id,
    productId: targetProduct.id,
    quantityUsed: quantities[i] || "25.00",
    notes: notes[i] || null,
  }));

  console.log("\nCreating", recordsToCreate.length, "new usage records...");

  for (const record of recordsToCreate) {
    const [inserted] = await db
      .insert(appointmentMaterials)
      .values(record)
      .returning();
    console.log(`  Created: ${inserted.id} | Qty: ${record.quantityUsed} | Appt: ${record.appointmentId.slice(0, 8)}...`);
  }

  const totalRecords = existingUsage.length + recordsToCreate.length;
  console.log("\n=== Setup Complete ===");
  console.log("Product ID:", targetProduct.id);
  console.log("Product URL: /dashboard/products/" + targetProduct.id);
  console.log("Total usage records:", totalRecords);

  process.exit(0);
}

setup().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
