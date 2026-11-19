/**
 * Idempotent test database seed script.
 * Creates test users (owner + client) with salon data needed for E2E tests.
 *
 * Usage: pnpm db:seed:test
 * Requires: POSTGRES_URL env var pointing at a host from SEED_ALLOWED_HOSTS and a
 * database from SEED_ALLOWED_DATABASES (see ./seed-host-guard.ts). Neon (also behind
 * a localhost tunnel) and VERCEL_ENV=preview/production are refused.
 */

import { and, inArray, notInArray } from "drizzle-orm";
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
  employeeServices,
  workSchedules,
  promotions,
  promoCodes,
  salonSubscriptions,
} from "../src/lib/schema";
import {
  checkSeedClientOptions,
  checkSeedServerIdentity,
  checkSeedTarget,
  SEED_SERVER_PROBE_SQL,
} from "./seed-host-guard";
import { seedPlans } from "./seed-plans";

const connectionString = process.env.POSTGRES_URL;
const target = checkSeedTarget(connectionString, { VERCEL_ENV: process.env.VERCEL_ENV });
if (!target.ok || !connectionString) {
  console.error(`[seed-test] Odmowa: ${target.ok ? "POSTGRES_URL jest wymagany" : target.reason}`);
  process.exit(1);
}

// postgres(...) nie łączy się przed pierwszym zapytaniem. Sprawdzamy hosty, które
// wyliczył sam klient, bo jego parser URL różni się od WHATWG URL z etapu 1.
const sql = postgres(connectionString);
const clientTarget = checkSeedClientOptions(sql.options);
if (!clientTarget.ok) {
  console.error(`[seed-test] Odmowa: ${clientTarget.reason}`);
  void sql.end({ timeout: 0 }).finally(() => process.exit(1));
} else {
  console.log(`[seed-test] Host docelowy: ${clientTarget.hosts.join(", ")}`);
}
const db = drizzle(sql);

// Fixed IDs for idempotency
const OWNER_USER_ID = "test-owner-user-id-00001";
const CLIENT_USER_ID = "test-client-user-id-00001";
const SALON_ID = "00000000-0000-4000-8000-000000000001";
// Drugi właściciel i jego salon w stanie „okres próbny zakończony” (tylko odczyt).
const TRIAL_EXPIRED_OWNER_USER_ID = "test-owner-user-id-00002";
const TRIAL_EXPIRED_SALON_ID = "00000000-0000-4000-8000-000000000002";

// Po jednym wierszu subskrypcji na salon seeda, plan Basic, bez identyfikatorów Stripe.
// Salon testowy: active bez dat okresu (pełny dostęp niezależnie od dat). Salon po okresie
// próbnym: trialing ze stałym terminem w przeszłości.
const SEED_SUBSCRIPTIONS = [
  {
    id: "00000000-0000-4000-8000-5b5000000001",
    salonId: SALON_ID,
    status: "active",
    trialEndsAt: null,
  },
  {
    id: "00000000-0000-4000-8000-5b5000000002",
    salonId: TRIAL_EXPIRED_SALON_ID,
    status: "trialing",
    trialEndsAt: new Date("2026-01-01T00:00:00.000Z"),
  },
] as const;

// Dane E2E zadatku i promocji zamrozonych (tests/client-portal/deposit-frozen-happy-hours.spec.ts,
// tests/dashboard/frozen-promotions.spec.ts). Stale ID — te same co w testach (testy NIE importuja
// tego pliku: ma efekty uboczne na poziomie modulu, laczy sie z baza).
const E2E_DEPOSIT = {
  employeeId: "00000000-0000-4000-8000-e00000000003",
  serviceId: "00000000-0000-4000-8000-5e0000000004",
  employeeServiceId: "00000000-0000-4000-8000-e5e000000001",
  basePrice: "200",
  depositPercentage: 30,
} as const;
const E2E_PROMOTIONS = {
  happyHoursId: "00000000-0000-4000-8000-9c0000000001",
  packageId: "00000000-0000-4000-8000-9c0000000002",
  percentageId: "00000000-0000-4000-8000-9c0000000003",
  happyHoursCodeId: "00000000-0000-4000-8000-9cc000000001",
  percentageCodeId: "00000000-0000-4000-8000-9cc000000002",
} as const;

