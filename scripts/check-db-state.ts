import { db } from "../src/lib/db";
import { salons, employees, services, appointments, clients, user } from "../src/lib/schema";

async function main() {
  const salonCount = await db.select().from(salons);
  console.log("Salons: " + salonCount.length);

  const empCount = await db.select().from(employees);
  console.log("Employees: " + empCount.length);

  const svcCount = await db.select().from(services);
  console.log("Services: " + svcCount.length);

  const apptCount = await db.select().from(appointments);
  console.log("Appointments: " + apptCount.length);

  const clientCount = await db.select().from(clients);
  console.log("Clients: " + clientCount.length);

  const userCount = await db.select().from(user);
  console.log("Users: " + userCount.length);

  // Show salon details
  for (const s of salonCount) {
    console.log("  Salon: " + s.name + " (" + s.id + ")");
  }

  // Show first few employees
  for (const e of empCount.slice(0, 3)) {
    console.log("  Employee: " + e.firstName + " " + e.lastName + " salonId=" + e.salonId);
  }

  process.exit(0);
}

main().catch(console.error);
