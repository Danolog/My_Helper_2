import { db } from "../src/lib/db";
import { user, appointments, clients, employees, services } from "../src/lib/schema";
import { eq } from "drizzle-orm";

async function main() {
  // Find our test user
  const [testUser] = await db
    .select()
    .from(user)
    .where(eq(user.email, "review95@test.com"))
    .limit(1);

  if (!testUser) {
    console.error("Test user review95@test.com not found");
    process.exit(1);
  }

  console.log("Found user:", testUser.id, testUser.name);

  // Get an employee
  const [emp] = await db.select().from(employees).limit(1);
  if (!emp) {
    console.error("No employees found");
    process.exit(1);
  }
  console.log("Employee:", emp.id, emp.firstName, emp.lastName);

  // Get a service
  const [svc] = await db.select().from(services).limit(1);
  if (!svc) {
    console.error("No services found");
    process.exit(1);
  }
  console.log("Service:", svc.id, svc.name);

  // Get or create a client linked to the salon
  let [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.email, "review95@test.com"))
    .limit(1);

  if (!client) {
    const [newClient] = await db
      .insert(clients)
      .values({
        salonId: emp.salonId,
        firstName: "Test",
        lastName: "Review95",
        email: "review95@test.com",
        phone: "+48 999 888 777",
      })
      .returning();
    client = newClient;
    console.log("Created client:", client.id);
  } else {
    console.log("Found client:", client.id);
  }

  // Create a completed appointment booked by this user
  const pastDate = new Date("2026-02-01T10:00:00.000Z");
  const endDate = new Date("2026-02-01T11:00:00.000Z");

  const [appt] = await db
    .insert(appointments)
    .values({
      salonId: emp.salonId,
      clientId: client.id,
      employeeId: emp.id,
      serviceId: svc.id,
      bookedByUserId: testUser.id,
      startTime: pastDate,
      endTime: endDate,
      status: "completed",
      notes: "TEST_REVIEW_F95",
    })
    .returning();

  console.log("Created completed appointment:", appt.id);
  console.log("Appointment status:", appt.status);
  console.log("SUCCESS - Navigate to /appointments/" + appt.id + " to test review");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
