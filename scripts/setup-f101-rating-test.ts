import "dotenv/config";
import { db } from "../src/lib/db";
import { user, salons, appointments, clients, employees, services, reviews } from "../src/lib/schema";
import { eq, and } from "drizzle-orm";

async function main() {
  const salonId = "00000000-0000-0000-0000-000000000001";
  const employeeId = "1cbc4872-7ba0-4819-82ae-6f5d4ef97df9"; // Anna Kowalska

  // Step 1: Get the employee
  const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId));
  if (!emp) {
    console.error("Employee not found:", employeeId);
    process.exit(1);
  }
  console.log("Employee:", emp.firstName, emp.lastName);

  // Step 2: Get existing approved reviews for this employee to verify current average
  const existingReviews = await db
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.employeeId, employeeId),
        eq(reviews.status, "approved")
      )
    );
  console.log("Existing approved reviews:", existingReviews.length);
  for (const r of existingReviews) {
    console.log(`  - Rating: ${r.rating}, Comment: ${r.comment?.substring(0, 60)}`);
  }

  const currentSum = existingReviews.reduce((sum, r) => sum + (r.rating || 0), 0);
  const currentAvg = existingReviews.length > 0 ? currentSum / existingReviews.length : 0;
  console.log(`Current average: ${currentAvg} (from ${existingReviews.length} reviews)`);

  // Step 3: Get or create a client for the test
  let [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.email, "testf101@test.com"))
    .limit(1);
  if (!client) {
    const [newClient] = await db
      .insert(clients)
      .values({
        salonId: salonId,
        firstName: "Feature101",
        lastName: "Tester",
        email: "testf101@test.com",
        phone: "+48 101 101 101",
      })
      .returning();
    client = newClient;
    console.log("Created client:", client.id);
  } else {
    console.log("Found existing client:", client.id);
  }

  // Step 4: Get a service
  const [svc] = await db.select().from(services).where(eq(services.salonId, salonId)).limit(1);
  if (!svc) {
    console.error("No services found for salon");
    process.exit(1);
  }

  // Step 5: Clean up any previous test data from this feature
  const oldReviews = await db.select().from(reviews).where(eq(reviews.clientId, client.id));
  for (const r of oldReviews) {
    if (r.comment && r.comment.includes("TEST_F101_")) {
      await db.delete(reviews).where(eq(reviews.id, r.id));
      console.log("Cleaned up old test review:", r.id);
    }
  }
  // Also clean up test appointments
  const oldAppts = await db.select().from(appointments).where(eq(appointments.clientId, client.id));
  for (const a of oldAppts) {
    if (a.notes && a.notes.includes("TEST_F101_")) {
      await db.delete(appointments).where(eq(appointments.id, a.id));
      console.log("Cleaned up old test appointment:", a.id);
    }
  }

  // Step 6: Create a completed appointment
  const startDate = new Date("2026-01-25T14:00:00.000Z");
  const endDate = new Date("2026-01-25T15:00:00.000Z");
  const [appt] = await db
    .insert(appointments)
    .values({
      salonId: salonId,
      clientId: client.id,
      employeeId: employeeId,
      serviceId: svc.id,
      startTime: startDate,
      endTime: endDate,
      status: "completed",
      notes: "TEST_F101_APPOINTMENT",
    })
    .returning();
  console.log("Created appointment:", appt.id);

  // Step 7: Create a new approved review with rating 3
  // This should change the average from 4.5 (4+5)/2 to 4.0 (4+5+3)/3
  const [newReview] = await db
    .insert(reviews)
    .values({
      salonId: salonId,
      clientId: client.id,
      employeeId: employeeId,
      appointmentId: appt.id,
      rating: 3,
      comment: "TEST_F101_REVIEW: Usluga ok, ale mogloby byc lepiej. Troche dlugo czekalem.",
      status: "approved",
    })
    .returning();
  console.log("Created approved review:", newReview.id, "with rating:", newReview.rating);

  // Step 8: Calculate expected new average
  const newSum = currentSum + 3;
  const newCount = existingReviews.length + 1;
  const expectedAvg = newSum / newCount;
  console.log(`\n=== EXPECTED RESULTS ===`);
  console.log(`Previous average: ${currentAvg.toFixed(1)} (${existingReviews.length} reviews)`);
  console.log(`New average: ${expectedAvg.toFixed(4)} (${newCount} reviews)`);
  console.log(`Expected displayed average: ${expectedAvg.toFixed(1)}`);
  console.log(`Review ID: ${newReview.id}`);
  console.log(`Appointment ID: ${appt.id}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
