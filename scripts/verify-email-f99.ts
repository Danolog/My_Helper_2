import "dotenv/config";
import { db } from "../src/lib/db";
import { user } from "../src/lib/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const email = process.argv[2] || "owner99@test.com";

  const [updated] = await db
    .update(user)
    .set({ emailVerified: true })
    .where(eq(user.email, email))
    .returning();

  if (updated) {
    console.log("Verified:", updated.id, updated.email, updated.emailVerified);
  } else {
    console.log("User not found:", email);
  }

  const users = await db
    .select({ id: user.id, email: user.email, emailVerified: user.emailVerified, role: user.role })
    .from(user)
    .orderBy(desc(user.createdAt))
    .limit(10);
  console.log("\nRecent users:");
  for (const u of users) {
    console.log(`  ${u.email} verified=${u.emailVerified} role=${u.role}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
