/**
 * Setup fresh test appointment for Feature #102 - SMS reminder
 * Creates appointment 12 hours from now (well within 24h window)
 */
import { db } from "../src/lib/db";
import { appointments, clients, salons, employees, services } from "../src/lib/schema";
import { eq } from "drizzle-orm";

async function main() {
  console.log("Creating fresh test appointment for Feature #102...\n");

  // Get first salon
  const [salon] = await db.select().from(salons).limit(1);
  if (!salon) { console.error("No salon"); process.exit(1); }

  // Get employee
  const [employee] = await db.select().from(employees).where(eq(employees.salonId, salon.id)).limit(1);
  if (!employee) { console.error("No employee"); process.exit(1); }

  // Get service
  const [service] = await db.select().from(services).where(eq(services.salonId, salon.id)).limit(1);
  if (!service) { console.error("No service"); process.exit(1); }

  // Get client with phone
  const [client] = await db.select().from(clients).where(eq(clients.salonId, salon.id)).limit(1);
  if (!client) { console.error("No client"); process.exit(1); }

  // Create appointment 12 hours from now
  const start = new Date();
  start.setHours(start.getHours() + 12);
  start.setMinutes(0, 0, 0);

  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  const [appt] = await db.insert(appointments).values({
    salonId: salon.id,
    clientId: client.id,
    employeeId: employee.id,
    serviceId: service.id,
    startTime: start,
    endTime: end,
    status: "scheduled",
    notes: "TEST_F102_FRESH_REMINDER",
    reminderSentAt: null, // explicitly null
  }).returning();

  console.log(`Appointment ID: ${appt!.id}`);
  console.log(`Client: ${client.firstName} ${client.lastName} (${client.phone})`);
  console.log(`Service: ${service.name}`);
  console.log(`Employee: ${employee.firstName} ${employee.lastName}`);
  console.log(`Salon: ${salon.name}`);
  console.log(`Start: ${start.toISOString()} (${start.toLocaleString("pl-PL")})`);
  console.log(`reminderSentAt: null`);
  console.log(`\nSalon ID: ${salon.id}`);

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
