/**
 * Setup script for Feature #102 - SMS reminder 24h before appointment
 * Creates a test appointment scheduled for tomorrow that will trigger a reminder.
 */
import { db } from "../src/lib/db";
import { appointments, clients, salons, employees, services } from "../src/lib/schema";
import { eq } from "drizzle-orm";

async function main() {
  console.log("Setting up test data for Feature #102...\n");

  // Get first salon
  const [salon] = await db.select().from(salons).limit(1);
  if (!salon) {
    console.error("No salon found! Run seed data first.");
    process.exit(1);
  }
  console.log(`Salon: ${salon.name} (${salon.id})`);

  // Get first employee for this salon
  const [employee] = await db
    .select()
    .from(employees)
    .where(eq(employees.salonId, salon.id))
    .limit(1);
  if (!employee) {
    console.error("No employee found!");
    process.exit(1);
  }
  console.log(`Employee: ${employee.firstName} ${employee.lastName} (${employee.id})`);

  // Get first service for this salon
  const [service] = await db
    .select()
    .from(services)
    .where(eq(services.salonId, salon.id))
    .limit(1);
  if (!service) {
    console.error("No service found!");
    process.exit(1);
  }
  console.log(`Service: ${service.name} (${service.id})`);

  // Find or create a test client with phone number
  let [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.salonId, salon.id))
    .limit(1);

  if (!client) {
    const [newClient] = await db
      .insert(clients)
      .values({
        salonId: salon.id,
        firstName: "TEST_F102",
        lastName: "Klient",
        phone: "+48123456789",
        email: "test-f102@example.com",
      })
      .returning();
    client = newClient!;
    console.log(`Created test client: ${client.firstName} ${client.lastName}`);
  } else {
    console.log(`Using existing client: ${client.firstName} ${client.lastName} (phone: ${client.phone})`);
  }

  // Create appointment for tomorrow (within the 24h window)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(14, 0, 0, 0); // 14:00 tomorrow

  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(15, 0, 0, 0); // 15:00 tomorrow

  const [appt] = await db
    .insert(appointments)
    .values({
      salonId: salon.id,
      clientId: client.id,
      employeeId: employee.id,
      serviceId: service.id,
      startTime: tomorrow,
      endTime: tomorrowEnd,
      status: "scheduled",
      notes: "TEST_F102_REMINDER - appointment for reminder test",
    })
    .returning();

  console.log(`\n✅ Created test appointment:`);
  console.log(`   ID: ${appt!.id}`);
  console.log(`   Client: ${client.firstName} ${client.lastName}`);
  console.log(`   Service: ${service.name}`);
  console.log(`   Employee: ${employee.firstName} ${employee.lastName}`);
  console.log(`   Salon: ${salon.name}`);
  console.log(`   Start: ${tomorrow.toLocaleString("pl-PL")}`);
  console.log(`   End: ${tomorrowEnd.toLocaleString("pl-PL")}`);
  console.log(`   Status: scheduled`);
  console.log(`   reminderSentAt: null (not yet sent)`);

  console.log(`\nSalon ID for testing: ${salon.id}`);
  console.log(`Appointment ID: ${appt!.id}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