async function seed() {
  // Etap 3, przed pierwszym zapisem: co mówi o sobie serwer. Łapie tunel
  // localhost:<port> → zdalna baza, którego etapy 1–2 nie widzą.
  const [identity] = await sql.unsafe(SEED_SERVER_PROBE_SQL);
  const server = checkSeedServerIdentity(identity);
  if (!server.ok) {
    console.error(`[seed-test] Odmowa: ${server.reason}`);
    await sql.end({ timeout: 0 });
    process.exit(1);
  }
  console.log(`[seed-test] Baza docelowa: ${server.database}`);

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
  // E2E testuje pelny produkt, wiec salon testowy ma WLACZONE wszystkie moduly
  // opcjonalne (Faza 2: domyslnie OFF — "chudy UI"); hardOff (voiceAi/videoGen/
  // fiscal/socialPosts) pozostaja wylaczone globalnie niezaleznie od zapisu.
  const seedModules = {
    modules: {
      products: true,
      promotions: true,
      loyalty: true,
      waitingList: true,
      newsletters: true,
      invoices: true,
      reportsAdvanced: true,
    },
  };
  await db
    .insert(salons)
    .values({
      id: SALON_ID,
      name: "Beauty Studio Demo",
      phone: "+48 000 600 704", // numer testowy (src/lib/test-phone.ts)
      email: "demo@beautystudio.pl",
      address: "ul. Przykladowa 123, Warszawa",
      industryType: "beauty_salon",
      ownerId: OWNER_USER_ID,
      settingsJson: seedModules,
    })
    .onConflictDoUpdate({
      target: salons.id,
      set: { name: "Beauty Studio Demo", phone: "+48 000 600 704", ownerId: OWNER_USER_ID, settingsJson: seedModules },
    });

  console.log("[seed-test] Created salon: Beauty Studio Demo");

  // 4. Create employee linked to owner user
  const employeeData = [
    {
      id: "00000000-0000-4000-8000-e00000000001",
      firstName: "Anna",
      lastName: "Kowalska",
      color: "#3b82f6",
      role: "owner",
      userId: OWNER_USER_ID,
    },
    {
      id: "00000000-0000-4000-8000-e00000000002",
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
  const categoryId = "00000000-0000-4000-8000-ca0000000001";
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
    { id: "00000000-0000-4000-8000-5e0000000001", name: "Strzyzenie damskie", basePrice: "80", baseDuration: 60 },
    { id: "00000000-0000-4000-8000-5e0000000002", name: "Koloryzacja", basePrice: "150", baseDuration: 90 },
    { id: "00000000-0000-4000-8000-5e0000000003", name: "Manicure hybrydowy", basePrice: "100", baseDuration: 60 },
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
  // Telefony z TEST_PHONE_NUMBERS (#75): E2E tworzące wizytę wołają SMS
  // potwierdzenia — na numer testowy sendSms nic nie wysyła.
  const clientData = [
    { id: "00000000-0000-4000-8000-c10000000001", firstName: "Maria", lastName: "Kaczmarek", phone: "+48 000 600 701" },
    { id: "00000000-0000-4000-8000-c10000000002", firstName: "Joanna", lastName: "Lewandowska", phone: "+48 000 600 702" },
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
        // phone w set: reseed istniejącej bazy podmienia stare numery na testowe
        set: { firstName: c.firstName, lastName: c.lastName, phone: c.phone },
      });
  }

  console.log("[seed-test] Created 2 clients");

  // 7. Plany Basic i Pro (rejestracja) — z PLANS i PLAN_FEATURES, idempotentnie po slug (./seed-plans).
  await seedPlans(db);

  console.log("[seed-test] Ensured 2 subscription plans (Basic + Pro)");

  // 8. Zadatek + promocje zamrozone (E2E). Osobny pracownik i usluga, zeby
  // rezerwacje testu nie kolidowaly z innymi testami kalendarza.
  await db
    .insert(employees)
    .values({
      id: E2E_DEPOSIT.employeeId,
      salonId: SALON_ID,
      firstName: "Ewa",
      lastName: "Zadatkowa",
      color: "#f59e0b",
      role: "employee",
      isActive: true,
    })
    .onConflictDoUpdate({
      target: employees.id,
      set: { firstName: "Ewa", lastName: "Zadatkowa", isActive: true, salonId: SALON_ID },
    });

  await db
    .insert(services)
    .values({
      id: E2E_DEPOSIT.serviceId,
      salonId: SALON_ID,
      name: "Zabieg z zadatkiem (E2E)",
      basePrice: E2E_DEPOSIT.basePrice,
      baseDuration: 60,
      categoryId: categoryId,
      depositRequired: true,
      depositPercentage: E2E_DEPOSIT.depositPercentage,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: services.id,
      set: {
        name: "Zabieg z zadatkiem (E2E)",
        basePrice: E2E_DEPOSIT.basePrice,
        baseDuration: 60,
        depositRequired: true,
        depositPercentage: E2E_DEPOSIT.depositPercentage,
        isActive: true,
      },
    });

  await db
    .insert(employeeServices)
    .values({ id: E2E_DEPOSIT.employeeServiceId, employeeId: E2E_DEPOSIT.employeeId, serviceId: E2E_DEPOSIT.serviceId })
    .onConflictDoUpdate({
      target: employeeServices.id,
      set: { employeeId: E2E_DEPOSIT.employeeId, serviceId: E2E_DEPOSIT.serviceId },
    });

  // Grafik 7 dni w tygodniu 08:00-20:00: test rezerwuje "jutro", niezaleznie od dnia tygodnia.
  for (let day = 0; day <= 6; day++) {
    await db
      .insert(workSchedules)
      .values({
        id: `00000000-0000-4000-8000-35c00000000${day}`,
        employeeId: E2E_DEPOSIT.employeeId,
        dayOfWeek: day,
        startTime: "08:00",
        endTime: "20:00",
      })
      .onConflictDoUpdate({
        target: workSchedules.id,
        set: { employeeId: E2E_DEPOSIT.employeeId, dayOfWeek: day, startTime: "08:00", endTime: "20:00" },
      });
  }

  // Promocje: dwie zamrozone (happy_hours obejmujace kazdy termin, package)
  // i jedna dozwolona (percentage) jako kontrola, ze lista w ogole sie laduje.
  // Happy hours 50% przez cala dobe, codziennie, bez dat: gdyby zamrozenie
  // przestalo dzialac, zadatek testu spadlby z 60 do 30 PLN.
  const promotionData = [
    {
      id: E2E_PROMOTIONS.happyHoursId,
      name: "Happy Hours -50% (E2E, zamrozona)",
      type: "happy_hours",
      value: "50",
      conditionsJson: { daysOfWeek: [], startTime: "00:00", endTime: "23:59" },
    },
    {
      id: E2E_PROMOTIONS.packageId,
      name: "Pakiet strzyzenie + manicure (E2E, zamrozona)",
      type: "package",
      value: "150",
      conditionsJson: {
        // Odwolania do uslug z serviceData (Strzyzenie damskie, Manicure hybrydowy) — bez powtorzonych literalow id.
        packageServiceIds: [serviceData[0]!.id, serviceData[2]!.id],
        packagePrice: 150,
      },
    },
    {
      id: E2E_PROMOTIONS.percentageId,
      name: "Rabat 10% (E2E)",
      type: "percentage",
      value: "10",
      conditionsJson: {},
    },
  ];

  for (const promo of promotionData) {
    await db
      .insert(promotions)
      .values({
        id: promo.id,
        salonId: SALON_ID,
        name: promo.name,
        type: promo.type,
        value: promo.value,
        startDate: null,
        endDate: null,
        conditionsJson: promo.conditionsJson,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: promotions.id,
        set: {
          salonId: SALON_ID,
          name: promo.name,
          type: promo.type,
          value: promo.value,
          startDate: null,
          endDate: null,
          conditionsJson: promo.conditionsJson,
          isActive: true,
        },
      });
  }

  const promoCodeData = [
    { id: E2E_PROMOTIONS.happyHoursCodeId, code: "E2E-HAPPY", promotionId: E2E_PROMOTIONS.happyHoursId },
    { id: E2E_PROMOTIONS.percentageCodeId, code: "E2E-RABAT10", promotionId: E2E_PROMOTIONS.percentageId },
  ];
  for (const pc of promoCodeData) {
    await db
      .insert(promoCodes)
      .values({ id: pc.id, salonId: SALON_ID, code: pc.code, promotionId: pc.promotionId, usageLimit: null, usedCount: 0, expiresAt: null })
      .onConflictDoUpdate({
        target: promoCodes.id,
        set: { salonId: SALON_ID, code: pc.code, promotionId: pc.promotionId, usageLimit: null, usedCount: 0, expiresAt: null },
      });
  }

  console.log("[seed-test] Created E2E deposit service + employee schedule, 3 promotions (2 frozen), 2 promo codes");

  // 9. Drugi właściciel i salon po okresie próbnym. Właściciela z salonem wiąże
  // salons.ownerId (logowanie do panelu) — bez pracowników, usług i klientów.
  const trialExpiredOwnerPasswordHash = await hashPassword("TestPassword123!");

  await db
    .insert(user)
    .values({
      id: TRIAL_EXPIRED_OWNER_USER_ID,
      name: "Test Owner Trial Expired",
      email: "owner-trial-expired@test.com",
      emailVerified: true,
      role: "owner",
    })
    .onConflictDoUpdate({
      target: user.id,
      set: { name: "Test Owner Trial Expired", emailVerified: true, role: "owner" },
    });

  await db
    .insert(account)
    .values({
      id: "test-owner-account-00002",
      accountId: TRIAL_EXPIRED_OWNER_USER_ID,
      providerId: "credential",
      userId: TRIAL_EXPIRED_OWNER_USER_ID,
      password: trialExpiredOwnerPasswordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: account.id,
      set: { password: trialExpiredOwnerPasswordHash, updatedAt: new Date() },
    });

  await db
    .insert(verification)
    .values({
      id: "test-owner-email-verify-002",
      identifier: "owner-trial-expired@test.com",
      value: "email-verified",
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: verification.id,
      set: { identifier: "owner-trial-expired@test.com", updatedAt: new Date() },
    });

  // Bez adresu i telefonu: salon nie trafia na publiczną listę salonów, z której testy klienta biorą pierwszy salon.
  await db
    .insert(salons)
    .values({
      id: TRIAL_EXPIRED_SALON_ID,
      name: "Salon Po Okresie Probnym",
      phone: null,
      address: null,
      ownerId: TRIAL_EXPIRED_OWNER_USER_ID,
    })
    .onConflictDoUpdate({
      target: salons.id,
      set: { name: "Salon Po Okresie Probnym", phone: null, address: null, ownerId: TRIAL_EXPIRED_OWNER_USER_ID },
    });

  console.log("[seed-test] Created trial-expired owner + salon");

  // 10. Subskrypcje salonów seeda: po seedzie każdy z dwóch salonów ma dokładnie jeden
  // wiersz — ten z SEED_SUBSCRIPTIONS. W jednej transakcji: usunięcie pozostałych wierszy
  // TYLKO tych dwóch salonów (indeks częściowy: jeden trialing/active na salon), potem
  // wstawienie albo nadpisanie po stałym identyfikatorze.
  // Identyfikator planu odczytany po slug (plan mógł istnieć przed seedPlans z innym id).
  const [basicPlan] = await sql<{ id: string }[]>`select id from subscription_plans where slug = 'basic' limit 1`;
  if (!basicPlan) throw new Error("Brak planu basic po seedPlans");

  await db.transaction(async (tx) => {
    await tx
      .delete(salonSubscriptions)
      .where(
        and(
          inArray(salonSubscriptions.salonId, [SALON_ID, TRIAL_EXPIRED_SALON_ID]),
          notInArray(
            salonSubscriptions.id,
            SEED_SUBSCRIPTIONS.map((s) => s.id),
          ),
        ),
      );

    for (const sub of SEED_SUBSCRIPTIONS) {
      const row = {
        salonId: sub.salonId,
        planId: basicPlan.id,
        stripeSubscriptionId: null,
        stripeCustomerId: null,
        status: sub.status,
        trialEndsAt: sub.trialEndsAt,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        canceledAt: null,
        scheduledPlanId: null,
        scheduledChangeAt: null,
      };
      await tx
        .insert(salonSubscriptions)
        .values({ id: sub.id, ...row })
        .onConflictDoUpdate({ target: salonSubscriptions.id, set: row });
    }
  });

  console.log("[seed-test] Ensured 2 salon subscriptions (active Basic, trialing Basic after trial end)");

  console.log("[seed-test] Seed completed successfully!");
  await sql.end();
}

if (clientTarget.ok) {
  seed().catch((err) => {
    console.error("[seed-test] Seed failed:", err);
    process.exit(1);
  });
}
