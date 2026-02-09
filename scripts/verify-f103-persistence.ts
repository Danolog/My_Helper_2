import { db } from "../src/lib/db";
import { appointments, notifications, clients } from "../src/lib/schema";
import { eq, and, like, isNotNull, desc } from "drizzle-orm";

async function main() {
  const action = process.argv[2] || "check";

  if (action === "check") {
    // Check that the reminder SMS notification exists in the database
    const reminderNotifications = await db
      .select({
        id: notifications.id,
        type: notifications.type,
        message: notifications.message,
        status: notifications.status,
        sentAt: notifications.sentAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, "sms"),
          like(notifications.message, "%juz dzisiaj%") // Unique to 1h reminders
        )
      )
      .orderBy(desc(notifications.createdAt))
      .limit(5);

    console.log(`Found ${reminderNotifications.length} 1h reminder notifications:`);
    for (const n of reminderNotifications) {
      console.log(`  ID: ${n.id}`);
      console.log(`  Status: ${n.status}`);
      console.log(`  Sent: ${n.sentAt}`);
      console.log(`  Message: ${n.message.substring(0, 80)}...`);
      console.log("");
    }

    // Check that the appointment has reminder1hSentAt set
    const reminderAppts = await db
      .select({
        id: appointments.id,
        notes: appointments.notes,
        reminder1hSentAt: appointments.reminder1hSentAt,
        startTime: appointments.startTime,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.notes, "TEST_F103_SMS_REMINDER"),
          isNotNull(appointments.reminder1hSentAt)
        )
      );

    console.log(`Found ${reminderAppts.length} appointments with reminder1hSentAt set:`);
    for (const a of reminderAppts) {
      console.log(`  ID: ${a.id}`);
      console.log(`  Notes: ${a.notes}`);
      console.log(`  Reminder1hSentAt: ${a.reminder1hSentAt}`);
      console.log(`  StartTime: ${a.startTime}`);
    }

    if (reminderNotifications.length > 0 && reminderAppts.length > 0) {
      console.log("\nPERSISTENCE CHECK: PASS - Data exists in PostgreSQL");
    } else {
      console.log("\nPERSISTENCE CHECK: FAIL - Missing data");
      process.exit(1);
    }
  } else if (action === "cleanup") {
    // Clean up test data
    const deleted1 = await db.delete(appointments).where(like(appointments.notes, "TEST_F103%")).returning();
    console.log(`Deleted ${deleted1.length} test appointments`);

    const deleted2 = await db.delete(notifications).where(like(notifications.message, "%juz dzisiaj%")).returning();
    console.log(`Deleted ${deleted2.length} test 1h reminder notifications`);

    // Clean up the test client if created
    const deleted3 = await db.delete(clients).where(and(eq(clients.firstName, "SMS_TEST"), eq(clients.lastName, "REMINDER_F103"))).returning();
    console.log(`Deleted ${deleted3.length} test clients`);

    console.log("Cleanup complete");
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
