/**
 * Setup script for Feature #108: Birthday notifications
 * Creates a client with today's birthday and verifies the birthday notification flow.
 */
import { db } from "../src/lib/db";
import { clients, notifications } from "../src/lib/schema";
import { eq, and, sql } from "drizzle-orm";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  console.log("[F108 Setup] Starting birthday notifications setup...");

  // Today's date in YYYY-MM-DD format
  const today = new Date();
  const year = today.getFullYear() - 30; // Make them 30 years old
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const birthdayToday = `${year}-${month}-${day}`;

  console.log(`[F108 Setup] Today is ${today.toISOString().split("T")[0]}, setting birthday to ${birthdayToday}`);

  // Check if test client already exists
  const existingClients = await db
    .select()
    .from(clients)
    .where(
      and(
        eq(clients.salonId, DEMO_SALON_ID),
        eq(clients.firstName, "BIRTHDAY"),
        eq(clients.lastName, "TEST_F108")
      )
    );

  if (existingClients.length > 0) {
    console.log("[F108 Setup] Test client already exists, updating birthday...");
    await db
      .update(clients)
      .set({ birthday: birthdayToday })
      .where(eq(clients.id, existingClients[0]!.id));
    console.log(`[F108 Setup] Updated birthday for client ${existingClients[0]!.id} to ${birthdayToday}`);
  } else {
    // Create a new test client with birthday today
    const [newClient] = await db
      .insert(clients)
      .values({
        salonId: DEMO_SALON_ID,
        firstName: "BIRTHDAY",
        lastName: "TEST_F108",
        phone: "+48 111 222 333",
        email: "birthday.test@example.com",
        birthday: birthdayToday,
        notes: "Klient testowy dla funkcji powiadomien urodzinowych",
      })
      .returning();

    console.log(`[F108 Setup] Created test client: ${newClient!.id}`);
    console.log(`[F108 Setup] Name: BIRTHDAY TEST_F108`);
    console.log(`[F108 Setup] Birthday: ${birthdayToday}`);
    console.log(`[F108 Setup] Phone: +48 111 222 333`);
  }

  // Clean up any old birthday notifications for this test
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const deleted = await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.salonId, DEMO_SALON_ID),
        sql`${notifications.message} LIKE '%BIRTHDAY%'`,
        sql`${notifications.createdAt} >= ${todayStart}`
      )
    )
    .returning();

  if (deleted.length > 0) {
    console.log(`[F108 Setup] Cleaned up ${deleted.length} old birthday notifications`);
  }

  console.log("[F108 Setup] Setup complete!");
  process.exit(0);
}

main().catch((err) => {
  console.error("[F108 Setup] Error:", err);
  process.exit(1);
});
