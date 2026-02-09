import { db } from "../src/lib/db";
import { appointments, employees, services, salons, clients } from "../src/lib/schema";
import { eq } from "drizzle-orm";

/**
 * Setup script for Feature #103: SMS reminder 1h before appointment
 *
 * Creates a test appointment ~1 hour from now with a client that has a phone number.
 * The cron endpoint should find this appointment and send an SMS reminder.
 */
async function main() {
  console.log("=== Setup for Feature #103: SMS Reminder 1h ===\n");

  // Get a salon
  const salonList = await db.select().from(salons).limit(1);
  if (!salonList[0]) {
    console.log("ERROR: No salons found");
    process.exit(1);
  }
  const salon = salonList[0];
  console.log(`SALON: ${salon.name} (${salon.id})`);

  // Get an employee
  const employeeList = await db.select().from(employees).where(eq(employees.salonId, salon.id)).limit(1);
  if (!employeeList[0]) {
    console.log("ERROR: No employees found");
    process.exit(1);
  }
  const employee = employeeList[0];
  console.log(`EMPLOYEE: ${employee.firstName} ${employee.lastName} (${employee.id})`);

  // Get a service
  const serviceList = await db.select().from(services).where(eq(services.salonId, salon.id)).limit(1);
  if (!serviceList[0]) {
    console.log("ERROR: No services found");
    process.exit(1);
  }
  const service = serviceList[0];
  console.log(`SERVICE: ${service.name} (${service.id})`);

  // Find or create a client with phone number
  let client = (await db.select().from(clients).where(eq(clients.salonId, salon.id)).limit(5))
    .find(c => c.phone && c.phone.length > 0);

  if (!client) {
    console.log("No client with phone found, creating one...");
    const [newClient] = await db.insert(clients).values({
      salonId: salon.id,
      firstName: "SMS_TEST",
      lastName: "REMINDER_F103",
      phone: "+48123456789",
      email: "smstest103@example.com",
    }).returning();
    client = newClient;
    console.log(`CREATED CLIENT: ${client!.firstName} ${client!.lastName}`);
  } else {
    console.log(`CLIENT: ${client.firstName} ${client.lastName} (phone: ${client.phone})`);
  }

  // Create an appointment exactly 60 minutes from now (within the 30-90 min window)
  const now = new Date();
  const startTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour duration

  const [appointment] = await db.insert(appointments).values({
    salonId: salon.id,
    clientId: client!.id,
    employeeId: employee.id,
    serviceId: service.id,
    startTime,
    endTime,
    status: "scheduled",
    notes: "TEST_F103_SMS_REMINDER",
    reminder1hSentAt: null,
  }).returning();

  console.log(`\nAPPOINTMENT CREATED:`);
  console.log(`  ID: ${appointment!.id}`);
  console.log(`  Start: ${startTime.toISOString()}`);
  console.log(`  End: ${endTime.toISOString()}`);
  console.log(`  Status: scheduled`);
  console.log(`  Reminder 1h Sent: null (not yet)`);
  console.log(`\nThis appointment is 60 minutes from now - within the 30-90 min cron window.`);
  console.log(`Trigger the cron with: POST /api/cron/sms-reminders`);

  // Also create an appointment that should NOT get a reminder (too far away)
  const farStart = new Date(now.getTime() + 3 * 60 * 60 * 1000); // 3 hours from now
  const farEnd = new Date(farStart.getTime() + 60 * 60 * 1000);
  const [farAppointment] = await db.insert(appointments).values({
    salonId: salon.id,
    clientId: client!.id,
    employeeId: employee.id,
    serviceId: service.id,
    startTime: farStart,
    endTime: farEnd,
    status: "scheduled",
    notes: "TEST_F103_FAR_APPOINTMENT",
    reminder1hSentAt: null,
  }).returning();

  console.log(`\nFAR APPOINTMENT (should NOT get reminder):`);
  console.log(`  ID: ${farAppointment!.id}`);
  console.log(`  Start: ${farStart.toISOString()} (3h from now)`);

  // Also create an appointment that already had a reminder sent
  const alreadySentStart = new Date(now.getTime() + 45 * 60 * 1000); // 45 min from now
  const alreadySentEnd = new Date(alreadySentStart.getTime() + 60 * 60 * 1000);
  const [alreadySentAppt] = await db.insert(appointments).values({
    salonId: salon.id,
    clientId: client!.id,
    employeeId: employee.id,
    serviceId: service.id,
    startTime: alreadySentStart,
    endTime: alreadySentEnd,
    status: "scheduled",
    notes: "TEST_F103_ALREADY_SENT",
    reminder1hSentAt: new Date(), // Already sent!
  }).returning();

  console.log(`\nALREADY SENT APPOINTMENT (should NOT get duplicate):`);
  console.log(`  ID: ${alreadySentAppt!.id}`);
  console.log(`  Start: ${alreadySentStart.toISOString()} (45min from now)`);
  console.log(`  Reminder1hSentAt: ${new Date().toISOString()} (already marked)`);

  console.log(`\n=== Setup complete! ===`);
  console.log(`Expected: cron should find 1 appointment (the 60-min one), skip the rest.`);

  process.exit(0);
}

main().catch((e) => {
  console.error("Setup failed:", e);
  process.exit(1);
});
