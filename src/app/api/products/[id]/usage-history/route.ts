import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointmentMaterials, products, appointments, clients, employees, services } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { isValidUuid } from "@/lib/validations";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
// GET /api/products/[id]/usage-history - Get usage history for a product
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    if (!isValidUuid(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid product ID format" },
        { status: 400 }
      );
    }

    // Verify product exists
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (!product) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    // Get all usage records for this product with appointment details
    const usageRecords = await db
      .select({
        material: appointmentMaterials,
        appointment: appointments,
        client: clients,
        employee: employees,
        service: services,
      })
      .from(appointmentMaterials)
      .innerJoin(appointments, eq(appointmentMaterials.appointmentId, appointments.id))
      .leftJoin(clients, eq(appointments.clientId, clients.id))
      .leftJoin(employees, eq(appointments.employeeId, employees.id))
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .where(eq(appointmentMaterials.productId, id))
      .orderBy(desc(appointmentMaterials.createdAt));

    const formattedHistory = usageRecords.map((row) => ({
      id: row.material.id,
      quantityUsed: row.material.quantityUsed,
      notes: row.material.notes,
      createdAt: row.material.createdAt,
      appointment: {
        id: row.appointment.id,
        startTime: row.appointment.startTime,
        endTime: row.appointment.endTime,
        status: row.appointment.status,
        client: row.client
          ? {
              id: row.client.id,
              firstName: row.client.firstName,
              lastName: row.client.lastName,
            }
          : null,
        employee: row.employee
          ? {
              id: row.employee.id,
              firstName: row.employee.firstName,
              lastName: row.employee.lastName,
            }
          : null,
        service: row.service
          ? {
              id: row.service.id,
              name: row.service.name,
            }
          : null,
      },
    }));

    // Calculate total usage
    const totalUsed = usageRecords.reduce(
      (sum, r) => sum + parseFloat(r.material.quantityUsed),
      0
    );

    return NextResponse.json({
      success: true,
      data: {
        product: {
          id: product.id,
          name: product.name,
          category: product.category,
          quantity: product.quantity,
          unit: product.unit,
          pricePerUnit: product.pricePerUnit,
          minQuantity: product.minQuantity,
        },
        history: formattedHistory,
        totalUsed,
        totalRecords: formattedHistory.length,
      },
    });
  } catch (error) {
    logger.error("[Product Usage History API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch product usage history" },
      { status: 500 }
    );
  }
}
