/**
 * Setup script for Feature #187 - Business AI negative review alerts
 * Creates a negative review in the database to test review alerts.
 */

import { db } from "../src/lib/db";
import { reviews, clients, employees, appointments, services } from "../src/lib/schema";
import { eq, desc } from "drizzle-orm";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  // Get an existing client
  const existingClients = await db
    .select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName })
    .from(clients)
    .where(eq(clients.salonId, DEMO_SALON_ID))
    .limit(3);

  if (existingClients.length === 0) {
    process.stdout.write("ERROR: No clients found in salon\n");
    process.exit(1);
  }

  // Get an existing employee
  const existingEmployees = await db
    .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
    .from(employees)
    .where(eq(employees.salonId, DEMO_SALON_ID))
    .limit(3);

  if (existingEmployees.length === 0) {
    process.stdout.write("ERROR: No employees found in salon\n");
    process.exit(1);
  }

  // Get a recent appointment for the review reference
  const existingAppointments = await db
    .select({ id: appointments.id, serviceId: appointments.serviceId })
    .from(appointments)
    .where(eq(appointments.salonId, DEMO_SALON_ID))
    .orderBy(desc(appointments.startTime))
    .limit(3);

  // Check existing negative reviews
  const existingNegativeReviews = await db
    .select({ id: reviews.id, rating: reviews.rating, comment: reviews.comment })
    .from(reviews)
    .where(eq(reviews.salonId, DEMO_SALON_ID))
    .orderBy(desc(reviews.createdAt))
    .limit(10);

  process.stdout.write("Existing reviews: " + existingNegativeReviews.length + "\n");
  for (const r of existingNegativeReviews) {
    process.stdout.write("  - Rating: " + r.rating + " | Comment: " + (r.comment || "(none)") + "\n");
  }

  // Create two negative reviews for testing
  const client1 = existingClients[0]!;
  const client2 = existingClients.length > 1 ? existingClients[1]! : client1;
  const emp1 = existingEmployees[0]!;
  const emp2 = existingEmployees.length > 1 ? existingEmployees[1]! : emp1;

  // Critical review (1 star)
  const [criticalReview] = await db.insert(reviews).values({
    salonId: DEMO_SALON_ID,
    clientId: client1.id,
    employeeId: emp1.id,
    appointmentId: existingAppointments.length > 0 ? existingAppointments[0]!.id : null,
    rating: 1,
    comment: "TEST_F187: Bardzo zla obsluga, pracownik byl nieuprzejmy i usluga trwala duzo krocej niz obiecano. Nie polecam!",
    status: "approved",
  }).returning();

  process.stdout.write("Created critical review (1 star): " + criticalReview!.id + "\n");

  // Warning review (3 stars)
  const [warningReview] = await db.insert(reviews).values({
    salonId: DEMO_SALON_ID,
    clientId: client2.id,
    employeeId: emp2.id,
    appointmentId: existingAppointments.length > 1 ? existingAppointments[1]!.id : null,
    rating: 3,
    comment: "TEST_F187: Srednia usluga, efekt koncowy ok ale dlugo musialem czekac. Moglo byc lepiej.",
    status: "approved",
  }).returning();

  process.stdout.write("Created warning review (3 stars): " + warningReview!.id + "\n");

  // Star-only critical review (2 stars, no comment)
  const [starOnlyReview] = await db.insert(reviews).values({
    salonId: DEMO_SALON_ID,
    clientId: client1.id,
    employeeId: emp2.id,
    appointmentId: existingAppointments.length > 2 ? existingAppointments[2]!.id : null,
    rating: 2,
    comment: null,
    status: "approved",
  }).returning();

  process.stdout.write("Created star-only review (2 stars): " + starOnlyReview!.id + "\n");

  process.stdout.write("\nDone! Created 3 negative test reviews.\n");
  process.exit(0);
}

main().catch((err) => {
  process.stdout.write("ERROR: " + String(err) + "\n");
  process.exit(1);
});
