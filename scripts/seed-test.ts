/**
 * Idempotent test database seed script.
 * Creates test users (owner + client) with salon data needed for E2E tests.
 *
 * Usage: pnpm db:seed:test
 * Requires: POSTGRES_URL env var
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hashPassword } from "better-auth/crypto";
import {
  user,
  account,
  verification,
  salons,
  employees,
  services,
  serviceCategories,
  clients,
  subscriptionPlans,
} from "../src/lib/schema";

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
  console.error("POSTGRES_URL is required");
  process.exit(1);
}

const sql = postgres(connectionString);
const db = drizzle(sql);

// Fixed IDs for idempotency
const OWNER_USER_ID = "test-owner-user-id-00001";
const CLIENT_USER_ID = "test-client-user-id-00001";
const SALON_ID = "00000000-0000-0000-0000-000000000001";

async function seed() {
  console.log("[seed-test] Starting test seed...");

  // 1. Create owner user
  const ownerPasswordHash = await hashPassword("TestPassword123!");

  await db
    .insert(user)
    .values({
      id: OWNER_USER_ID,
      name: "Test Owner",
      email: "owner@test.com",
      emailVerified: true,
      role: "owner",
    })
    .onConflictDoUpdate({
      target: user.id,
      set: { name: "Test Owner", emailVerified: true, role: "owner" },
    });

  await db
    .insert(account)
    .values({
      id: "test-owner-account-00001",
      accountId: OWNER_USER_ID,
      providerId: "credential",
      userId: OWNER_USER_ID,
      password: ownerPasswordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: account.id,
      set: { password: ownerPasswordHash, updatedAt: new Date() },
    });

  // Add email verification record for owner
  await db
    .insert(verification)
    .values({
      id: "test-owner-email-verify-001",
      identifier: "owner@test.com",
      value: "email-verified",
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: verification.id,
      set: { identifier: "owner@test.com", updatedAt: new Date() },
    });

  console.log("[seed-test] Created owner user: owner@test.com (emailVerified=true + verification record)");

  // 2. Create client user
  const clientPasswordHash = await hashPassword("TestPassword123!");

  await db
    .insert(user)
    .values({
      id: CLIENT_USER_ID,
      name: "Test Client",
      email: "client@test.com",
      emailVerified: true,
      role: "client",
    })
    .onConflictDoUpdate({
      target: user.id,
      set: { name: "Test Client", emailVerified: true, role: "client" },
    });

  await db
    .insert(account)
    .values({
      id: "test-client-account-00001",
      accountId: CLIENT_USER_ID,
      providerId: "credential",
      userId: CLIENT_USER_ID,
      password: clientPasswordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: account.id,
      set: { password: clientPasswordHash, updatedAt: new Date() },
    });

  // Add email verification record for client
  await db
    .insert(verification)
    .values({
      id: "test-client-email-verify-001",
      identifier: "client@test.com",
      value: "email-verified",
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: verification.id,
      set: { identifier: "client@test.com", updatedAt: new Date() },
    });

  console.log("[seed-test] Created client user: client@test.com (emailVerified=true + verification record)");

  // 3. Create test salon linked to owner
  await db
    .insert(salons)
    .values({
      id: SALON_ID,
      name: "Beauty Studio Demo",
      phone: "+48 123 456 789",
      email: "demo@beautystudio.pl",
      address: "ul. Przykladowa 123, Warszawa",
      industryType: "beauty_salon",
      ownerId: OWNER_USER_ID,
    })
    .onConflictDoUpdate({
      target: salons.id,
      set: { name: "Beauty Studio Demo", ownerId: OWNER_USER_ID },
    });

  console.log("[seed-test] Created salon: Beauty Studio Demo");

  // 4. Create employee linked to owner user
  const employeeData = [
    {
      id: "00000000-0000-0000-0000-e00000000001",
      firstName: "Anna",
      lastName: "Kowalska",
      color: "#3b82f6",
      role: "owner",
      userId: OWNER_USER_ID,
    },
    {
      id: "00000000-0000-0000-0000-e00000000002",
      firstName: "Marta",
      lastName: "Nowak",
      color: "#10b981",
      role: "employee",
    },
  ];

  for (const emp of employeeData) {
    await db
      .insert(employees)
      .values({
        id: emp.id,
        salonId: SALON_ID,
        firstName: emp.firstName,
        lastName: emp.lastName,
        color: emp.color,
        role: emp.role,
        isActive: true,
        userId: emp.userId || null,
      })
      .onConflictDoUpdate({
        target: employees.id,
        set: {
          firstName: emp.firstName,
          lastName: emp.lastName,
          isActive: true,
        },
      });
  }

  console.log("[seed-test] Created 2 employees");

  // 5. Create service category + services
  const categoryId = "00000000-0000-0000-0000-ca0000000001";
  await db
    .insert(serviceCategories)
    .values({
      id: categoryId,
      salonId: SALON_ID,
      name: "Fryzjerstwo",
    })
    .onConflictDoUpdate({
      target: serviceCategories.id,
      set: { name: "Fryzjerstwo" },
    });

  const serviceData = [
    { id: "00000000-0000-0000-0000-5e0000000001", name: "Strzyzenie damskie", basePrice: "80", baseDuration: 60 },
    { id: "00000000-0000-0000-0000-5e0000000002", name: "Koloryzacja", basePrice: "150", baseDuration: 90 },
    { id: "00000000-0000-0000-0000-5e0000000003", name: "Manicure hybrydowy", basePrice: "100", baseDuration: 60 },
  ];

  for (const svc of serviceData) {
    await db
      .insert(services)
      .values({
        id: svc.id,
        salonId: SALON_ID,
        name: svc.name,
        basePrice: svc.basePrice,
        baseDuration: svc.baseDuration,
        categoryId: categoryId,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: services.id,
        set: { name: svc.name, isActive: true },
      });
  }

  console.log("[seed-test] Created 3 services");

  // 6. Create test clients
  const clientData = [
    { id: "00000000-0000-0000-0000-c10000000001", firstName: "Maria", lastName: "Kaczmarek", phone: "+48 111 222 333" },
    { id: "00000000-0000-0000-0000-c10000000002", firstName: "Joanna", lastName: "Lewandowska", phone: "+48 444 555 666" },
  ];

  for (const c of clientData) {
    await db
      .insert(clients)
      .values({
        id: c.id,
        salonId: SALON_ID,
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
      })
      .onConflictDoUpdate({
        target: clients.id,
        set: { firstName: c.firstName, lastName: c.lastName },
      });
  }

  console.log("[seed-test] Created 2 clients");

  // 7. Create subscription plans (needed for registration flow)
  const planData = [
    {
      id: "00000000-0000-0000-0000-p10000000001",
      name: "Basic",
      slug: "basic",
      priceMonthly: "49.00",
      featuresJson: [
        "Kalendarz wizyt",
        "Baza klientow",
        "Zarzadzanie pracownikami",
        "Raporty podstawowe",
        "Powiadomienia SMS/email",
      ],
    },
    {
      id: "00000000-0000-0000-0000-p10000000002",
      name: "Pro",
      slug: "pro",
      priceMonthly: "149.00",
      featuresJson: [
        "Wszystko z Basic",
        "Asystent AI glosowy",
        "AI Business Intelligence",
        "Generator tresci AI",
        "Zaawansowane raporty",
        "Rekomendacje AI",
      ],
    },
  ];

  for (const plan of planData) {
    await db
      .insert(subscriptionPlans)
      .values({
        id: plan.id,
        name: plan.name,
        slug: plan.slug,
        priceMonthly: plan.priceMonthly,
        featuresJson: plan.featuresJson,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: subscriptionPlans.slug,
        set: { name: plan.name, priceMonthly: plan.priceMonthly, featuresJson: plan.featuresJson, isActive: true },
      });
  }

  console.log("[seed-test] Created 2 subscription plans (Basic + Pro)");

  console.log("[seed-test] Seed completed successfully!");
  await sql.end();
}

seed().catch((err) => {
  console.error("[seed-test] Seed failed:", err);
  process.exit(1);
});
