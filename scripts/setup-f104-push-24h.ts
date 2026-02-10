import { db } from "../src/lib/db";
import { appointments, employees, services, salons, clients, user } from "../src/lib/schema";
import { eq } from "drizzle-orm";

/**
 * Setup script for Feature #104: Push notification 24h before appointment
 *
 * Creates a test appointment ~24 hours from now with a client that has a user account.
 * The user account needs to have push subscriptions registered to receive push notifications.
 * The cron endpoint (/api/cron/push-reminders-24h) should find this appointment and send a push reminder.
 */
async function main() {
  console.log("=== Setup for Feature #104: Push Notification 24h ===\n");

  // Get a salon
  const salonList = await db.select().from(salons).limit(1);
  if (!salonList[0]) {
    console.log("ERROR: No salons found. Run seed first: POST /api/seed");
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

  // Find a client with phone number
  let client = (await db.select().from(clients).where(eq(clients.salonId, salon.id)).limit(5))
    .find(c => c.phone && c.phone.length > 0);

  if (!client) {
    console.log("No client with phone found, creating one...");
    const [newClient] = await db.insert(clients).values({
      salonId: salon.id,
      firstName: "PUSH_TEST_24H",
      lastName: "REMINDER_F104",
      phone: "+48123456789",
      email: "pushtest104@example.com",
    }).returning();
    client = newClient;
    console.log(`CREATED CLIENT: ${client!.firstName} ${client!.lastName}`);
  } else {
    console.log(`CLIENT: ${client.firstName} ${client.lastName} (phone: ${client.phone})`);
  }

  // List all users to find one we can link
  const users = await db.select({ id: user.id, email: user.email, name: user.name }).from(user).limit(10);
  console.log(`\nAvailable users:`);
  users.forEach(u => console.log(`  - ${u.email} (${u.id})`));

  // Create an appointment exactly 24 hours from now (within the 20-28 hour window)
  const now = new Date();
  const startTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour duration

  // Link to the first user (for push notifications, the bookedByUserId matters)
  const bookedByUserId = users[0]?.id || null;

  const [appointment] = await db.insert(appointments).values({
    salonId: salon.id,
    clientId: client!.id,
    employeeId: employee.id,
    serviceId: service.id,
    bookedByUserId,
    startTime,
    endTime,
    status: "scheduled",
    notes: "TEST_F104_PUSH_24H_REMINDER",
    reminderPushSentAt: null,
  }).returning();

  console.log(`\nAPPOINTMENT CREATED:`);
  console.log(`  ID: ${appointment!.id}`);
  console.log(`  Start: ${startTime.toISOString()}`);
  console.log(`  End: ${endTime.toISOString()}`);
  console.log(`  Status: scheduled`);
  console.log(`  BookedByUserId: ${bookedByUserId}`);
  console.log(`  ReminderPushSentAt: null (not yet sent)`);
  console.log(`\nThis appointment is 24 hours from now - within the 20-28h cron window.`);
  console.log(`\nTo test 24h push notifications:`);
  console.log(`  1. Log in as ${users[0]?.email || "a registered user"}`);
  console.log(`  2. Go to /dashboard/notifications`);
  console.log(`  3. Enable push notifications`);
  console.log(`  4. Trigger the cron with: POST /api/cron/push-reminders-24h`);
  console.log(`  5. You should receive a push notification about tomorrow's appointment`);

  console.log(`\n=== Setup complete! ===`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Setup failed:", e);
  process.exit(1);
});
