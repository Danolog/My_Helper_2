import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { salons, employees, services, clients, appointments } from "@/lib/schema";

import { logger } from "@/lib/logger";
// POST /api/seed - Seed test data for development
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Seed route is disabled in production" }, { status: 403 });
  }

  try {
    logger.info("[Seed API] Starting seed process...");

    // Create test salon
    const salonResult = await db
      .insert(salons)
      .values({
        id: "00000000-0000-0000-0000-000000000001",
        name: "Beauty Studio Demo",
        phone: "+48 123 456 789",
        email: "demo@beautystudio.pl",
        address: "ul. Przykladowa 123, Warszawa",
        industryType: "beauty_salon",
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
      const result = await db
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
      const result = await db
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
      { firstName: "Maria", lastName: "Kaczmarek", phone: "+48 111 222 333" },
      { firstName: "Joanna", lastName: "Lewandowska", phone: "+48 444 555 666" },
      { firstName: "Agnieszka", lastName: "Wojcik", phone: "+48 777 888 999" },
    ];

    const createdClients = [];
    for (const client of clientData) {
      const result = await db
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

      await db.insert(appointments).values({
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

    return NextResponse.json({
      success: true,
      message: "Seed completed successfully",
      data: {
        salon: salon.id,
        employees: createdEmployees.length,
        services: createdServices.length,
        clients: createdClients.length,
        appointments: createdAppointments,
      },
    });
  } catch (error) {
    logger.error("[Seed API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to seed data", details: String(error) },
      { status: 500 }
    );
  }
}
