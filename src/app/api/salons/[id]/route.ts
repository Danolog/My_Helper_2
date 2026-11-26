import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { eq, and, avg, asc, inArray, count, sql } from "drizzle-orm";
import { validateBody, updateSalonSchema, isValidUuid } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { isDepositEnabled } from "@/lib/features";
import { logger } from "@/lib/logger";
import { salons, services, employees, reviews, serviceCategories, serviceVariants, employeeServices, galleryPhotos } from "@/lib/schema";
// GET (katalog, bez sesji) i PUT czytają przez forSalon(id z URL). Polityka RLS
// `salons` przepuszcza wiersz o id = kontekst, więc salon jest widoczny
// niezależnie od właściciela: PUT nadal rozróżnia 404 i 403. W katalogu RLS przy
// id z URL niczego nie chroni (kontekst ustawia wołający) — ochroną są jawne
// listy kolumn i jawne eq(salonId).
import { forSalon } from "@/lib/server/repository";


// Revalidate salon detail every 30 seconds
export const revalidate = 30;

const INVALID_SALON_ID_BODY = { success: false, error: "Invalid salon id" } as const;

/**
 * Odczyt katalogu salonu wołany przy chybieniu cache. Wszystkie zapytania w
 * jednej transakcji forSalon(id); transakcja zaczyna się i kończy tutaj, do
 * cache trafia wyłącznie zwrócone DTO. Bez try/catch: błąd bazy przechodzi
 * wyżej i nie jest zapisywany w cache.
 */
