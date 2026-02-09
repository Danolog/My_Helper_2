import { db } from '../src/lib/db.js';
import { user } from '../src/lib/schema.js';
import { eq } from 'drizzle-orm';

const email = process.argv[2] || 'feature85@example.com';

const [updated] = await db.update(user).set({ role: 'owner' }).where(eq(user.email, email)).returning();
console.log('Updated user:', updated.id, updated.email, updated.role);
process.exit(0);
