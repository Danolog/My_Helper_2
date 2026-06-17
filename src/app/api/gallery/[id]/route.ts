import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { galleryPhotos, employees, services } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { unlink } from "fs/promises";
import path from "path";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { validateBody, updateGalleryPhotoSchema } from "@/lib/api-validation";

import { logger } from "@/lib/logger";
type RouteParams = { params: Promise<{ id: string }> };

// GET /api/gallery/[id] - Get a single gallery photo
export async function GET(_request: Request, { params }: RouteParams) {
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

    const [photo] = await db
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
      .where(and(eq(galleryPhotos.id, id), eq(galleryPhotos.salonId, salonId)));

    if (!photo) {
      return NextResponse.json(
        { success: false, error: "Photo not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: photo,
    });
  } catch (error) {
    logger.error("[Gallery API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch photo" },
      { status: 500 }
    );
  }
}

// PATCH /api/gallery/[id] - Update a gallery photo
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Auth check - get current session
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    // Tenant isolation (P0-A): resolve the salon from the session, never from
    // the URL. A photo belonging to another salon must be invisible (404), so
    // a salon-A owner can never edit a salon-B photo by guessing its UUID.
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Photo not found" },
        { status: 404 }
      );
    }

    // Get the photo scoped to the caller's salon — a foreign record yields
    // an empty result and is reported as 404 (no existence disclosure).
    const [photo] = await db
      .select()
      .from(galleryPhotos)
      .where(and(eq(galleryPhotos.id, id), eq(galleryPhotos.salonId, salonId)));

    if (!photo) {
      return NextResponse.json(
        { success: false, error: "Photo not found" },
        { status: 404 }
      );
    }

    // Authorization within the caller's own salon:
    // Owners can edit any photo in their salon
    // Non-owners (employees) can only edit photos assigned to their employee profile
    const userRole = (session.user as Record<string, unknown>).role as string | undefined;
    const isOwner = userRole === "owner" || userRole === "admin";

    if (!isOwner) {
      // Check if user is an employee linked to this photo
      const [employeeRecord] = await db
        .select()
        .from(employees)
        .where(
          and(
            eq(employees.userId, session.user.id),
            eq(employees.salonId, photo.salonId)
          )
        );

      if (!employeeRecord) {
        return NextResponse.json(
          { success: false, error: "You do not have permission to edit this photo" },
          { status: 403 }
        );
      }

      // Employee can only edit their own photos
      if (photo.employeeId !== employeeRecord.id) {
        return NextResponse.json(
          { success: false, error: "You can only edit your own photos" },
          { status: 403 }
        );
      }
    }

    const body = await request.json();
    const validationError = validateBody(updateGalleryPhotoSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const {
      description,
      techniques,
      productsUsed,
      employeeId,
      serviceId,
      duration,
      beforePhotoUrl,
      afterPhotoUrl,
    } = body;

    // Build update object - only include fields that were sent
    const updateData: Record<string, unknown> = {};
    if (description !== undefined) updateData.description = description || null;
    if (techniques !== undefined) updateData.techniques = techniques || null;
    if (productsUsed !== undefined) updateData.productsUsed = productsUsed || null;
    if (employeeId !== undefined) updateData.employeeId = employeeId || null;
    if (serviceId !== undefined) updateData.serviceId = serviceId || null;
    if (duration !== undefined)
      updateData.duration = duration ? parseInt(String(duration), 10) : null;
    if (beforePhotoUrl !== undefined) updateData.beforePhotoUrl = beforePhotoUrl || null;
    if (afterPhotoUrl !== undefined) updateData.afterPhotoUrl = afterPhotoUrl || null;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      );
    }

    await db
      .update(galleryPhotos)
      .set(updateData)
      .where(and(eq(galleryPhotos.id, id), eq(galleryPhotos.salonId, salonId)))
      .returning();

    // Fetch with joins for the response
    const [fullPhoto] = await db
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
      .where(and(eq(galleryPhotos.id, id), eq(galleryPhotos.salonId, salonId)));

    logger.info(`[Gallery API] Updated photo: ${id}`);

    return NextResponse.json({
      success: true,
      data: fullPhoto,
    });
  } catch (error) {
    logger.error("[Gallery API] Error updating photo", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to update photo" },
      { status: 500 }
    );
  }
}

// DELETE /api/gallery/[id] - Delete a gallery photo
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Auth check - get current session
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    // Tenant isolation (P0-A): resolve the salon from the session, never from
    // the URL. A foreign-salon photo must be invisible (404) so a salon-A owner
    // can never delete a salon-B photo — and the file unlink below stays behind
    // this ownership gate.
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Photo not found" },
        { status: 404 }
      );
    }

    // Get photo scoped to the caller's salon (also yields the file path).
    const [photo] = await db
      .select()
      .from(galleryPhotos)
      .where(and(eq(galleryPhotos.id, id), eq(galleryPhotos.salonId, salonId)));

    if (!photo) {
      return NextResponse.json(
        { success: false, error: "Photo not found" },
        { status: 404 }
      );
    }

    // Authorization within the caller's own salon:
    // Owners can delete any photo in their salon
    // Non-owners (employees) can only delete photos assigned to their employee profile
    const userRole = (session.user as Record<string, unknown>).role as string | undefined;
    const isOwner = userRole === "owner" || userRole === "admin";

    if (!isOwner) {
      // Check if user is an employee linked to this photo
      const [employeeRecord] = await db
        .select()
        .from(employees)
        .where(
          and(
            eq(employees.userId, session.user.id),
            eq(employees.salonId, photo.salonId)
          )
        );

      if (!employeeRecord) {
        return NextResponse.json(
          { success: false, error: "You do not have permission to delete this photo" },
          { status: 403 }
        );
      }

      // Employee can only delete their own photos
      if (photo.employeeId !== employeeRecord.id) {
        return NextResponse.json(
          { success: false, error: "You can only delete your own photos" },
          { status: 403 }
        );
      }
    }

    // Delete from database (scoped to the caller's salon — defense in depth)
    await db
      .delete(galleryPhotos)
      .where(and(eq(galleryPhotos.id, id), eq(galleryPhotos.salonId, salonId)));

    // Try to delete files from disk (non-critical)
    const photoUrls = [photo.beforePhotoUrl, photo.afterPhotoUrl].filter(Boolean);
    for (const url of photoUrls) {
      if (url && url.startsWith("/uploads/")) {
        try {
          const filePath = path.join(process.cwd(), "public", url);
          await unlink(filePath);
          // Also try to delete thumbnail
          const thumbPath = filePath.replace("/gallery/", "/gallery/thumbs/");
          await unlink(thumbPath).catch(() => {});
        } catch {
          // File might not exist, that's ok
        }
      }
    }

    logger.info(`[Gallery API] Deleted photo: ${id}`);

    return NextResponse.json({
      success: true,
      message: "Photo deleted successfully",
    });
  } catch (error) {
    logger.error("[Gallery API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to delete photo" },
      { status: 500 }
    );
  }
}
