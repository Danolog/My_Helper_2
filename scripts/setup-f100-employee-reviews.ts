import "dotenv/config";
import { db } from "../src/lib/db";
import { salons, employees, clients, reviews, services } from "../src/lib/schema";
import { eq, and } from "drizzle-orm";

/**
 * Setup script for Feature #100: Reviews displayed on employee profile
 * Creates approved reviews with client names for a specific employee
 */
async function main() {
  const salonId = "00000000-0000-0000-0000-000000000001";

  // Step 1: Get salon
  const [salon] = await db.select().from(salons).where(eq(salons.id, salonId));
  if (!salon) {
    console.error("Salon not found. Run seed first.");
    process.exit(1);
  }
  console.log("Salon:", salon.id, salon.name);

  // Step 2: Get first employee
  const [emp] = await db.select().from(employees).where(eq(employees.salonId, salonId)).limit(1);
  if (!emp) {
    console.error("No employees found. Run seed first.");
    process.exit(1);
  }
  console.log("Employee:", emp.id, emp.firstName, emp.lastName);

  // Step 3: Clean up previous test data for this feature
  const existingTestReviews = await db
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.employeeId, emp.id),
        eq(reviews.status, "approved")
      )
    );
  console.log("Existing approved reviews for employee:", existingTestReviews.length);

  // Step 4: Create test clients if not existing
  const testClients = [
    { firstName: "Maria", lastName: "Testowa", email: "maria.f100@test.com", phone: "+48111222333" },
    { firstName: "Jan", lastName: "Kowalski", email: "jan.f100@test.com", phone: "+48444555666" },
    { firstName: "Katarzyna", lastName: "Nowak", email: "kat.f100@test.com", phone: "+48777888999" },
  ];

  const clientIds: string[] = [];
  for (const tc of testClients) {
    let [existing] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.email, tc.email), eq(clients.salonId, salonId)))
      .limit(1);

    if (!existing) {
      const [created] = await db
        .insert(clients)
        .values({
          salonId,
          firstName: tc.firstName,
          lastName: tc.lastName,
          email: tc.email,
          phone: tc.phone,
        })
        .returning();
      clientIds.push(created.id);
      console.log("Created client:", tc.firstName, tc.lastName, created.id);
    } else {
      clientIds.push(existing.id);
      console.log("Client exists:", tc.firstName, tc.lastName, existing.id);
    }
  }

  // Step 5: Create approved reviews from these clients
  const reviewData = [
    {
      clientId: clientIds[0],
      rating: 5,
      comment: "Fantastyczna obsluga! Bardzo polecam. TEST_F100",
      createdAt: new Date("2026-02-01T10:00:00Z"),
    },
    {
      clientId: clientIds[1],
      rating: 4,
      comment: "Bardzo profesjonalne podejscie. Wrocilam zadowolona.",
      createdAt: new Date("2026-02-03T14:30:00Z"),
    },
    {
      clientId: clientIds[2],
      rating: 5,
      comment: null, // star-only review
      createdAt: new Date("2026-02-05T09:15:00Z"),
    },
  ];

  for (const rd of reviewData) {
    // Check if review already exists for this client+employee
    const [existing] = await db
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.clientId, rd.clientId),
          eq(reviews.employeeId, emp.id),
          eq(reviews.salonId, salonId)
        )
      )
      .limit(1);

    if (existing) {
      // Update to approved
      await db.update(reviews).set({ status: "approved", rating: rd.rating, comment: rd.comment }).where(eq(reviews.id, existing.id));
      console.log("Updated existing review to approved:", existing.id);
    } else {
      const [created] = await db
        .insert(reviews)
        .values({
          salonId,
          clientId: rd.clientId,
          employeeId: emp.id,
          rating: rd.rating,
          comment: rd.comment,
          status: "approved",
          createdAt: rd.createdAt,
        })
        .returning();
      console.log("Created approved review:", created.id, "rating:", rd.rating, "from client:", rd.clientId);
    }
  }

  console.log("\nSetup complete! Navigate to:");
  console.log(`/salons/${salonId}/employees/${emp.id}`);
  console.log("to verify reviews section.");

  process.exit(0);
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
