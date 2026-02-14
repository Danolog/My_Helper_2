import "dotenv/config";
import { db } from "../src/lib/db";
import { user } from "../src/lib/schema";
import { eq } from "drizzle-orm";

async function main() {
  const existing = await db.select().from(user).where(eq(user.email, "feature124@test.com"));
  if (existing.length > 0) {
    const u = existing[0];
    console.log("User exists: " + (u ? u.id : "unknown"));
  } else {
    console.log("User does not exist - need to register via UI");
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
