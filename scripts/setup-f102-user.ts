import { db } from "../src/lib/db";
import { user, salons } from "../src/lib/schema";
import { eq } from "drizzle-orm";

async function main() {
  // Verify email
  const [u] = await db.update(user).set({ emailVerified: true }).where(eq(user.email, "f102@test.com")).returning();
  if (!u) { console.error("User not found"); process.exit(1); }
  console.log("Email verified for: " + u.email);

  // Link to salon as owner
  const [salon] = await db.update(salons).set({ ownerId: u.id }).where(eq(salons.id, "00000000-0000-0000-0000-000000000001")).returning();
  console.log("Linked to salon: " + salon!.name);

  // Set role to owner
  await db.update(user).set({ role: "owner" }).where(eq(user.id, u.id));
  console.log("Role set to owner");

  process.exit(0);
}
main().catch(console.error);
