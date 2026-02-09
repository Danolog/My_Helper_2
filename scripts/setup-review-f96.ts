import { db } from "../src/lib/db";
import { appointments, employees, services, user, salons, clients } from "../src/lib/schema";
import { eq } from "drizzle-orm";

async function main() {
  // Find the review96@test.com user
  const targetUsers = await db.select().from(user).where(eq(user.email, "review96@test.com")).limit(1);
  const targetUser = targetUsers[0];
  if (!targetUser) {
    console.log("ERROR: User review96@test.com not found - register first");
    process.exit(1);
  }
  console.log("USER_ID: " + targetUser.id);

  // Verify email if not already verified
  if (!targetUser.emailVerified) {
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, targetUser.id));
    console.log("Email verified manually");
  }

  // Get a salon
  const salonList = await db.select().from(salons).limit(1);
  if (!salonList[0]) {
    console.log("No salons found");
    process.exit(1);
  }
  const salon = salonList[0];
  console.log("SALON: " + salon.name);

  // Get an employee
  const empList = await db.select().from(employees).where(eq(employees.salonId, salon.id)).limit(1);
  const emp = empList[0];
  console.log("EMPLOYEE: " + emp.firstName + " " + emp.lastName);

  // Get a service
  const svcList = await db.select().from(services).where(eq(services.salonId, salon.id)).limit(1);
  const svc = svcList[0];
  console.log("SERVICE: " + svc.name);

  // Get a client
  const clientList = await db.select().from(clients).where(eq(clients.salonId, salon.id)).limit(1);
  const client = clientList[0] || null;

  // Create a completed appointment in the past for review96 user
  const pastDate = new Date("2026-02-02T10:00:00.000Z");
  const pastDateEnd = new Date("2026-02-02T11:00:00.000Z");

  const result = await db.insert(appointments).values({
    salonId: salon.id,
    clientId: client ? client.id : null,
    employeeId: emp.id,
    serviceId: svc.id,
    bookedByUserId: targetUser.id,
    startTime: pastDate,
    endTime: pastDateEnd,
    status: "completed",
    notes: "TEST_REVIEW_F96 - text-only review testing",
  }).returning();

  const newAppt = result[0];
  console.log("APPOINTMENT_ID: " + newAppt.id);
  console.log("STATUS: " + newAppt.status);
  console.log("SETUP COMPLETE - navigate to /appointments/" + newAppt.id);

  process.exit(0);
}

main().catch(console.error);
