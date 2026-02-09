import "dotenv/config";
import { db } from "../src/lib/db";
import { user, salons, appointments, clients, employees, services, reviews } from "../src/lib/schema";
import { eq, and, like } from "drizzle-orm";

async function main() {
  const ownerEmail = "owner99@test.com";
  const clientEmail = "client99@test.com";

  // Step 1: Check if owner user exists (we'll register via browser if not)
  let [ownerUser] = await db.select().from(user).where(eq(user.email, ownerEmail)).limit(1);
  if (!ownerUser) {
    console.log("Owner user not found - will need to register " + ownerEmail + " via browser first");
    console.log("STATUS: NEEDS_REGISTRATION");
    process.exit(0);
  }
  console.log("Owner user:", ownerUser.id, ownerUser.email);

  // Step 2: Set the user as owner role
  await db.update(user).set({ role: "owner" }).where(eq(user.id, ownerUser.id));
  console.log("Set user role to owner");

  // Step 3: Link salon to owner
  const [salon] = await db
    .update(salons)
    .set({ ownerId: ownerUser.id })
    .where(eq(salons.id, "00000000-0000-0000-0000-000000000001"))
    .returning();
  console.log("Linked salon:", salon?.id, "to owner:", salon?.ownerId);

  // Step 4: Get an employee and service
  const [emp] = await db.select().from(employees).where(eq(employees.salonId, salon.id)).limit(1);
  const [svc] = await db.select().from(services).where(eq(services.salonId, salon.id)).limit(1);

  if (!emp || !svc) {
    console.error("No employees or services found. Run seed first.");
    process.exit(1);
  }
  console.log("Employee:", emp.id, emp.firstName);
  console.log("Service:", svc.id, svc.name);

  // Step 5: Get or create client record
  let [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.email, clientEmail))
    .limit(1);
  if (!client) {
    const [newClient] = await db
      .insert(clients)
      .values({
        salonId: salon.id,
        firstName: "Test",
        lastName: "ClientF99",
        email: clientEmail,
        phone: "+48 999 888 777",
      })
      .returning();
    client = newClient;
    console.log("Created client:", client.id);
  } else {
    console.log("Found existing client:", client.id);
  }

  // Step 6: Clean up old test data
  const oldReviews = await db
    .select()
    .from(reviews)
    .where(like(reviews.comment, "%TEST_F99%"));
  if (oldReviews.length > 0) {
    for (const r of oldReviews) {
      await db.delete(reviews).where(eq(reviews.id, r.id));
    }
    console.log(`Cleaned up ${oldReviews.length} old F99 reviews`);
  }

  // Step 7: Create a completed appointment for the client
  const startDate = new Date("2026-01-20T14:00:00.000Z");
  const endDate = new Date("2026-01-20T15:00:00.000Z");

  // Check if appointment already exists
  let [existingAppt] = await db
    .select()
    .from(appointments)
    .where(and(
      eq(appointments.notes, "TEST_F99_INAPPROPRIATE_REVIEW"),
      eq(appointments.clientId, client.id)
    ))
    .limit(1);

  let appt;
  if (existingAppt) {
    appt = existingAppt;
    console.log("Found existing appointment:", appt.id);
  } else {
    // Need a user for bookedByUserId
    let [clientUser] = await db.select().from(user).where(eq(user.email, clientEmail)).limit(1);
    if (!clientUser) {
      // Use the owner as bookedBy if client user doesn't exist
      [appt] = await db
        .insert(appointments)
        .values({
          salonId: salon.id,
          clientId: client.id,
          employeeId: emp.id,
          serviceId: svc.id,
          bookedByUserId: ownerUser.id,
          startTime: startDate,
          endTime: endDate,
          status: "completed",
          notes: "TEST_F99_INAPPROPRIATE_REVIEW",
        })
        .returning();
    } else {
      [appt] = await db
        .insert(appointments)
        .values({
          salonId: salon.id,
          clientId: client.id,
          employeeId: emp.id,
          serviceId: svc.id,
          bookedByUserId: clientUser.id,
          startTime: startDate,
          endTime: endDate,
          status: "completed",
          notes: "TEST_F99_INAPPROPRIATE_REVIEW",
        })
        .returning();
    }
    console.log("Created appointment:", appt.id);
  }

  // Step 8: Create an inappropriate pending review
  const [review] = await db
    .insert(reviews)
    .values({
      salonId: salon.id,
      clientId: client.id,
      employeeId: emp.id,
      appointmentId: appt.id,
      rating: 1,
      comment: "TEST_F99_INAPPROPRIATE: Ten salon jest okropny! Nigdy nie chodźcie tutaj! Oszuści!",
      status: "pending",
    })
    .returning();
  console.log(`Created inappropriate pending review: ${review.id}`);

  // Also create a second pending review (normal one for comparison)
  const startDate2 = new Date("2026-01-22T10:00:00.000Z");
  const endDate2 = new Date("2026-01-22T11:00:00.000Z");

  let [appt2] = await db
    .insert(appointments)
    .values({
      salonId: salon.id,
      clientId: client.id,
      employeeId: emp.id,
      serviceId: svc.id,
      bookedByUserId: ownerUser.id,
      startTime: startDate2,
      endTime: endDate2,
      status: "completed",
      notes: "TEST_F99_NORMAL_REVIEW",
    })
    .returning();

  const [review2] = await db
    .insert(reviews)
    .values({
      salonId: salon.id,
      clientId: client.id,
      employeeId: emp.id,
      appointmentId: appt2.id,
      rating: 5,
      comment: "TEST_F99_NORMAL: Świetna obsługa, bardzo polecam!",
      status: "pending",
    })
    .returning();
  console.log(`Created normal pending review: ${review2.id}`);

  console.log("\n=== SETUP COMPLETE ===");
  console.log("Owner account:", ownerEmail, "(login to moderate reviews at /dashboard/reviews)");
  console.log("Inappropriate review ID:", review.id, "(1 star, nasty comment - should be REJECTED)");
  console.log("Normal review ID:", review2.id, "(5 stars, positive - can be approved for comparison)");
  console.log("STATUS: READY");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
