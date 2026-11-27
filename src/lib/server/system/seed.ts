/**
 * Wyjście systemowe (#193 P5b): seed danych demonstracyjnych dla
 * `POST /api/seed`. Zapisuje salon demonstracyjny o stałym id oraz jego
 * pracowników, usługi, klientki i dzisiejsze wizyty — cross-salon z natury
 * (tworzy salon), więc idzie przez pulę systemową, nie przez `forSalon`.
 *
 * Blokada celu przed pierwszym zapytaniem:
 * - `NODE_ENV=production` → odmowa;
 * - `checkSeedTarget(POSTGRES_URL)` (`scripts/seed-host-guard.ts`) → odmowa
 *   dla Neona, hostów spoza listy lokalnych, brakującego albo
 *   niejednoznacznego adresu.
 * Odmowa to wynik `{ ok: false, reason }`, gdzie `reason` jest wyłącznie kodem
 * powodu — bez adresu bazy, użytkownika i hasła (także w logu).
 *
 * Wszystkie zapisywane wartości pochodzą z kodu; funkcja nie przyjmuje
 * parametrów z żądania.
 */
import { logger } from "@/lib/logger";
import { appointments, clients, employees, salons, services } from "@/lib/schema";
import { dbSystem } from "./db-system";
import { checkSeedTarget, type SeedRejectCode } from "../../../../scripts/seed-host-guard";

/** Kod powodu odmowy: blokada produkcji albo kod strażnika celu. */
export type SeedDemoRefusal = "production" | SeedRejectCode;

export type SeedDemoResult =
  | {
      ok: true;
      data: { salon: string; employees: number; services: number; clients: number; appointments: number };
    }
  | { ok: false; reason: SeedDemoRefusal };

/** Blokada celu: `null` = wolno pisać, inaczej kod powodu odmowy. */
function seedRefusal(): SeedDemoRefusal | null {
  if (process.env.NODE_ENV === "production") return "production";
  const target = checkSeedTarget(process.env.POSTGRES_URL);
  return target.ok ? null : target.code;
}

/**
 * Zapisuje dane demonstracyjne. Odmowa celu → `{ ok: false, reason }` bez
 * żadnego zapytania. Błąd bazy propaguje do wołającego.
 */
export async function seedDemoData(): Promise<SeedDemoResult> {
  const refusal = seedRefusal();
  if (refusal !== null) {
    logger.warn("[Seed API] Seed zablokowany", { reason: refusal });
    return { ok: false, reason: refusal };
  }

  logger.info("[Seed API] Starting seed process...");

  // Create test salon
  const salonResult = await dbSystem
    .insert(salons)
    .values({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Beauty Studio Demo",
      phone: "+48 000 600 704", // numer testowy (src/lib/test-phone.ts)
      email: "demo@beautystudio.pl",
      address: "ul. Przykladowa 123, Warszawa",
      industryType: "beauty_salon",
      // Ten sam krótki adres co w scripts/seed-test.ts (ten sam salon demo).
      slug: "beauty-studio-demo",
    })
    .onConflictDoUpdate({
      target: salons.id,
      set: { name: "Beauty Studio Demo" },
    })
    .returning();

  const salon = salonResult[0];
  if (!salon) {
    throw new Error("Failed to create salon");
  }

  logger.info(`[Seed API] Created salon: ${salon.id}`);

  // Create test employees
  const employeeData = [
    { firstName: "Anna", lastName: "Kowalska", color: "#3b82f6", role: "owner" },
    { firstName: "Marta", lastName: "Nowak", color: "#10b981", role: "employee" },
    { firstName: "Kasia", lastName: "Wisniewska", color: "#f59e0b", role: "employee" },
  ];

  const createdEmployees = [];
  for (const emp of employeeData) {
    const result = await dbSystem
      .insert(employees)
      .values({
        salonId: salon.id,
        firstName: emp.firstName,
        lastName: emp.lastName,
        color: emp.color,
        role: emp.role,
        isActive: true,
      })
      .returning();
    if (result[0]) {
      createdEmployees.push(result[0]);
    }
  }
  logger.info(`[Seed API] Created ${createdEmployees.length} employees`);

  // Create test services
  const serviceData = [
    { name: "Strzyzenie damskie", basePrice: "80", baseDuration: 60 },
    { name: "Koloryzacja", basePrice: "150", baseDuration: 90 },
    { name: "Manicure hybrydowy", basePrice: "100", baseDuration: 60 },
    { name: "Pedicure", basePrice: "120", baseDuration: 75 },
    { name: "Zabieg na twarz", basePrice: "200", baseDuration: 90 },
  ];

  const createdServices = [];
  for (const svc of serviceData) {
    const result = await dbSystem
      .insert(services)
      .values({
        salonId: salon.id,
        name: svc.name,
        basePrice: svc.basePrice,
        baseDuration: svc.baseDuration,
        isActive: true,
      })
      .returning();
    if (result[0]) {
      createdServices.push(result[0]);
    }
  }
  logger.info(`[Seed API] Created ${createdServices.length} services`);

  // Create test clients
  const clientData = [
    // Telefony z TEST_PHONE_NUMBERS (#75) — SMS na nie nie wychodzi
    { firstName: "Maria", lastName: "Kaczmarek", phone: "+48 000 600 701" },
    { firstName: "Joanna", lastName: "Lewandowska", phone: "+48 000 600 702" },
    { firstName: "Agnieszka", lastName: "Wojcik", phone: "+48 000 600 703" },
  ];

  const createdClients = [];
  for (const client of clientData) {
    const result = await dbSystem
      .insert(clients)
      .values({
        salonId: salon.id,
        firstName: client.firstName,
        lastName: client.lastName,
        phone: client.phone,
      })
      .returning();
    if (result[0]) {
      createdClients.push(result[0]);
    }
  }
  logger.info(`[Seed API] Created ${createdClients.length} clients`);

  // Create test appointments for today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const appointmentData = [
    { employeeIndex: 0, serviceIndex: 0, clientIndex: 0, startHour: 9, startMinute: 0 },
    { employeeIndex: 0, serviceIndex: 1, clientIndex: 1, startHour: 11, startMinute: 0 },
    { employeeIndex: 1, serviceIndex: 2, clientIndex: 2, startHour: 10, startMinute: 0 },
    { employeeIndex: 1, serviceIndex: 3, clientIndex: 0, startHour: 14, startMinute: 0 },
    { employeeIndex: 2, serviceIndex: 4, clientIndex: 1, startHour: 9, startMinute: 30 },
  ];

  let createdAppointments = 0;
  for (const apt of appointmentData) {
    const employee = createdEmployees[apt.employeeIndex];
    const service = createdServices[apt.serviceIndex];
    const client = createdClients[apt.clientIndex];

    if (!employee || !service || !client) {
      logger.info("[Seed API] Skipping appointment due to missing reference data");
      continue;
    }

    const startTime = new Date(today);
    startTime.setHours(apt.startHour, apt.startMinute, 0, 0);
    const endTime = new Date(startTime.getTime() + service.baseDuration * 60 * 1000);

    await dbSystem.insert(appointments).values({
      salonId: salon.id,
      clientId: client.id,
      employeeId: employee.id,
      serviceId: service.id,
      startTime,
      endTime,
      status: "scheduled",
    });
    createdAppointments++;
  }
  logger.info(`[Seed API] Created ${createdAppointments} appointments`);

  return {
    ok: true,
    data: {
      salon: salon.id,
      employees: createdEmployees.length,
      services: createdServices.length,
      clients: createdClients.length,
      appointments: createdAppointments,
    },
  };
}
