import { db } from "../src/lib/db";
import { user } from "../src/lib/schema";

async function main() {
  const users = await db.select({ email: user.email, name: user.name, role: user.role }).from(user).limit(5);
  for (const u of users) {
    console.log(u.email + " | " + u.name + " | " + u.role);
  }
  process.exit(0);
}
main().catch(console.error);
