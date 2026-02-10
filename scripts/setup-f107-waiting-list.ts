/**
 * Setup script for Feature #107 - Earlier slot acceptance
 *
 * Creates test data for the waiting list acceptance flow:
 * 1. Registers a client user (f107client@test.com)
 * 2. Creates a client record linked to the salon
 * 3. Creates a future appointment for the client (at a later time)
 * 4. Adds the client to the waiting list for the same service
 * 5. Simulates notification by setting offeredStartTime, acceptToken, notifiedAt
 *    (as if another appointment was cancelled and the slot was offered)
 */

import { db } from "@/lib/db";
import {
  salons,
  employees,
  services,
  clients,
  appointments,
  waitingList,
} from "@/lib/schema";
import { eq, and, not } from "drizzle-orm";
import crypto from "crypto";

async function setup() {
  console.log("[Setup F107] Starting waiting list test data setup...");

  // 1. Get first salon
  const [salon] = await db.select().from(salons).limit(1);
  if (!salon) {
    console.error("[Setup F107] No salon found. Please seed data first.");
    process.exit(1);
  }
  console.log(`[Setup F107] Using salon: ${salon.name} (${salon.id})`);

  // 2. Get first active employee with work schedules
  const [employee] = await db
    .select()
    .from(employees)
    .where(eq(employees.salonId, salon.id))
    .limit(1);
  if (!employee) {
    console.error("[Setup F107] No employee found.");
    process.exit(1);
  }
  console.log(`[Setup F107] Using employee: ${employee.firstName} ${employee.lastName} (${employee.id})`);

  // 3. Get first service at this salon
  const [service] = await db
    .select()
    .from(services)
    .where(eq(services.salonId, salon.id))
    .limit(1);
  if (!service) {
    console.error("[Setup F107] No service found.");
    process.exit(1);
  }
  console.log(`[Setup F107] Using service: ${service.name} (${service.id}), duration: ${service.duration}min`);

  // 4. Find or create client record for test email
  const testEmail = "f107client@test.com";
  let [clientRecord] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.email, testEmail), eq(clients.salonId, salon.id)))
    .limit(1);

  if (!clientRecord) {
    const [newClient] = await db
      .insert(clients)
      .values({
        salonId: salon.id,
        firstName: "Test",
        lastName: "F107",
        email: testEmail,
        phone: "+48123456107",
      })
      .returning();
    clientRecord = newClient!;
    console.log(`[Setup F107] Created client: ${clientRecord.id}`);
  } else {
    console.log(`[Setup F107] Using existing client: ${clientRecord.id}`);
  }

  // 5. Create a future appointment for the client (e.g., 3 days from now at 16:00)
  const laterDate = new Date();
  laterDate.setDate(laterDate.getDate() + 3);
  laterDate.setHours(16, 0, 0, 0);

  const laterEndDate = new Date(laterDate);
  laterEndDate.setMinutes(laterEndDate.getMinutes() + (service.duration || 60));

  // Check for existing appointment
  const existingAppts = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.clientId, clientRecord.id),
        eq(appointments.salonId, salon.id),
        eq(appointments.serviceId, service.id),
        not(eq(appointments.status, "cancelled"))
      )
    )
    .limit(1);

  let appointment;
  if (existingAppts.length > 0) {
    appointment = existingAppts[0]!;
    console.log(`[Setup F107] Using existing appointment: ${appointment.id}`);
  } else {
    const [newAppt] = await db
      .insert(appointments)
      .values({
        salonId: salon.id,
        clientId: clientRecord.id,
        employeeId: employee.id,
        serviceId: service.id,
        startTime: laterDate,
        endTime: laterEndDate,
        status: "scheduled",
        notes: "F107_TEST_APPOINTMENT - wizyta do przeniesienia",
      })
      .returning();
    appointment = newAppt!;
    console.log(`[Setup F107] Created appointment: ${appointment.id} at ${laterDate.toISOString()}`);
  }

  // 6. Create a waiting list entry with offered earlier slot
  const earlierDate = new Date();
  earlierDate.setDate(earlierDate.getDate() + 1);
  earlierDate.setHours(10, 0, 0, 0);

  const earlierEndDate = new Date(earlierDate);
  earlierEndDate.setMinutes(earlierEndDate.getMinutes() + (service.duration || 60));

  const acceptToken = crypto.randomBytes(32).toString("hex");

  // Clean up any existing waiting list entries for this test
  const existingEntries = await db
    .select()
    .from(waitingList)
    .where(
      and(
        eq(waitingList.clientId, clientRecord.id),
        eq(waitingList.salonId, salon.id)
      )
    );

  for (const entry of existingEntries) {
    await db.delete(waitingList).where(eq(waitingList.id, entry.id));
    console.log(`[Setup F107] Cleaned up old waiting list entry: ${entry.id}`);
  }

  const [waitingEntry] = await db
    .insert(waitingList)
    .values({
      salonId: salon.id,
      clientId: clientRecord.id,
      serviceId: service.id,
      preferredEmployeeId: employee.id,
      preferredDate: earlierDate,
      notifiedAt: new Date(), // Simulate that notification was already sent
      offeredStartTime: earlierDate,
      offeredEndTime: earlierEndDate,
      offeredEmployeeId: employee.id,
      existingAppointmentId: appointment.id,
      acceptToken,
    })
    .returning();

  console.log(`[Setup F107] Created waiting list entry: ${waitingEntry!.id}`);
  console.log(`[Setup F107] Accept token: ${acceptToken}`);

  // Summary
  console.log("\n[Setup F107] ============ TEST DATA SUMMARY ============");
  console.log(`  Salon: ${salon.name} (${salon.id})`);
  console.log(`  Employee: ${employee.firstName} ${employee.lastName} (${employee.id})`);
  console.log(`  Service: ${service.name} (${service.id})`);
  console.log(`  Client: ${clientRecord.firstName} ${clientRecord.lastName} (${clientRecord.id})`);
  console.log(`  Client email: ${testEmail}`);
  console.log(`  Existing appointment: ${appointment.id}`);
  console.log(`    Time: ${new Date(appointment.startTime).toISOString()} - ${new Date(appointment.endTime).toISOString()}`);
  console.log(`  Waiting list entry: ${waitingEntry!.id}`);
  console.log(`    Offered earlier time: ${earlierDate.toISOString()} - ${earlierEndDate.toISOString()}`);
  console.log(`    Accept token: ${acceptToken.substring(0, 20)}...`);
  console.log(`  [IMPORTANT] Register user f107client@test.com first, then the waiting list page should show the offer.`);
  console.log("[Setup F107] ============================================\n");
}

setup()
  .then(() => {
    console.log("[Setup F107] Done!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[Setup F107] Error:", err);
    process.exit(1);
  });
