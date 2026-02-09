import { db } from "../src/lib/db";
import { appointments, user } from "../src/lib/schema";
import { eq } from "drizzle-orm";

async function main() {
  const apptId = "27fc7d2b-9209-4baf-99e8-69b8352fc9d3";
  const appts = await db.select().from(appointments).where(eq(appointments.id, apptId)).limit(1);

  if (!appts[0]) {
    console.log("APPOINTMENT NOT FOUND: " + apptId);
    // Check what user has this email
    const users = await db.select().from(user).where(eq(user.email, "f96textreview@test.com")).limit(1);
    if (users[0]) {
      console.log("User exists: " + users[0].id + " email: " + users[0].email);
    }
    process.exit(1);
  }

  const appt = appts[0];
  console.log("APPOINTMENT FOUND:");
  console.log("  ID: " + appt.id);
  console.log("  bookedByUserId: " + appt.bookedByUserId);
  console.log("  Status: " + appt.status);

  // Check if the user exists
  if (appt.bookedByUserId) {
    const users = await db.select().from(user).where(eq(user.id, appt.bookedByUserId)).limit(1);
    if (users[0]) {
      console.log("  User email: " + users[0].email);
    } else {
      console.log("  USER NOT FOUND!");
    }
  }

  process.exit(0);
}

main().catch(console.error);
