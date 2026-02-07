import postgres from "postgres";

const connectionString = process.env.POSTGRES_URL || "postgresql://dev_user:dev_password@localhost:5432/postgres_dev";

async function testConnection() {
  console.log("Testing database connection...");
  console.log("Connection string:", connectionString.replace(/:[^:@]+@/, ":****@"));

  try {
    const sql = postgres(connectionString);
    const result = await sql`SELECT 1 as connected, current_database() as database, current_user as user`;
    console.log("Database connected successfully!");
    console.log("Result:", result[0]);

    // Check if tables exist
    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    console.log("Tables in database:", tables.map((t) => (t as { table_name: string }).table_name));

    await sql.end();
    process.exit(0);
  } catch (error) {
    console.error("Connection failed:", error);
    process.exit(1);
  }
}

testConnection();
