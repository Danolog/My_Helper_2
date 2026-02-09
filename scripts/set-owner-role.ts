import 'dotenv/config';
import { db } from '../src/lib/db';
import { user } from '../src/lib/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const email = process.argv[2] || 'feature85@example.com';
  const [updated] = await db.update(user).set({ role: 'owner' }).where(eq(user.email, email)).returning();
  console.log('Updated user:', updated.id, updated.email, updated.role);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
