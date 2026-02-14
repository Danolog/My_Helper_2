/**
 * Setup script for Feature #124 - Create 2+1 promotion
 * Creates test appointments (2 completed appointments for same client+service)
 * so the 3rd appointment will trigger the buy2get1 promotion discount.
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { appointments, clients, employees, services, salons } from "../src/lib/schema";
import { eq, and } from "drizzle-orm";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  console.log("=== Setup for Feature #124: Create 2+1 promotion ===\n");

  // Get a client
  const clientList = await db.select().from(clients).where(eq(clients.salonId, DEMO_SALON_ID)).limit(5);
  if (clientList.length === 0) {
    console.error("No clients found. Create clients first.");
    process.exit(1);
  }
  const testClient = clientList[0]!;
  console.log(`Client: ${testClient.firstName} ${testClient.lastName} (${testClient.id})`);

  // Get first active service
  const serviceList = await db.select().from(services).where(
    and(eq(services.salonId, DEMO_SALON_ID), eq(services.isActive, true))
  ).limit(3);
  if (serviceList.length === 0) {
    console.error("No services found.");
    process.exit(1);
  }
  const testService = serviceList[0]!;
  console.log(`Service: ${testService.name} (${testService.id}) - ${testService.basePrice} PLN`);

  // Get first employee
  const empList = await db.select().from(employees).where(eq(employees.salonId, DEMO_SALON_ID)).limit(3);
  if (empList.length === 0) {
    console.error("No employees found.");
    process.exit(1);
  }
  const testEmployee = empList[0]!;
  console.log(`Employee: ${testEmployee.firstName} ${testEmployee.lastName} (${testEmployee.id})`);

  // Create 2 completed appointments for this client + service combo
  const now = new Date();

  // First appointment: 7 days ago
  const app1Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  app1Start.setHours(10, 0, 0, 0);
  const app1End = new Date(app1Start.getTime() + testService.baseDuration * 60000);

  const [apt1] = await db.insert(appointments).values({
    salonId: DEMO_SALON_ID,
    clientId: testClient.id,
    employeeId: testEmployee.id,
    serviceId: testService.id,
    startTime: app1Start,
    endTime: app1End,
    status: "completed",
    notes: "F124_TEST_APT_1 - completed appointment for 2+1 promo test",
  }).returning();

  console.log(`\nCreated appointment 1: ${apt1?.id} (completed, ${app1Start.toISOString()})`);

  // Second appointment: 3 days ago
  const app2Start = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  app2Start.setHours(14, 0, 0, 0);
  const app2End = new Date(app2Start.getTime() + testService.baseDuration * 60000);

  const [apt2] = await db.insert(appointments).values({
    salonId: DEMO_SALON_ID,
    clientId: testClient.id,
    employeeId: testEmployee.id,
    serviceId: testService.id,
    startTime: app2Start,
    endTime: app2End,
    status: "completed",
    notes: "F124_TEST_APT_2 - completed appointment for 2+1 promo test",
  }).returning();

  console.log(`Created appointment 2: ${apt2?.id} (completed, ${app2Start.toISOString()})`);

  console.log(`\n--- Setup Summary ---`);
  console.log(`Client ID: ${testClient.id}`);
  console.log(`Client: ${testClient.firstName} ${testClient.lastName}`);
  console.log(`Service ID: ${testService.id}`);
  console.log(`Service: ${testService.name}`);
  console.log(`Service Price: ${testService.basePrice} PLN`);
  console.log(`Employee ID: ${testEmployee.id}`);
  console.log(`2 completed appointments created for this client+service combo`);
  console.log(`When booking the 3rd appointment with a buy2get1 promotion, discount should apply!`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
