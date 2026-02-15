// Setup user for Feature #131 - set as salon owner
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq } from "drizzle-orm";
import { user } from "../src/lib/schema";

async function main() {
  const client = new pg.Client({ connectionString: process.env.POSTGRES_URL });
  await client.connect();
  const db = drizzle(client);

  const [u] = await db.select().from(user).where(eq(user.email, "feature131@test.com"));
  if (!u) {
    console.log("User not found");
    await client.end();
    return;
  }
  console.log("User ID:", u.id);

  // Update role to owner
  await db.update(user).set({ role: "owner" }).where(eq(user.id, u.id));
  console.log("Set role to owner");

  await client.end();
  console.log("Done!");
}

main().catch(console.error);
