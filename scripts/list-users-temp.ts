import { db } from "../src/lib/db";
import { user } from "../src/lib/schema";

async function main() {
  const users = await db.select({ id: user.id, email: user.email, role: user.role }).from(user).limit(10);
  for (const u of users) {
    console.log(`${u.email} | role: ${u.role}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
