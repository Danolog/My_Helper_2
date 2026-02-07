import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.POSTGRES_URL as string;

if (!connectionString) {
  throw new Error("POSTGRES_URL environment variable is not set");
}

// Configure postgres client with connection timeout
const client = postgres(connectionString, {
  connect_timeout: 5, // 5 second connection timeout
  idle_timeout: 20,   // 20 second idle timeout
  max_lifetime: 60 * 30, // 30 minute max connection lifetime
});

export const db = drizzle(client, { schema });
