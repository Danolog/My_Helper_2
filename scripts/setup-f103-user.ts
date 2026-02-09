import { db } from "../src/lib/db";
import { user, salons } from "../src/lib/schema";
import { eq } from "drizzle-orm";

async function main() {
  // Verify email for the test user
  const [testUser] = await db.select().from(user).where(eq(user.email, "smstest103@test.com")).limit(1);
  if (!testUser) {
    console.log("ERROR: User smstest103@test.com not found");
    process.exit(1);
  }
  console.log("USER: " + testUser.id + " | " + testUser.email);

  // Verify email
  if (!testUser.emailVerified) {
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, testUser.id));
    console.log("Email verified");
  }

  // Set role to owner
  await db.update(user).set({ role: "owner" }).where(eq(user.id, testUser.id));
  console.log("Role set to owner");

  // Link to salon
  const [salon] = await db.select().from(salons).limit(1);
  if (!salon) {
    console.log("ERROR: No salon found");
    process.exit(1);
  }

  await db.update(salons).set({ ownerId: testUser.id }).where(eq(salons.id, salon.id));
  console.log("Linked to salon: " + salon.name + " (" + salon.id + ")");

  console.log("\nDone! User smstest103@test.com is now owner of " + salon.name);
  console.log("Login: smstest103@test.com / test1234");
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