async function loadSalonDetail(id: string) {
  return forSalon(id).raw(async (tx) => {
    // Trasa PUBLICZNA (katalog) — WYŁĄCZNIE pola publiczne. Bez `settingsJson`
    // (konfig fiskalny/drukarka/loyalty) i `ownerId` — wyciek w nieautoryzowanej odpowiedzi.
    const salonColumns = {
      id: salons.id,
      name: salons.name,
      phone: salons.phone,
      email: salons.email,
      address: salons.address,
      industryType: salons.industryType,
      createdAt: salons.createdAt,
      updatedAt: salons.updatedAt,
    };

    const [salon] = await tx.select(salonColumns).from(salons).where(eq(salons.id, id));
    if (!salon) return null;

    // Get active services
    const serviceColumns = {
      id: services.id,
      salonId: services.salonId,
      categoryId: services.categoryId,
      name: services.name,
      description: services.description,
      basePrice: services.basePrice,
      baseDuration: services.baseDuration,
      suggestedNextVisitDays: services.suggestedNextVisitDays,
      depositRequired: services.depositRequired,
      depositPercentage: services.depositPercentage,
      isActive: services.isActive,
    };

    const salonServices = await tx
      .select(serviceColumns)
      .from(services)
      .where(and(eq(services.salonId, id), eq(services.isActive, true)));

    // Get service categories
    const categories = await tx
      .select({
        id: serviceCategories.id,
        salonId: serviceCategories.salonId,
        name: serviceCategories.name,
        sortOrder: serviceCategories.sortOrder,
      })
      .from(serviceCategories)
      .where(eq(serviceCategories.salonId, id))
      .orderBy(asc(serviceCategories.sortOrder));

    // Get variants for all active services (service_variants nie ma salon_id —
    // filtr po usługach przeczytanych wyżej z eq(salonId))
    const serviceIds = salonServices.map((s) => s.id);
    let variants: { id: string; serviceId: string; name: string; priceModifier: string | null; durationModifier: number | null }[] = [];
    if (serviceIds.length > 0) {
      variants = await tx
        .select({
          id: serviceVariants.id,
          serviceId: serviceVariants.serviceId,
          name: serviceVariants.name,
          priceModifier: serviceVariants.priceModifier,
          durationModifier: serviceVariants.durationModifier,
        })
        .from(serviceVariants)
        .where(inArray(serviceVariants.serviceId, serviceIds));
    }

    // Attach variants to each service
    const servicesWithVariants = salonServices.map((service) => ({
      ...service,
      categoryName: categories.find((c) => c.id === service.categoryId)?.name || null,
      variants: variants.filter((v) => v.serviceId === service.id),
    }));

    // Get active employees
    const salonEmployees = await tx
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        role: employees.role,
        photoUrl: employees.photoUrl,
        color: employees.color,
      })
      .from(employees)
      .where(and(eq(employees.salonId, id), eq(employees.isActive, true)));

    const employeeIds = salonEmployees.map((e) => e.id);

    // Get specialties
    const employeeServiceMap: Record<string, string[]> = {};
    if (employeeIds.length > 0) {
      const empServices = await tx
        .select({
          employeeId: employeeServices.employeeId,
          serviceName: services.name,
        })
        .from(employeeServices)
        .innerJoin(services, eq(employeeServices.serviceId, services.id))
        .where(
          and(
            inArray(employeeServices.employeeId, employeeIds),
            eq(services.salonId, id)
          )
        );

      for (const es of empServices) {
        if (!employeeServiceMap[es.employeeId]) {
          employeeServiceMap[es.employeeId] = [];
        }
        employeeServiceMap[es.employeeId]!.push(es.serviceName);
      }
    }

    // Get employee ratings
    const employeeRatingMap: Record<string, { avgRating: number; reviewCount: number }> = {};
    if (employeeIds.length > 0) {
      const empRatings = await tx
        .select({
          employeeId: reviews.employeeId,
          avgRating: avg(reviews.rating),
          reviewCount: count(reviews.id),
        })
        .from(reviews)
        .where(
          and(
            inArray(reviews.employeeId, employeeIds),
            eq(reviews.salonId, id),
            eq(reviews.status, "approved")
          )
        )
        .groupBy(reviews.employeeId);

      for (const er of empRatings) {
        if (er.employeeId) {
          employeeRatingMap[er.employeeId] = {
            avgRating: er.avgRating ? parseFloat(String(er.avgRating)) : 0,
            reviewCount: Number(er.reviewCount),
          };
        }
      }
    }

    // Get gallery photo counts per employee
    const employeeGalleryCountMap: Record<string, number> = {};
    if (employeeIds.length > 0) {
      const galleryCounts = await tx
        .select({
          employeeId: galleryPhotos.employeeId,
          photoCount: count(galleryPhotos.id),
        })
        .from(galleryPhotos)
        .where(
          and(
            eq(galleryPhotos.salonId, id),
            sql`${galleryPhotos.employeeId} IS NOT NULL`,
            inArray(galleryPhotos.employeeId, employeeIds)
          )
        )
        .groupBy(galleryPhotos.employeeId);

      for (const gc of galleryCounts) {
        if (gc.employeeId) {
          employeeGalleryCountMap[gc.employeeId] = Number(gc.photoCount);
        }
      }
    }

    // Enrich employees
    const enrichedEmployees = salonEmployees.map((emp) => ({
      id: emp.id,
      firstName: emp.firstName,
      lastName: emp.lastName,
      role: emp.role,
      photoUrl: emp.photoUrl,
      color: emp.color,
      specialties: employeeServiceMap[emp.id] || [],
      averageRating: employeeRatingMap[emp.id]?.avgRating || null,
      reviewCount: employeeRatingMap[emp.id]?.reviewCount || 0,
      galleryCount: employeeGalleryCountMap[emp.id] || 0,
    }));

    // Get average rating
    const [ratingResult] = await tx
      .select({ avgRating: avg(reviews.rating) })
      .from(reviews)
      .where(and(eq(reviews.salonId, id), eq(reviews.status, "approved")));

    return {
      ...salon,
      services: servicesWithVariants,
      categories,
      employees: enrichedEmployees,
      averageRating: ratingResult?.avgRating
        ? parseFloat(String(ratingResult.avgRating))
        : null,
    };
  });
}

