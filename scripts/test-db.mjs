import postgres from 'postgres';

const sql = postgres('postgresql://dev_user:dev_password@localhost:5432/postgres_dev');

try {
  const result = await sql`SELECT 1 as connected`;
  console.log('Database connected:', JSON.stringify(result));
  await sql.end();
  process.exit(0);
} catch (err) {
  console.error('Database error:', err.message);
  console.error('Full error:', err);
  process.exit(1);
}
