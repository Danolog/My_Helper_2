import { db } from "../src/lib/db";
import { user, salons } from "../src/lib/schema";
import { eq, isNotNull } from "drizzle-orm";

async function main() {
  // Find salon owners
  const salonOwners = await db.select({
    salonName: salons.name,
    ownerId: salons.ownerId,
  }).from(salons).where(isNotNull(salons.ownerId)).limit(5);

  for (const s of salonOwners) {
    if (s.ownerId) {
      const [u] = await db.select({ email: user.email, name: user.name }).from(user).where(eq(user.id, s.ownerId)).limit(1);
      if (u) {
        console.log(s.salonName + " | " + u.email + " | " + u.name);
      }
    }
  }
  process.exit(0);
}
main().catch(console.error);
