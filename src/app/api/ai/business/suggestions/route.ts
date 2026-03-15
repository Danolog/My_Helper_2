import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  appointments,
  clients,
  employees,
  services,
  reviews,
  products,
} from "@/lib/schema";
import { eq, and, gte, lte, sql, count, desc } from "drizzle-orm";
import { isProPlan } from "@/lib/subscription";
import { getUserSalonId } from "@/lib/get-user-salon";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

interface Suggestion {
  id: string;
  type: "warning" | "opportunity" | "action" | "insight";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  metric?: string;
  actionLabel?: string;
  actionHref?: string;
}

export async function GET(_request: Request) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  // Auth check and resolve salon
  const salonId = await getUserSalonId();
  if (!salonId) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  // Pro plan check
  const hasPro = await isProPlan();
  if (!hasPro) {
    return NextResponse.json(
      { error: "Funkcje AI sa dostepne tylko w Planie Pro." },
      { status: 403 }
    );
  }

  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    // Gather all data in parallel
    const [
      recentAppointments,
      previousAppointments,
      appointmentsByStatus,
      revenueData,
      previousRevenueData,
      lowStockProducts,
      avgRating,
      recentReviews,
      totalClients,
      _newClientsThisMonth,
      upcomingAppointments,
      topServices,
      underperformingEmployees,
      noAppointmentClients,
    ] = await Promise.all([
      // Recent appointments count (last 30 days)
      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, thirtyDaysAgo),
            lte(appointments.startTime, now)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Previous period appointments (30-60 days ago)
      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, sixtyDaysAgo),
            lte(appointments.startTime, thirtyDaysAgo)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Appointments by status (last 30 days)
      db
        .select({
          status: appointments.status,
          count: count(),
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, thirtyDaysAgo)
          )
        )
        .groupBy(appointments.status),

      // Revenue from completed appointments (last 30 days)
      db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(${services.basePrice} AS numeric)), 0)`,
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, salonId),
            eq(appointments.status, "completed"),
            gte(appointments.startTime, thirtyDaysAgo),
            lte(appointments.startTime, now)
          )
        )
        .then((r) => parseFloat(r[0]?.total ?? "0")),

      // Previous period revenue (30-60 days ago)
      db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(${services.basePrice} AS numeric)), 0)`,
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, salonId),
            eq(appointments.status, "completed"),
            gte(appointments.startTime, sixtyDaysAgo),
            lte(appointments.startTime, thirtyDaysAgo)
          )
        )
        .then((r) => parseFloat(r[0]?.total ?? "0")),

      // Low stock products
      db
        .select({
          name: products.name,
          quantity: products.quantity,
          minQuantity: products.minQuantity,
          unit: products.unit,
        })
        .from(products)
        .where(
          and(
            eq(products.salonId, salonId),
            sql`CAST(${products.quantity} AS numeric) <= COALESCE(CAST(${products.minQuantity} AS numeric), 5)`
          )
        )
        .limit(10),

      // Average rating
      db
        .select({
          avg: sql<string>`COALESCE(AVG(${reviews.rating}), 0)`,
          count: count(),
        })
        .from(reviews)
        .where(
          and(
            eq(reviews.salonId, salonId),
            sql`${reviews.rating} IS NOT NULL`
          )
        )
        .then((r) => ({
          average: parseFloat(r[0]?.avg ?? "0"),
          totalReviews: r[0]?.count ?? 0,
        })),

      // Recent low reviews (1-3 stars, last 30 days)
      db
        .select({
          rating: reviews.rating,
          comment: reviews.comment,
          createdAt: reviews.createdAt,
        })
        .from(reviews)
        .where(
          and(
            eq(reviews.salonId, salonId),
            lte(reviews.rating, 3),
            gte(reviews.createdAt, thirtyDaysAgo)
          )
        )
        .orderBy(desc(reviews.createdAt))
        .limit(5),

      // Total clients
      db
        .select({ count: count() })
        .from(clients)
        .where(eq(clients.salonId, salonId))
        .then((r) => r[0]?.count ?? 0),

      // New clients this month
      db
        .select({ count: count() })
        .from(clients)
        .where(
          and(
            eq(clients.salonId, salonId),
            gte(
              clients.createdAt,
              new Date(now.getFullYear(), now.getMonth(), 1)
            )
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Upcoming appointments (next 7 days)
      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, now),
            lte(appointments.startTime, sevenDaysFromNow),
            sql`${appointments.status} NOT IN ('cancelled', 'no_show')`
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Top services by count (last 30 days)
      db
        .select({
          serviceName: services.name,
          count: count(),
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, thirtyDaysAgo),
            sql`${appointments.status} NOT IN ('cancelled', 'no_show')`
          )
        )
        .groupBy(services.name)
        .orderBy(desc(count()))
        .limit(5),

      // Underperforming employees (less than average appointments)
      db
        .select({
          firstName: employees.firstName,
          lastName: employees.lastName,
          count: count(),
        })
        .from(appointments)
        .innerJoin(employees, eq(appointments.employeeId, employees.id))
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, thirtyDaysAgo),
            sql`${appointments.status} NOT IN ('cancelled', 'no_show')`
          )
        )
        .groupBy(employees.firstName, employees.lastName)
        .orderBy(count()),

      // Clients with no appointments in last 60 days
      db
        .select({ count: count() })
        .from(clients)
        .where(
          and(
            eq(clients.salonId, salonId),
            sql`${clients.id} NOT IN (
              SELECT DISTINCT ${appointments.clientId}
              FROM ${appointments}
              WHERE ${appointments.salonId} = ${salonId}
              AND ${appointments.startTime} >= ${sixtyDaysAgo.toISOString()}
              AND ${appointments.clientId} IS NOT NULL
            )`
          )
        )
        .then((r) => r[0]?.count ?? 0),
    ]);

    // Generate suggestions based on data analysis
    const suggestions: Suggestion[] = [];

    // 1. Cancellation rate analysis
    const statusMap: Record<string, number> = {};
    for (const s of appointmentsByStatus) {
      statusMap[s.status] = s.count;
    }
    const cancelledCount =
      (statusMap["cancelled"] ?? 0) + (statusMap["no_show"] ?? 0);
    const cancellationRate =
      recentAppointments > 0
        ? (cancelledCount / recentAppointments) * 100
        : 0;

    if (cancellationRate > 15) {
      suggestions.push({
        id: "high-cancellation",
        type: "warning",
        priority: "high",
        title: "Wysoki wskaznik anulacji",
        description: `Wskaznik anulacji wynosi ${cancellationRate.toFixed(1)}% (${cancelledCount} z ${recentAppointments} wizyt). Rozważ wprowadzenie systemu zadatków lub przypomnień SMS, aby zmniejszyć liczbę odwołanych wizyt.`,
        metric: `${cancellationRate.toFixed(1)}%`,
        actionLabel: "Zobacz raport anulacji",
        actionHref: "/dashboard/reports/cancellations",
      });
    } else if (cancellationRate > 10) {
      suggestions.push({
        id: "moderate-cancellation",
        type: "insight",
        priority: "medium",
        title: "Wskaznik anulacji do poprawy",
        description: `Wskaznik anulacji wynosi ${cancellationRate.toFixed(1)}%. Srednia branzowa to ok. 10%. Warto monitorowac ten wskaznik i rozwazyc przypomnienia SMS.`,
        metric: `${cancellationRate.toFixed(1)}%`,
        actionLabel: "Konfiguruj powiadomienia",
        actionHref: "/dashboard/notifications",
      });
    }

    // 2. Revenue trend
    if (previousRevenueData > 0) {
      const revenueGrowth =
        ((revenueData - previousRevenueData) / previousRevenueData) * 100;
      if (revenueGrowth < -10) {
        suggestions.push({
          id: "revenue-decline",
          type: "warning",
          priority: "high",
          title: "Spadek przychodow",
          description: `Przychody spadly o ${Math.abs(revenueGrowth).toFixed(1)}% w porownaniu z poprzednim okresem (${revenueData.toFixed(0)} PLN vs ${previousRevenueData.toFixed(0)} PLN). Rozważ wprowadzenie promocji lub rozszerzenie oferty usług.`,
          metric: `${revenueGrowth.toFixed(1)}%`,
          actionLabel: "Zobacz raport przychodow",
          actionHref: "/dashboard/reports",
        });
      } else if (revenueGrowth > 10) {
        suggestions.push({
          id: "revenue-growth",
          type: "insight",
          priority: "low",
          title: "Wzrost przychodow!",
          description: `Przychody wzrosly o ${revenueGrowth.toFixed(1)}% w porownaniu z poprzednim okresem (${revenueData.toFixed(0)} PLN vs ${previousRevenueData.toFixed(0)} PLN). Utrzymuj dobre wyniki!`,
          metric: `+${revenueGrowth.toFixed(1)}%`,
        });
      }
    }

    // 3. Appointment volume trend
    if (previousAppointments > 0) {
      const appointmentGrowth =
        ((recentAppointments - previousAppointments) / previousAppointments) *
        100;
      if (appointmentGrowth < -15) {
        suggestions.push({
          id: "appointment-decline",
          type: "warning",
          priority: "high",
          title: "Spadek liczby wizyt",
          description: `Liczba wizyt spadla o ${Math.abs(appointmentGrowth).toFixed(1)}% (${recentAppointments} vs ${previousAppointments}). Rozważ kampanię marketingową lub promocję dla nowych klientów.`,
          metric: `${appointmentGrowth.toFixed(1)}%`,
          actionLabel: "Dodaj promocje",
          actionHref: "/dashboard/promotions",
        });
      }
    }

    // 4. Low stock alerts
    if (lowStockProducts.length > 0) {
      const productNames = lowStockProducts
        .slice(0, 3)
        .map((p) => p.name)
        .join(", ");
      suggestions.push({
        id: "low-stock",
        type: "action",
        priority: lowStockProducts.length >= 3 ? "high" : "medium",
        title: "Niski stan magazynowy",
        description: `${lowStockProducts.length} ${lowStockProducts.length === 1 ? "produkt wymaga" : "produktow wymaga"} uzupelnienia: ${productNames}${lowStockProducts.length > 3 ? ` i ${lowStockProducts.length - 3} wiecej` : ""}.`,
        metric: `${lowStockProducts.length} produktow`,
        actionLabel: "Przejdz do magazynu",
        actionHref: "/dashboard/products",
      });
    }

    // 5. Review quality
    if (recentReviews.length > 0) {
      suggestions.push({
        id: "negative-reviews",
        type: "warning",
        priority: recentReviews.length >= 3 ? "high" : "medium",
        title: "Negatywne opinie klientow",
        description: `Otrzymano ${recentReviews.length} ${recentReviews.length === 1 ? "opinie" : "opinii"} z ocena 3 lub nizej w ostatnich 30 dniach. Przejrzyj je i odpowiedz na uwagi klientow.`,
        metric: `${recentReviews.length} opinii`,
        actionLabel: "Moderuj opinie",
        actionHref: "/dashboard/reviews",
      });
    }

    if (avgRating.average > 0 && avgRating.average < 4.0) {
      suggestions.push({
        id: "low-rating",
        type: "insight",
        priority: "medium",
        title: "Srednia ocena ponizej 4.0",
        description: `Srednia ocena salonu wynosi ${avgRating.average.toFixed(1)}/5.0. Dobry wynik branzowy to 4.5+. Rozważ wprowadzenie programu jakości usług.`,
        metric: `${avgRating.average.toFixed(1)}/5.0`,
      });
    }

    // 6. Inactive clients
    if (noAppointmentClients > 0 && totalClients > 0) {
      const inactivePercent = (noAppointmentClients / totalClients) * 100;
      if (inactivePercent > 30) {
        suggestions.push({
          id: "inactive-clients",
          type: "opportunity",
          priority: "medium",
          title: "Nieaktywni klienci",
          description: `${noAppointmentClients} klientow (${inactivePercent.toFixed(0)}%) nie mialo wizyty od 60 dni. Rozważ wysłanie im kampanii SMS lub emailowej z ofertą specjalną.`,
          metric: `${noAppointmentClients} klientow`,
          actionLabel: "Zobacz klientow",
          actionHref: "/dashboard/clients",
        });
      }
    }

    // 7. Low upcoming appointments
    if (upcomingAppointments < 5) {
      suggestions.push({
        id: "low-upcoming",
        type: "action",
        priority: "medium",
        title: "Malo wizyt na ten tydzien",
        description: `Na najblizsze 7 dni zaplanowanych jest tylko ${upcomingAppointments} wizyt. Rozważ kontakt z klientami lub uruchomienie promocji last-minute.`,
        metric: `${upcomingAppointments} wizyt`,
        actionLabel: "Otworz kalendarz",
        actionHref: "/dashboard/calendar",
      });
    }

    // 8. Top service opportunity
    const topService = topServices[0];
    if (topService && topService.count >= 5) {
      suggestions.push({
        id: "top-service",
        type: "opportunity",
        priority: "low",
        title: "Popularna usluga - szansa na wzrost",
        description: `Usluga "${topService.serviceName}" jest najpopularniejsza (${topService.count} wizyt w 30 dni). Rozważ wprowadzenie pakietów lub wariantów premium tej usługi.`,
        metric: `${topService.count} wizyt`,
        actionLabel: "Zarzadzaj uslugami",
        actionHref: "/dashboard/services",
      });
    }

    // 9. Employee workload balance
    if (underperformingEmployees.length >= 2) {
      const empCounts = underperformingEmployees.map((e) => e.count);
      const maxCount = Math.max(...empCounts);
      const minCount = Math.min(...empCounts);
      if (maxCount > 0 && minCount > 0 && maxCount / minCount > 2) {
        const busiest = underperformingEmployees.find(
          (e) => e.count === maxCount
        );
        const leastBusy = underperformingEmployees.find(
          (e) => e.count === minCount
        );
        if (busiest && leastBusy) {
          suggestions.push({
            id: "workload-imbalance",
            type: "insight",
            priority: "medium",
            title: "Nierowne obciazenie pracownikow",
            description: `${busiest.firstName} ${busiest.lastName} ma ${busiest.count} wizyt, a ${leastBusy.firstName} ${leastBusy.lastName} tylko ${leastBusy.count}. Rozważ równomierniejsze rozkładanie rezerwacji.`,
            metric: `${maxCount}:${minCount}`,
            actionLabel: "Grafik pracownikow",
            actionHref: "/dashboard/employees",
          });
        }
      }
    }

    // 10. No-show trend
    const noShowCount = statusMap["no_show"] ?? 0;
    if (noShowCount >= 3) {
      suggestions.push({
        id: "no-show-trend",
        type: "action",
        priority: "high",
        title: "Czeste niestawienia sie klientow",
        description: `${noShowCount} klientow nie stawilo sie na wizyty w ostatnich 30 dniach. Rozważ wprowadzenie obowiązkowych zadatków lub potwierdzania wizyt SMS.`,
        metric: `${noShowCount} no-show`,
        actionLabel: "Konfiguruj zadatki",
        actionHref: "/dashboard/settings/payments",
      });
    }

    // Sort by priority: high > medium > low
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
    );

    return NextResponse.json({
      success: true,
      suggestions,
      generatedAt: now.toISOString(),
      dataRange: {
        from: thirtyDaysAgo.toISOString(),
        to: now.toISOString(),
      },
    });
  } catch (error) {
    console.error("[AI Business Suggestions] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate suggestions" },
      { status: 500 }
    );
  }
}
