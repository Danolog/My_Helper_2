import "dotenv/config";
import { db } from "../src/lib/db";
import { reviews, appointments, clients } from "../src/lib/schema";
import { eq, and, like } from "drizzle-orm";

async function main() {
  // Clean up TEST_F101_ reviews
  const testReviews = await db.select().from(reviews);
  let cleaned = 0;
  for (const r of testReviews) {
    if (r.comment && r.comment.includes("TEST_F101_")) {
      await db.delete(reviews).where(eq(reviews.id, r.id));
      console.log("Deleted review:", r.id);
      cleaned++;
    }
  }
  console.log(`Cleaned ${cleaned} test reviews`);

  // Clean up TEST_F101_ appointments
  const testAppts = await db.select().from(appointments);
  let apptsCleaned = 0;
  for (const a of testAppts) {
    if (a.notes && a.notes.includes("TEST_F101_")) {
      await db.delete(appointments).where(eq(appointments.id, a.id));
      console.log("Deleted appointment:", a.id);
      apptsCleaned++;
    }
  }
  console.log(`Cleaned ${apptsCleaned} test appointments`);

  // Clean up test client
  const testClients = await db.select().from(clients).where(eq(clients.email, "testf101@test.com"));
  for (const c of testClients) {
    await db.delete(clients).where(eq(clients.id, c.id));
    console.log("Deleted client:", c.id);
  }

  console.log("Cleanup complete");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
