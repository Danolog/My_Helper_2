import { NextResponse } from "next/server";
import { appointments, clients, employees, services, treatmentHistory, appointmentMaterials, products } from "@/lib/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { forSalon } from "@/lib/server/repository";

import { logger } from "@/lib/logger";
// GET /api/clients/[id]/appointments - Get all appointments for a specific client
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { id } = await params;

    // First verify the client belongs to the caller's salon
    const client = await forSalon(salonId).findOne(clients, id);

    if (!client) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }

    // Fetch all appointments for this client with joined employee, service, and treatment data
    const result = await forSalon(salonId).raw((tx) =>
      tx
        .select({
          appointment: appointments,
          employee: employees,
          service: services,
          treatment: treatmentHistory,
        })
        .from(appointments)
        .leftJoin(employees, eq(appointments.employeeId, employees.id))
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .leftJoin(treatmentHistory, eq(appointments.id, treatmentHistory.appointmentId))
        .where(and(eq(appointments.clientId, id), eq(appointments.salonId, salonId)))
        .orderBy(desc(appointments.startTime))
    );

    // Fetch materials for all appointments using inArray for efficiency
    const appointmentIds = result.map((row) => row.appointment.id);
    const materialsMap: Record<string, Array<{
      id: string;
      appointmentId: string;
      productId: string;
      quantityUsed: string;
      notes: string | null;
      createdAt: Date;
      product: {
        id: string;
        name: string;
        category: string | null;
        quantity: string | null;
        unit: string | null;
        pricePerUnit: string | null;
      } | null;
    }>> = {};

    if (appointmentIds.length > 0) {
      const allMaterials = await forSalon(salonId).raw((tx) =>
        tx
          .select({
            material: appointmentMaterials,
            product: products,
          })
          .from(appointmentMaterials)
          .leftJoin(products, eq(appointmentMaterials.productId, products.id))
          .where(inArray(appointmentMaterials.appointmentId, appointmentIds))
      );

      // Group materials by appointmentId
      for (const row of allMaterials) {
        const aptId = row.material.appointmentId;
        if (!materialsMap[aptId]) {
          materialsMap[aptId] = [];
        }
        materialsMap[aptId].push({
          id: row.material.id,
          appointmentId: row.material.appointmentId,
          productId: row.material.productId,
          quantityUsed: row.material.quantityUsed,
          notes: row.material.notes,
          createdAt: row.material.createdAt,
          product: row.product
            ? {
                id: row.product.id,
                name: row.product.name,
                category: row.product.category,
                quantity: row.product.quantity,
                unit: row.product.unit,
                pricePerUnit: row.product.pricePerUnit,
              }
            : null,
        });
      }
    }

    const formattedAppointments = result.map((row) => ({
      ...row.appointment,
      employee: row.employee
        ? {
            id: row.employee.id,
            firstName: row.employee.firstName,
            lastName: row.employee.lastName,
            color: row.employee.color,
          }
        : null,
      service: row.service
        ? {
            id: row.service.id,
            name: row.service.name,
            basePrice: row.service.basePrice,
            baseDuration: row.service.baseDuration,
          }
        : null,
      treatment: row.treatment
        ? {
            id: row.treatment.id,
            recipe: row.treatment.recipe,
            techniques: row.treatment.techniques,
            materialsJson: row.treatment.materialsJson,
            notes: row.treatment.notes,
            createdAt: row.treatment.createdAt,
          }
        : null,
      materials: materialsMap[row.appointment.id] || [],
    }));

    logger.info(`[Client Appointments API] Found ${formattedAppointments.length} appointments for client ${id}`);

    return NextResponse.json({
      success: true,
      data: formattedAppointments,
      count: formattedAppointments.length,
    });
  } catch (error) {
    logger.error("[Client Appointments API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch client appointments" },
      { status: 500 }
    );
  }
}
