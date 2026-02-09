import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { galleryPhotos, employees, services } from "@/lib/schema";
import { eq, desc, and } from "drizzle-orm";

// GET /api/gallery - List gallery photos
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const employeeId = searchParams.get("employeeId");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    let photos;
    if (employeeId) {
      photos = await db
        .select({
          id: galleryPhotos.id,
          salonId: galleryPhotos.salonId,
          employeeId: galleryPhotos.employeeId,
          serviceId: galleryPhotos.serviceId,
          beforePhotoUrl: galleryPhotos.beforePhotoUrl,
          afterPhotoUrl: galleryPhotos.afterPhotoUrl,
          description: galleryPhotos.description,
          productsUsed: galleryPhotos.productsUsed,
          techniques: galleryPhotos.techniques,
          duration: galleryPhotos.duration,
          createdAt: galleryPhotos.createdAt,
          employeeFirstName: employees.firstName,
          employeeLastName: employees.lastName,
          serviceName: services.name,
        })
        .from(galleryPhotos)
        .leftJoin(employees, eq(galleryPhotos.employeeId, employees.id))
        .leftJoin(services, eq(galleryPhotos.serviceId, services.id))
        .where(and(eq(galleryPhotos.salonId, salonId), eq(galleryPhotos.employeeId, employeeId)))
        .orderBy(desc(galleryPhotos.createdAt));
    } else {
      photos = await db
        .select({
          id: galleryPhotos.id,
          salonId: galleryPhotos.salonId,
          employeeId: galleryPhotos.employeeId,
          serviceId: galleryPhotos.serviceId,
          beforePhotoUrl: galleryPhotos.beforePhotoUrl,
          afterPhotoUrl: galleryPhotos.afterPhotoUrl,
          description: galleryPhotos.description,
          productsUsed: galleryPhotos.productsUsed,
          techniques: galleryPhotos.techniques,
          duration: galleryPhotos.duration,
          createdAt: galleryPhotos.createdAt,
          employeeFirstName: employees.firstName,
          employeeLastName: employees.lastName,
          serviceName: services.name,
        })
        .from(galleryPhotos)
        .leftJoin(employees, eq(galleryPhotos.employeeId, employees.id))
        .leftJoin(services, eq(galleryPhotos.serviceId, services.id))
        .where(eq(galleryPhotos.salonId, salonId))
        .orderBy(desc(galleryPhotos.createdAt));
    }

    console.log(`[Gallery API] GET: ${photos.length} photos found`);

    return NextResponse.json({
      success: true,
      data: photos,
      count: photos.length,
    });
  } catch (error) {
    console.error("[Gallery API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch gallery photos" },
      { status: 500 }
    );
  }
}

// POST /api/gallery - Create a gallery photo entry
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      salonId,
      employeeId,
      serviceId,
      beforePhotoUrl,
      afterPhotoUrl,
      description,
      productsUsed,
      techniques,
      duration,
    } = body;

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    if (!afterPhotoUrl && !beforePhotoUrl) {
      return NextResponse.json(
        { success: false, error: "At least one photo URL is required" },
        { status: 400 }
      );
    }

    const [newPhoto] = await db
      .insert(galleryPhotos)
      .values({
        salonId,
        employeeId: employeeId || null,
        serviceId: serviceId || null,
        beforePhotoUrl: beforePhotoUrl || null,
        afterPhotoUrl: afterPhotoUrl || null,
        description: description || null,
        productsUsed: productsUsed || null,
        techniques: techniques || null,
        duration: duration ? parseInt(duration, 10) : null,
      })
      .returning();

    console.log(`[Gallery API] Created photo: ${newPhoto?.id}`);

    return NextResponse.json(
      {
        success: true,
        data: newPhoto,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Gallery API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create gallery photo" },
      { status: 500 }
    );
  }
}
