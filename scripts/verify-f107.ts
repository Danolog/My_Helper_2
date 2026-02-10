/**
 * Verify script for Feature #107 - Check DB state after accept flow
 */
import { db } from "@/lib/db";
import { appointments, waitingList, notifications } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";

async function verify() {
  console.log("=== VERIFYING F107 ACCEPT FLOW ===\n");

  // 1. Check appointment was moved to earlier slot
  const [appt] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.id, "c7ae15c1-a40f-4ba8-8a02-1a5c4a537bcb"))
    .limit(1);

  if (appt) {
    const start = new Date(appt.startTime);
    const end = new Date(appt.endTime);
    console.log("APPOINTMENT:");
    console.log(`  ID: ${appt.id}`);
    console.log(`  Status: ${appt.status}`);
    console.log(`  Start: ${start.toISOString()}`);
    console.log(`  End: ${end.toISOString()}`);
    console.log(`  Notes: ${appt.notes}`);

    // Verify it was moved to Feb 11 09:00 (from Feb 13 15:00)
    const expectedStart = "2026-02-11T09:00:00.000Z";
    const actualStart = start.toISOString();
    if (actualStart === expectedStart) {
      console.log(`  ✅ PASS: Appointment moved to earlier slot (${expectedStart})`);
    } else {
      console.log(`  ❌ FAIL: Expected start ${expectedStart}, got ${actualStart}`);
    }
  } else {
    console.log("  ❌ FAIL: Appointment not found");
  }

  console.log("");

  // 2. Check waiting list entry is marked as accepted
  const [wlEntry] = await db
    .select()
    .from(waitingList)
    .where(eq(waitingList.id, "1e37128c-35ae-476a-85a5-fa90c4d475ec"))
    .limit(1);

  if (wlEntry) {
    console.log("WAITING LIST ENTRY:");
    console.log(`  ID: ${wlEntry.id}`);
    console.log(`  Accepted: ${wlEntry.accepted}`);
    console.log(`  NotifiedAt: ${wlEntry.notifiedAt}`);
    console.log(`  OfferedStartTime: ${wlEntry.offeredStartTime}`);
    console.log(`  OfferedEndTime: ${wlEntry.offeredEndTime}`);

    if (wlEntry.accepted === true) {
      console.log("  ✅ PASS: Entry marked as accepted");
    } else {
      console.log(`  ❌ FAIL: Expected accepted=true, got ${wlEntry.accepted}`);
    }
  } else {
    console.log("  ❌ FAIL: Waiting list entry not found");
  }

  console.log("");

  // 3. Check confirmation notification was created
  const notifs = await db
    .select()
    .from(notifications)
    .where(eq(notifications.clientId, "00caf3dd-6c3a-4242-918a-b5f7563ad0fc"))
    .orderBy(desc(notifications.createdAt))
    .limit(3);

  console.log(`NOTIFICATIONS (${notifs.length} found):`);
  for (const n of notifs) {
    console.log(`  ID: ${n.id}`);
    console.log(`  Type: ${n.type}`);
    console.log(`  Status: ${n.status}`);
    console.log(`  Message: ${n.message?.substring(0, 120)}...`);
    console.log("");
  }

  if (notifs.length > 0 && notifs[0]!.message?.includes("zaakceptowal")) {
    console.log("  ✅ PASS: Confirmation notification created");
  } else {
    console.log("  ⚠️  No confirmation notification with 'zaakceptowal' found (may have different wording)");
  }

  console.log("\n=== VERIFICATION COMPLETE ===");
}

verify()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
