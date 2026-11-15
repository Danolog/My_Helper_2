import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { validateBody, updateGalleryPhotoSchema } from "@/lib/api-validation";
import { auth } from "@/lib/auth";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { deleteGalleryFiles, hasGalleryUrlConflict } from "@/lib/gallery-files";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { getSalonContext } from "@/lib/salon-context";
import { assertSalonRefs } from "@/lib/salon-refs";
import { galleryPhotos, employees, services } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

type RouteParams = { params: Promise<{ id: string }> };

const GALLERY_URL_IN_USE_ERROR = "Ten plik zdjecia jest juz uzyty w innym wpisie galerii";

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

    // Join — przez raw(tx) z jawnym eq(salonId); cudze zdjecie = pusty wynik = 404.
    const [photo] = await forSalon(salonId).raw((tx) =>
      tx
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
          showProductsToClients: galleryPhotos.showProductsToClients,
          createdAt: galleryPhotos.createdAt,
          employeeFirstName: employees.firstName,
          employeeLastName: employees.lastName,
          serviceName: services.name,
        })
        .from(galleryPhotos)
        .leftJoin(employees, eq(galleryPhotos.employeeId, employees.id))
        .leftJoin(services, eq(galleryPhotos.serviceId, services.id))
        .where(and(eq(galleryPhotos.id, id), eq(galleryPhotos.salonId, salonId)))
    );

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
    // Role comes from the salon context (salons.ownerId / employees.role),
    // never from user.role.
    const ctx = await getSalonContext();
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "Photo not found" },
        { status: 404 }
      );
    }

    const salonId = ctx.salonId;
    const repo = forSalon(salonId);

    // Get the photo scoped to the caller's salon — a foreign record yields
    // an empty result and is reported as 404 (no existence disclosure).
    const photo = await repo.findOne(galleryPhotos, id);

    if (!photo) {
      return NextResponse.json(
        { success: false, error: "Photo not found" },
        { status: 404 }
      );
    }

    // Authorization within the caller's own salon:
    // Owners can edit any photo in their salon
    // Non-owners (employees) can only edit photos assigned to their employee profile
    // Owner = salons.ownerId (ctx.role "owner"); staff = active linked
    // employee of THIS salon (ctx.employeeId from the salon context).
    if (ctx.role !== "owner") {
      if (!ctx.employeeId) {
        return NextResponse.json(
          { success: false, error: "You do not have permission to edit this photo" },
          { status: 403 }
        );
      }

      // Employee can only edit their own photos
      if (photo.employeeId !== ctx.employeeId) {
        return NextResponse.json(
          { success: false, error: "You can only edit your own photos" },
          { status: 403 }
        );
      }
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    // Schemat .strict() (kontrakt z UI) z allowlistą adresów zdjęć. Dalej
    // używamy WYŁĄCZNIE sparsowanych wartości — nigdy surowego body.
    const validationError = validateBody(updateGalleryPhotoSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const data = updateGalleryPhotoSchema.parse(body);

    // Pracownik nie przepina zdjęcia na kogoś innego (trafiłoby do cudzego
    // portfolio, a on sam traciłby do niego dostęp).
    if (
      ctx.role !== "owner" &&
      data.employeeId !== undefined &&
      data.employeeId !== ctx.employeeId
    ) {
      return NextResponse.json(
        { success: false, error: "You can only assign photos to yourself" },
        { status: 403 }
      );
    }

    // Pracownik i usługa muszą należeć do salonu z sesji (jak w POST).
    const refsError = await assertSalonRefs(salonId, {
      employeeId: data.employeeId,
      serviceId: data.serviceId,
    });
    if (refsError) return refsError;

    // Build update object - only include fields that were sent
    const updateData: Partial<typeof galleryPhotos.$inferInsert> = {};
    if (data.description !== undefined) updateData.description = data.description || null;
    if (data.techniques !== undefined) updateData.techniques = data.techniques || null;
    if (data.productsUsed !== undefined) updateData.productsUsed = data.productsUsed || null;
    if (data.employeeId !== undefined) updateData.employeeId = data.employeeId;
    if (data.serviceId !== undefined) updateData.serviceId = data.serviceId;
    if (data.duration !== undefined) updateData.duration = data.duration;
    if (data.showProductsToClients !== undefined)
      updateData.showProductsToClients = data.showProductsToClients;
    if (data.beforePhotoUrl !== undefined) updateData.beforePhotoUrl = data.beforePhotoUrl || null;
    if (data.afterPhotoUrl !== undefined) updateData.afterPhotoUrl = data.afterPhotoUrl || null;

    // Jak w POST: zmiana adresów nie może zostawić wpisu bez żadnego zdjęcia.
    const touchesPhotos =
      updateData.beforePhotoUrl !== undefined || updateData.afterPhotoUrl !== undefined;
    const nextBefore =
      updateData.beforePhotoUrl !== undefined ? updateData.beforePhotoUrl : photo.beforePhotoUrl;
    const nextAfter =
      updateData.afterPhotoUrl !== undefined ? updateData.afterPhotoUrl : photo.afterPhotoUrl;
    if (touchesPhotos && !nextBefore && !nextAfter) {
      return NextResponse.json(
        { success: false, error: "Wymagane co najmniej jedno zdjecie (przed lub po)" },
        { status: 400 }
      );
    }

    // Plik przypięty już do innego wpisu tego salonu — DELETE jednego
    // kasowałby zdjęcie drugiego. Zapytanie w kontekście salonu (RLS).
    if (
      touchesPhotos &&
      (await repo.raw((tx) =>
        hasGalleryUrlConflict(tx, salonId, [updateData.beforePhotoUrl, updateData.afterPhotoUrl], id)
      ))
    ) {
      return NextResponse.json(
        { success: false, error: GALLERY_URL_IN_USE_ERROR },
        { status: 400 }
      );
    }

    await repo.updateOwned(galleryPhotos, id, updateData);

    // Fetch with joins for the response (raw(tx) + jawny eq(salonId)).
    const [fullPhoto] = await repo.raw((tx) =>
      tx
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
          showProductsToClients: galleryPhotos.showProductsToClients,
          createdAt: galleryPhotos.createdAt,
          employeeFirstName: employees.firstName,
          employeeLastName: employees.lastName,
          serviceName: services.name,
        })
        .from(galleryPhotos)
        .leftJoin(employees, eq(galleryPhotos.employeeId, employees.id))
        .leftJoin(services, eq(galleryPhotos.serviceId, services.id))
        .where(and(eq(galleryPhotos.id, id), eq(galleryPhotos.salonId, salonId)))
    );

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
    // this ownership gate. Role from the salon context, never from user.role.
    const ctx = await getSalonContext();
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "Photo not found" },
        { status: 404 }
      );
    }

    const salonId = ctx.salonId;
    const repo = forSalon(salonId);

    // Get photo scoped to the caller's salon (also yields the file path).
    const photo = await repo.findOne(galleryPhotos, id);

    if (!photo) {
      return NextResponse.json(
        { success: false, error: "Photo not found" },
        { status: 404 }
      );
    }

    // Authorization within the caller's own salon:
    // Owners can delete any photo in their salon
    // Non-owners (employees) can only delete photos assigned to their employee profile
    // Owner = salons.ownerId (ctx.role "owner"); staff = active linked
    // employee of THIS salon (ctx.employeeId from the salon context).
    if (ctx.role !== "owner") {
      if (!ctx.employeeId) {
        return NextResponse.json(
          { success: false, error: "You do not have permission to delete this photo" },
          { status: 403 }
        );
      }

      // Employee can only delete their own photos
      if (photo.employeeId !== ctx.employeeId) {
        return NextResponse.json(
          { success: false, error: "You can only delete your own photos" },
          { status: 403 }
        );
      }
    }

    // Delete from database (scoped to the caller's salon — defense in depth)
    await repo.deleteOwned(galleryPhotos, id);

    // Pliki PO usunięciu wiersza: błąd storage'u nie blokuje usunięcia wpisu
    // (idzie do logu). Lokalnie kasujemy tylko pliki pod public/uploads/gallery/
    // (traversal pomijany). Blob nie jest kasowany — plik nie jest powiązany
    // z salonem, więc del() mógłby trafić w cudzy plik (lib/gallery-files).
    await deleteGalleryFiles(id, [photo.beforePhotoUrl, photo.afterPhotoUrl]);

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
