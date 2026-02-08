import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  services,
  serviceVariants,
  employeeServices,
  employees,
  employeeServicePrices,
  serviceCategories,
} from "@/lib/schema";
import { eq, and } from "drizzle-orm";

// GET /api/salons/[id]/services/[serviceId] - Get service details with variants and assigned employees
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; serviceId: string }> }
) {
  try {
    const { id: salonId, serviceId } = await params;

    // Fetch the service and verify it belongs to the salon
    const [service] = await db
      .select()
      .from(services)
      .where(and(eq(services.id, serviceId), eq(services.salonId, salonId)));

    if (!service) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    // Fetch category info if available
    let category = null;
    if (service.categoryId) {
      const [cat] = await db
        .select()
        .from(serviceCategories)
        .where(eq(serviceCategories.id, service.categoryId));
      category = cat || null;
    }

    // Fetch all variants for this service
    const variants = await db
      .select()
      .from(serviceVariants)
      .where(eq(serviceVariants.serviceId, serviceId));

    // Fetch assigned employees with their custom prices
    const assignments = await db
      .select({
        assignment: employeeServices,
        employee: employees,
      })
      .from(employeeServices)
      .innerJoin(employees, eq(employeeServices.employeeId, employees.id))
      .where(
        and(
          eq(employeeServices.serviceId, serviceId),
          eq(employees.isActive, true)
        )
      );

    // Fetch custom prices for assigned employees
    const assignedEmployeeIds = assignments.map((a) => a.employee.id);
    let customPrices: { employeeId: string; customPrice: string }[] = [];
    if (assignedEmployeeIds.length > 0) {
      const priceRows = await db
        .select()
        .from(employeeServicePrices)
        .where(eq(employeeServicePrices.serviceId, serviceId));
      customPrices = priceRows.map((p) => ({
        employeeId: p.employeeId,
        customPrice: p.customPrice,
      }));
    }

    // Build employee list with optional custom prices
    const employeeList = assignments.map((row) => {
      const emp = row.employee;
      const priceEntry = customPrices.find((p) => p.employeeId === emp.id);
      return {
        id: emp.id,
        firstName: emp.firstName,
        lastName: emp.lastName,
        role: emp.role,
        color: emp.color,
        photoUrl: emp.photoUrl,
        customPrice: priceEntry?.customPrice || null,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        id: service.id,
        name: service.name,
        description: service.description,
        basePrice: service.basePrice,
        baseDuration: service.baseDuration,
        isActive: service.isActive,
        salonId: service.salonId,
        categoryId: service.categoryId,
        category: category
          ? { id: category.id, name: category.name }
          : null,
        variants: variants.map((v) => ({
          id: v.id,
          name: v.name,
          priceModifier: v.priceModifier,
          durationModifier: v.durationModifier,
        })),
        employees: employeeList,
      },
    });
  } catch (error) {
    console.error("[Salon Service Detail API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch service details" },
      { status: 500 }
    );
  }
}
