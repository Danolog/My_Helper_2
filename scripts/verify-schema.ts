/**
 * Schema Verification Script
 *
 * Run this script to verify all database tables are properly created.
 * Usage: pnpm tsx scripts/verify-schema.ts
 *
 * Requires: PostgreSQL running (via Docker)
 */

import { db } from '../src/lib/db';
import { sql } from 'drizzle-orm';

// Expected tables from app_spec.txt
const expectedTables = [
  'user',
  'session',
  'account',
  'verification',
  'salons',
  'clients',
  'employees',
  'service_categories',
  'services',
  'service_variants',
  'appointments',
  'time_blocks',
  'temporary_access',
  'employee_service_prices',
  'appointment_materials',
  'treatment_history',
  'work_schedules',
  'gallery_photos',
  'albums',
  'photo_albums',
  'reviews',
  'notifications',
  'waiting_list',
  'products',
  'product_usage',
  'promotions',
  'promo_codes',
  'loyalty_points',
  'loyalty_transactions',
  'invoices',
  'employee_commissions',
  'ai_conversations',
  'newsletters',
  'marketing_consents',
  'favorite_salons',
  'subscription_plans',
  'salon_subscriptions',
  'subscription_payments',
];

// Key columns to verify per table (subset for verification)
const keyColumns: Record<string, string[]> = {
  salons: ['id', 'name', 'phone', 'email', 'address', 'industry_type', 'settings_json', 'owner_id', 'created_at'],
  clients: ['id', 'salon_id', 'first_name', 'last_name', 'phone', 'email', 'notes', 'preferences', 'allergies', 'favorite_employee_id'],
  employees: ['id', 'salon_id', 'user_id', 'first_name', 'last_name', 'phone', 'email', 'role', 'is_active'],
  services: ['id', 'salon_id', 'name', 'base_price', 'base_duration', 'is_active'],
  appointments: ['id', 'salon_id', 'client_id', 'employee_id', 'service_id', 'variant_id', 'start_time', 'end_time', 'status'],
};

async function verifySchema() {
  console.log('🔍 Verifying database schema...\n');

  try {
    // Test connection
    const result = await db.execute(sql`SELECT 1 as test`);
    console.log('✅ Database connection successful\n');

    // Get all tables
    const tablesResult = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const existingTables = (tablesResult.rows as { table_name: string }[]).map(r => r.table_name);
    console.log(`📋 Found ${existingTables.length} tables in database:\n`);

    // Check each expected table
    let allTablesExist = true;
    for (const tableName of expectedTables) {
      const exists = existingTables.includes(tableName);
      if (exists) {
        console.log(`  ✅ ${tableName}`);
      } else {
        console.log(`  ❌ ${tableName} - MISSING`);
        allTablesExist = false;
      }
    }

    // Verify key columns for important tables
    console.log('\n📊 Verifying key columns...\n');

    for (const [tableName, columns] of Object.entries(keyColumns)) {
      if (!existingTables.includes(tableName)) {
        console.log(`  ⏭️  Skipping ${tableName} (table missing)`);
        continue;
      }

      const columnsResult = await db.execute(sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = ${tableName}
      `);

      const existingColumns = (columnsResult.rows as { column_name: string }[]).map(r => r.column_name);

      let allColumnsExist = true;
      for (const col of columns) {
        if (!existingColumns.includes(col)) {
          console.log(`  ❌ ${tableName}.${col} - MISSING`);
          allColumnsExist = false;
        }
      }

      if (allColumnsExist) {
        console.log(`  ✅ ${tableName} - all key columns present`);
      }
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    if (allTablesExist) {
      console.log('✅ Schema verification PASSED');
      console.log(`   All ${expectedTables.length} expected tables exist`);
    } else {
      console.log('❌ Schema verification FAILED');
      console.log('   Some tables are missing. Run: pnpm drizzle-kit push');
    }

  } catch (error) {
    console.error('❌ Error connecting to database:', error);
    console.log('\nMake sure PostgreSQL is running:');
    console.log('  1. Start Docker Desktop');
    console.log('  2. Run: docker compose up -d');
    console.log('  3. Run: pnpm drizzle-kit push');
    process.exit(1);
  }

  process.exit(0);
}

verifySchema();