/**
 * Cached salon detail query — avoids re-running 7+ DB queries on every request.
 * `id` jest ARGUMENTEM funkcji opakowanej, więc wchodzi do klucza cache — dwa
 * salony nigdy nie dzielą wpisu. Odświeżany co 30 s; tag "salon-detail" jest ustawiony, ale dziś żaden zapis go nie unieważnia (PUT też nie).
 */
const getCachedSalonDetail = unstable_cache(
  (id: string) => loadSalonDetail(id),
  ["salon-detail"],
  { revalidate: 30, tags: ["salon-detail"] }
);

// GET /api/salons/[id] - Get salon details with services, employees, and rating
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Format sprawdzany PRZED forSalon: polityka RLS rzutuje kontekst na
    // ::uuid — zły format dałby 500 z bazy zamiast 400.
    if (!isValidUuid(id)) {
      return NextResponse.json(INVALID_SALON_ID_BODY, { status: 400 });
    }
    const data = await getCachedSalonDetail(id);

    if (!data) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // Zadatek wyłączony (isDepositEnabled): flaga usługi zapisana wcześniej
    // nie trafia do portalu, więc portal ani stare PWA nie wchodzą w ścieżkę
    // płatności zadatku. Maskowanie po odczycie z cache — przełączenie flagi
    // działa od razu, także dla wpisów zapisanych w cache wcześniej.
    if (!isDepositEnabled()) {
      return NextResponse.json({
        success: true,
        data: {
          ...data,
          services: data.services.map((service) => ({ ...service, depositRequired: false })),
        },
      });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    logger.error("[Salon Detail API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch salon details" },
      { status: 500 }
    );
  }
}

// PUT /api/salons/[id] - Update salon basic data
const ALLOWED_INDUSTRY_TYPES = [
  "hair_salon",
  "beauty_salon",
  "nails",
  "barbershop",
  "spa",
  "medical",
];

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json(INVALID_SALON_ID_BODY, { status: 400 });
    }

    // Verify ownership. RLS `salons` po id = kontekst widzi salon niezależnie
    // od właściciela, więc brak wiersza = 404, cudzy właściciel = 403.
    const [salon] = await forSalon(id).raw((tx) =>
      tx
        .select({ id: salons.id, ownerId: salons.ownerId })
        .from(salons)
        .where(eq(salons.id, id))
    );

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Salon nie znaleziony" },
        { status: 404 }
      );
    }

    if (salon.ownerId !== authResult.user.id) {
      return NextResponse.json(
        { success: false, error: "Brak uprawnien" },
        { status: 403 }
      );
    }

    const body = await request.json();

    // Server-side validation with Zod schema
    const validationError = validateBody(updateSalonSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    // Sanitize validated fields
    const name = body.name.trim();
    const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 20) : null;
    const email = typeof body.email === "string" ? body.email.trim().slice(0, 100) : null;
    const address = typeof body.address === "string" ? body.address.trim().slice(0, 200) : null;
    const industryType =
      typeof body.industryType === "string" && ALLOWED_INDUSTRY_TYPES.includes(body.industryType)
        ? body.industryType
        : null;

    // Własność zweryfikowana wyżej — update przez forSalon (tabela salons nie ma
    // kolumny salonId, więc raw() z jawnym eq(salons.id, salonId); RLS tenant_self
    // przepuszcza wiersz o id = app.current_salon_id).
    const [updated] = await forSalon(id).raw((tx) =>
      tx
        .update(salons)
        .set({ name, phone, email, address, industryType })
        .where(eq(salons.id, id))
        .returning()
    );

    return NextResponse.json({
      success: true,
      message: "Dane salonu zaktualizowane",
      data: {
        id: updated!.id,
        name: updated!.name,
        phone: updated!.phone,
        email: updated!.email,
        address: updated!.address,
        industryType: updated!.industryType,
      },
    });
  } catch (error) {
    logger.error("[Salon Update API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie zaktualizowac danych salonu" },
      { status: 500 }
    );
  }
}
