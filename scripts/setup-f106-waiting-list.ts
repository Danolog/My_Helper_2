import "dotenv/config";
import { db } from "../src/lib/db";
import { user, salons, clients, employees, services, appointments, waitingList } from "../src/lib/schema";
import { eq, and } from "drizzle-orm";

async function setup() {
  const testEmail = "waitlist106@test.com";

  // Set user as owner
  await db.update(user).set({ role: "owner" }).where(eq(user.email, testEmail));
  console.log("Set user role to owner");

  // Get user ID
  const [testUser] = await db.select().from(user).where(eq(user.email, testEmail)).limit(1);
  if (!testUser) {
    console.error("User not found");
    process.exit(1);
  }

  // Get or create salon
  let [salon] = await db.select().from(salons).where(eq(salons.ownerId, testUser.id)).limit(1);
  if (!salon) {
    [salon] = await db.insert(salons).values({
      name: "Salon Test F106",
      ownerId: testUser.id,
      address: "ul. Testowa 1, Warszawa",
      phone: "+48111222333",
    }).returning();
    console.log("Created salon:", salon.id);
  } else {
    console.log("Using existing salon:", salon.id);
  }

  // Get or create employee
  let [emp] = await db.select().from(employees).where(eq(employees.salonId, salon.id)).limit(1);
  if (!emp) {
    [emp] = await db.insert(employees).values({
      salonId: salon.id,
      firstName: "Anna",
      lastName: "Kowalska",
      phone: "+48600100200",
      email: "anna@salon106.test",
    }).returning();
    console.log("Created employee:", emp.id);
  }

  // Get or create service
  let [svc] = await db.select().from(services).where(eq(services.salonId, salon.id)).limit(1);
  if (!svc) {
    [svc] = await db.insert(services).values({
      salonId: salon.id,
      name: "Strzyzenie damskie F106",
      basePrice: "80.00",
      baseDuration: 60,
      isActive: true,
    }).returning();
    console.log("Created service:", svc.id);
  }

  // Create a client that will join the waiting list
  let [client] = await db.select().from(clients).where(
    and(eq(clients.salonId, salon.id), eq(clients.email, "wl-client@test.com"))
  ).limit(1);
  if (!client) {
    [client] = await db.insert(clients).values({
      salonId: salon.id,
      firstName: "Klient",
      lastName: "Oczekujacy",
      phone: "+48600999888",
      email: "wl-client@test.com",
    }).returning();
    console.log("Created waiting list client:", client.id);
  }

  // Create a future appointment to cancel later
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 2);
  tomorrow.setHours(14, 0, 0, 0);
  const endTime = new Date(tomorrow);
  endTime.setMinutes(endTime.getMinutes() + 60);

  // Check if appointment already exists
  const existingAppts = await db.select().from(appointments).where(
    and(
      eq(appointments.salonId, salon.id),
      eq(appointments.employeeId, emp.id),
      eq(appointments.status, "scheduled"),
    )
  );

  let appt;
  if (existingAppts.length === 0) {
    // Create another client for the appointment
    let [apptClient] = await db.select().from(clients).where(
      and(eq(clients.salonId, salon.id), eq(clients.email, "appt-client@test.com"))
    ).limit(1);
    if (!apptClient) {
      [apptClient] = await db.insert(clients).values({
        salonId: salon.id,
        firstName: "Klient",
        lastName: "Wizytowy",
        phone: "+48600111222",
        email: "appt-client@test.com",
      }).returning();
    }

    [appt] = await db.insert(appointments).values({
      salonId: salon.id,
      clientId: apptClient.id,
      employeeId: emp.id,
      serviceId: svc.id,
      startTime: tomorrow,
      endTime: endTime,
      status: "scheduled",
      notes: "TEST_F106_appointment",
    }).returning();
    console.log("Created appointment:", appt.id, "at", tomorrow.toISOString());
  } else {
    appt = existingAppts[0];
    console.log("Using existing appointment:", appt.id);
  }

  // Now add the "waiting list client" to waiting list for this service
  const existingWL = await db.select().from(waitingList).where(
    and(eq(waitingList.clientId, client.id), eq(waitingList.salonId, salon.id))
  );

  if (existingWL.length === 0) {
    const [wlEntry] = await db.insert(waitingList).values({
      salonId: salon.id,
      clientId: client.id,
      serviceId: svc.id,
      preferredEmployeeId: emp.id,
    }).returning();
    console.log("Created waiting list entry:", wlEntry.id);
  } else {
    console.log("Waiting list entry already exists:", existingWL[0].id);
  }

  console.log("\n=== Test Data Summary ===");
  console.log("User email:", testEmail);
  console.log("Salon ID:", salon.id);
  console.log("Employee:", emp.firstName, emp.lastName, "(ID:", emp.id + ")");
  console.log("Service:", svc.name, "(ID:", svc.id + ")");
  console.log("Waiting list client:", client.firstName, client.lastName, "(ID:", client.id + ")");
  console.log("Appointment to cancel:", appt.id);
  console.log("Appointment time:", appt.startTime);

  process.exit(0);
}

setup().catch(console.error);
