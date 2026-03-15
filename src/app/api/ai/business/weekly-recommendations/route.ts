import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  appointments,
  clients,
  employees,
  services,
  timeBlocks,
  workSchedules,
  products,
  reviews,
  promotions,
} from "@/lib/schema";
import { eq, and, gte, lte, sql, count, desc, asc } from "drizzle-orm";
import { isProPlan } from "@/lib/subscription";
import { getUserSalonId } from "@/lib/get-user-salon";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

interface WeeklyRecommendation {
  id: string;
  type: "strategy" | "staffing" | "marketing" | "revenue" | "preparation" | "warning";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  dayOfWeek?: string;
  metric?: string;
  actionLabel?: string;
  actionHref?: string;
}

interface WeeklySummary {
  weekStart: string;
  weekEnd: string;
  totalAppointments: number;
  estimatedRevenue: number;
  busiestDay: string | null;
  busiestDayCount: number;
  quietestDay: string | null;
  quietestDayCount: number;
  employeesOnVacation: number;
  daysWithNoAppointments: number;
}

const DAY_NAMES = [
  "Niedziela",
  "Poniedzialek",
  "Wtorek",
  "Sroda",
  "Czwartek",
  "Piatek",
  "Sobota",
];

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

    // Calculate the upcoming 7 days (starting tomorrow)
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() + 1);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // Last 30 days for historical comparison
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Previous week for comparison
    const prevWeekStart = new Date(now);
    prevWeekStart.setDate(prevWeekStart.getDate() - 6);
    prevWeekStart.setHours(0, 0, 0, 0);

    // Gather all data in parallel
    const [
      weekAppointments,
      prevWeekAppointmentCount,
      weekTimeBlocks,
      _allEmployees,
      allWorkSchedules,
      lowStockProducts,
      avgRating,
      recentCancellations,
      recentRevenue,
      prevPeriodRevenue,
      topServicesLast30,
      activePromotions,
      totalClients,
      inactiveClients,
    ] = await Promise.all([
      // Appointments for the upcoming week with full details
      db
        .select({
          appointmentId: appointments.id,
          startTime: appointments.startTime,
          endTime: appointments.endTime,
          status: appointments.status,
          clientId: appointments.clientId,
          clientFirstName: clients.firstName,
          clientLastName: clients.lastName,
          employeeId: appointments.employeeId,
          employeeFirstName: employees.firstName,
          employeeLastName: employees.lastName,
          serviceName: services.name,
          servicePrice: services.basePrice,
          serviceDuration: services.baseDuration,
        })
        .from(appointments)
        .leftJoin(clients, eq(appointments.clientId, clients.id))
        .innerJoin(employees, eq(appointments.employeeId, employees.id))
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, weekStart),
            lte(appointments.startTime, weekEnd),
            sql`${appointments.status} NOT IN ('cancelled', 'no_show')`
          )
        )
        .orderBy(asc(appointments.startTime)),

      // Previous week appointment count for comparison
      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, prevWeekStart),
            lte(appointments.startTime, now),
            sql`${appointments.status} NOT IN ('cancelled', 'no_show')`
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Time blocks (vacations, breaks) for the upcoming week
      db
        .select({
          employeeId: timeBlocks.employeeId,
          startTime: timeBlocks.startTime,
          endTime: timeBlocks.endTime,
          blockType: timeBlocks.blockType,
          reason: timeBlocks.reason,
          employeeFirstName: employees.firstName,
          employeeLastName: employees.lastName,
        })
        .from(timeBlocks)
        .innerJoin(employees, eq(timeBlocks.employeeId, employees.id))
        .where(
          and(
            eq(employees.salonId, salonId),
            lte(timeBlocks.startTime, weekEnd),
            gte(timeBlocks.endTime, weekStart)
          )
        ),

      // All active employees
      db
        .select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(employees)
        .where(
          and(
            eq(employees.salonId, salonId),
            eq(employees.isActive, true)
          )
        ),

      // Work schedules for all days
      db
        .select({
          employeeId: workSchedules.employeeId,
          dayOfWeek: workSchedules.dayOfWeek,
          startTime: workSchedules.startTime,
          endTime: workSchedules.endTime,
        })
        .from(workSchedules)
        .innerJoin(employees, eq(workSchedules.employeeId, employees.id))
        .where(eq(employees.salonId, salonId)),

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

      // Cancellations last 30 days
      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, thirtyDaysAgo),
            sql`${appointments.status} IN ('cancelled', 'no_show')`
          )
        )
        .then((r) => r[0]?.count ?? 0),

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

      // Revenue from previous 30-day period (for trend)
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
            gte(
              appointments.startTime,
              new Date(thirtyDaysAgo.getTime() - 30 * 24 * 60 * 60 * 1000)
            ),
            lte(appointments.startTime, thirtyDaysAgo)
          )
        )
        .then((r) => parseFloat(r[0]?.total ?? "0")),

      // Top services last 30 days
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

      // Active promotions
      db
        .select({
          id: promotions.id,
          name: promotions.name,
          startDate: promotions.startDate,
          endDate: promotions.endDate,
        })
        .from(promotions)
        .where(
          and(
            eq(promotions.salonId, salonId),
            eq(promotions.isActive, true),
            sql`(${promotions.startDate} IS NULL OR ${promotions.startDate} <= ${weekEnd.toISOString()})`,
            sql`(${promotions.endDate} IS NULL OR ${promotions.endDate} >= ${weekStart.toISOString()})`
          )
        )
        .limit(5),

      // Total clients count
      db
        .select({ count: count() })
        .from(clients)
        .where(eq(clients.salonId, salonId))
        .then((r) => r[0]?.count ?? 0),

      // Inactive clients (no appointment in 60 days)
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
              AND ${appointments.startTime} >= ${new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString()}
              AND ${appointments.clientId} IS NOT NULL
            )`
          )
        )
        .then((r) => r[0]?.count ?? 0),
    ]);

    // ────────────────────────────────────────────────────────────
    // Analyze weekly data
    // ────────────────────────────────────────────────────────────

    // Group appointments by day of week
    const appointmentsByDay: Record<string, typeof weekAppointments> = {};
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(day.getDate() + i);
      const dayKey = day.toISOString().split("T")[0] as string;
      appointmentsByDay[dayKey] = [];
    }

    for (const apt of weekAppointments) {
      const dayKey = apt.startTime.toISOString().split("T")[0] as string;
      if (appointmentsByDay[dayKey]) {
        appointmentsByDay[dayKey]!.push(apt);
      }
    }

    // Calculate per-day stats
    const dayStats = Object.entries(appointmentsByDay).map(([dateStr, apts]) => {
      const date = new Date(dateStr + "T00:00:00");
      const dayOfWeek = date.getDay();
      const dayName = DAY_NAMES[dayOfWeek] ?? "Nieznany";
      const revenue = apts.reduce(
        (sum, apt) => sum + (apt.servicePrice ? parseFloat(apt.servicePrice) : 0),
        0
      );
      return {
        dateStr,
        dayName,
        dayOfWeek,
        appointmentCount: apts.length,
        revenue,
        appointments: apts,
      };
    });

    // Find busiest/quietest days
    const sortedByCount = [...dayStats].sort(
      (a, b) => b.appointmentCount - a.appointmentCount
    );
    const busiestDay = sortedByCount[0];
    const quietestDay = sortedByCount[sortedByCount.length - 1];

    // Calculate total estimated revenue
    const totalWeekRevenue = weekAppointments.reduce(
      (sum, apt) => sum + (apt.servicePrice ? parseFloat(apt.servicePrice) : 0),
      0
    );

    // Employees on vacation this week
    const vacationEmployeeIds = new Set(
      weekTimeBlocks
        .filter((tb) => tb.blockType === "vacation" || tb.blockType === "personal")
        .map((tb) => tb.employeeId)
    );

    // Days with zero appointments
    const emptyDays = dayStats.filter((d) => d.appointmentCount === 0);

    // Build summary
    const summary: WeeklySummary = {
      weekStart: weekStart.toLocaleDateString("pl-PL", {
        day: "numeric",
        month: "long",
      }),
      weekEnd: weekEnd.toLocaleDateString("pl-PL", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      totalAppointments: weekAppointments.length,
      estimatedRevenue: totalWeekRevenue,
      busiestDay: busiestDay && busiestDay.appointmentCount > 0 ? busiestDay.dayName : null,
      busiestDayCount: busiestDay ? busiestDay.appointmentCount : 0,
      quietestDay: quietestDay ? quietestDay.dayName : null,
      quietestDayCount: quietestDay ? quietestDay.appointmentCount : 0,
      employeesOnVacation: vacationEmployeeIds.size,
      daysWithNoAppointments: emptyDays.length,
    };

    // ────────────────────────────────────────────────────────────
    // Generate strategic weekly recommendations
    // ────────────────────────────────────────────────────────────
    const recommendations: WeeklyRecommendation[] = [];

    // 1. WEEK OVERVIEW - Appointment volume comparison
    const weekVolumeDiff = weekAppointments.length - prevWeekAppointmentCount;
    const weekVolumePct =
      prevWeekAppointmentCount > 0
        ? ((weekVolumeDiff / prevWeekAppointmentCount) * 100).toFixed(0)
        : "N/A";

    if (weekAppointments.length === 0) {
      recommendations.push({
        id: "empty-week",
        type: "warning",
        priority: "high",
        title: "Brak zaplanowanych wizyt na przyszly tydzien",
        description: `Na okres ${summary.weekStart} - ${summary.weekEnd} nie ma jeszcze zadnych rezerwacji. Pilnie uruchom kampanie marketingowa lub kontakt z klientami, aby wypelnic grafik.`,
        actionLabel: "Dodaj promocje",
        actionHref: "/dashboard/promotions",
      });
    } else {
      const trend =
        weekVolumeDiff > 0
          ? `o ${weekVolumeDiff} wiecej niz w ubieglym tygodniu (+${weekVolumePct}%)`
          : weekVolumeDiff < 0
          ? `o ${Math.abs(weekVolumeDiff)} mniej niz w ubieglym tygodniu (${weekVolumePct}%)`
          : "tyle samo co w ubieglym tygodniu";

      recommendations.push({
        id: "week-overview",
        type: "strategy",
        priority: weekVolumeDiff < -3 ? "high" : "low",
        title: `${weekAppointments.length} wizyt zaplanowanych na przyszly tydzien`,
        description: `Na okres ${summary.weekStart} - ${summary.weekEnd} zaplanowano ${weekAppointments.length} wizyt z szacowanym przychodem ${totalWeekRevenue.toFixed(0)} PLN - ${trend}. ${busiestDay && busiestDay.appointmentCount > 0 ? `Najintensywniejszy dzien: ${busiestDay.dayName} (${busiestDay.appointmentCount} wizyt).` : ""}`,
        metric: `${totalWeekRevenue.toFixed(0)} PLN`,
        actionLabel: "Otworz kalendarz",
        actionHref: "/dashboard/calendar",
      });
    }

    // 2. EMPTY DAYS - Opportunity to fill gaps
    if (emptyDays.length > 0 && emptyDays.length < 7) {
      // Check which of those days have employees scheduled
      const emptyDayNames = emptyDays
        .filter((d) => {
          // Check if any employee works that day
          return allWorkSchedules.some((ws) => ws.dayOfWeek === d.dayOfWeek);
        })
        .map((d) => d.dayName);

      if (emptyDayNames.length > 0) {
        recommendations.push({
          id: "empty-days",
          type: "marketing",
          priority: "high",
          title: `${emptyDayNames.length} ${emptyDayNames.length === 1 ? "dzien" : "dni"} bez wizyt w przyszlym tygodniu`,
          description: `${emptyDayNames.join(", ")} - brak zaplanowanych wizyt mimo dostepnych pracownikow. Rozważ promocje last-minute lub kontakt z klientami, ktorzy dawno nie odwiedzili salonu.`,
          metric: `${emptyDayNames.length} ${emptyDayNames.length === 1 ? "dzien" : "dni"}`,
          actionLabel: "Uruchom promocje",
          actionHref: "/dashboard/promotions",
        });
      }
    }

    // 3. STAFFING - Vacation/absence impact
    if (vacationEmployeeIds.size > 0) {
      const vacEmployeeNames = [
        ...new Set(
          weekTimeBlocks
            .filter(
              (tb) => tb.blockType === "vacation" || tb.blockType === "personal"
            )
            .map((tb) => `${tb.employeeFirstName} ${tb.employeeLastName}`)
        ),
      ];

      // Check if vacationing employees have appointments
      const conflictApts = weekAppointments.filter((apt) =>
        vacationEmployeeIds.has(apt.employeeId)
      );

      recommendations.push({
        id: "vacation-impact",
        type: "staffing",
        priority: conflictApts.length > 0 ? "high" : "medium",
        title: `${vacEmployeeNames.length} ${vacEmployeeNames.length === 1 ? "pracownik nieobecny" : "pracownikow nieobecnych"} w przyszlym tygodniu`,
        description: `Nieobecni: ${vacEmployeeNames.join(", ")}. ${conflictApts.length > 0 ? `UWAGA: ${conflictApts.length} wizyt jest przypisanych do nieobecnych pracownikow - wymagaja przeniescienia!` : "Upewnij sie, ze pozostali pracownicy moga obslużyc wszystkie wizyty."}`,
        ...(conflictApts.length > 0 ? { metric: `${conflictApts.length} konfliktow` } : {}),
        actionLabel: "Grafik pracownikow",
        actionHref: "/dashboard/employees",
      });
    }

    // 4. WORKLOAD BALANCE - Check if appointments are evenly distributed across the week
    const workDays = dayStats.filter((d) =>
      allWorkSchedules.some((ws) => ws.dayOfWeek === d.dayOfWeek)
    );
    if (workDays.length >= 3) {
      const avgPerDay =
        weekAppointments.length / workDays.length;
      const overloadedDays = workDays.filter(
        (d) => d.appointmentCount > avgPerDay * 1.5 && d.appointmentCount >= 5
      );
      const underloadedDays = workDays.filter(
        (d) => d.appointmentCount < avgPerDay * 0.5 && d.appointmentCount >= 0
      );

      if (overloadedDays.length > 0 && underloadedDays.length > 0) {
        recommendations.push({
          id: "workload-balance",
          type: "strategy",
          priority: "medium",
          title: "Nierowny rozklad wizyt w tygodniu",
          description: `${overloadedDays.map((d) => `${d.dayName} (${d.appointmentCount})`).join(", ")} ${overloadedDays.length === 1 ? "ma" : "maja"} duzo wiecej wizyt niz ${underloadedDays.map((d) => `${d.dayName} (${d.appointmentCount})`).join(", ")}. Rozważ oferowanie znizek w mniej popularne dni, aby wyrownac obciazenie.`,
          metric: `${busiestDay?.appointmentCount}:${quietestDay?.appointmentCount}`,
          actionLabel: "Dodaj promocje",
          actionHref: "/dashboard/promotions",
        });
      }
    }

    // 5. REVENUE STRATEGY - Weekly revenue projection vs trends
    if (prevPeriodRevenue > 0) {
      const revenueGrowth =
        ((recentRevenue - prevPeriodRevenue) / prevPeriodRevenue) * 100;

      if (revenueGrowth < -10) {
        recommendations.push({
          id: "revenue-strategy",
          type: "revenue",
          priority: "high",
          title: "Trend spadkowy przychodow - zaplanuj dzialania",
          description: `Przychody spadly o ${Math.abs(revenueGrowth).toFixed(0)}% w ostatnich 30 dniach (${recentRevenue.toFixed(0)} vs ${prevPeriodRevenue.toFixed(0)} PLN). W tym tygodniu zaplanuj: promocje na popularne uslugi, kampanie reaktywacyjne dla nieaktywnych klientow, lub pakiety uslug premium.`,
          metric: `${revenueGrowth.toFixed(0)}%`,
          actionLabel: "Zobacz raporty",
          actionHref: "/dashboard/reports",
        });
      } else if (revenueGrowth > 15) {
        recommendations.push({
          id: "revenue-momentum",
          type: "revenue",
          priority: "low",
          title: "Utrzymaj pozytywny trend przychodow",
          description: `Przychody wzrosly o ${revenueGrowth.toFixed(0)}% w ostatnim miesiącu. Wykorzystaj ten moment - rozważ wprowadzenie programu lojalnosciowego lub uslugi premium, aby utrzymac wzrost.`,
          metric: `+${revenueGrowth.toFixed(0)}%`,
          actionLabel: "Zarzadzaj uslugami",
          actionHref: "/dashboard/services",
        });
      }
    }

    // 6. CANCELLATION RISK - Based on recent cancellation rate
    if (recentCancellations > 0 && weekAppointments.length > 0) {
      // Calculate expected cancellations based on recent rate
      const recentTotal = recentCancellations + weekAppointments.length;
      const cancRate = (recentCancellations / recentTotal) * 100;
      const expectedCancels = Math.round(
        (cancRate / 100) * weekAppointments.length
      );

      if (expectedCancels >= 2) {
        recommendations.push({
          id: "cancellation-risk",
          type: "warning",
          priority: "medium",
          title: "Prognoza anulacji na ten tydzien",
          description: `Na podstawie wskaznika anulacji ${cancRate.toFixed(0)}% z ostatnich 30 dni, szacujemy ~${expectedCancels} anulacji w tym tygodniu. Rozważ wyslanie przypomnien SMS na 24h przed wizyta i wpro wadzenie obowiazkowych zadatkow.`,
          metric: `~${expectedCancels} prognoza`,
          actionLabel: "Konfiguruj przypomnienia",
          actionHref: "/dashboard/notifications",
        });
      }
    }

    // 7. INACTIVE CLIENTS - Reactivation opportunity
    if (inactiveClients > 0 && totalClients > 0) {
      const inactivePct = (inactiveClients / totalClients) * 100;
      if (inactivePct > 25) {
        recommendations.push({
          id: "client-reactivation",
          type: "marketing",
          priority: "medium",
          title: "Reaktywuj nieaktywnych klientow",
          description: `${inactiveClients} klientow (${inactivePct.toFixed(0)}%) nie odwiedzilo salonu od 60 dni. Zaplanuj w tym tygodniu kampanie SMS lub email z oferta specjalna "Wracamy do formy" - to moze wypelnic wolne terminy.`,
          metric: `${inactiveClients} klientow`,
          actionLabel: "Lista klientow",
          actionHref: "/dashboard/clients",
        });
      }
    }

    // 8. LOW STOCK - Prepare inventory for the week
    if (lowStockProducts.length > 0) {
      const productNames = lowStockProducts
        .slice(0, 3)
        .map((p) => `${p.name} (${p.quantity} ${p.unit || "szt."})`)
        .join(", ");

      recommendations.push({
        id: "inventory-prep",
        type: "preparation",
        priority: lowStockProducts.length >= 3 ? "high" : "medium",
        title: "Uzupelnij magazyn przed poczatkiem tygodnia",
        description: `${lowStockProducts.length} ${lowStockProducts.length === 1 ? "produkt ma" : "produktow ma"} niski stan: ${productNames}${lowStockProducts.length > 3 ? ` i ${lowStockProducts.length - 3} wiecej` : ""}. Zamow produkty teraz, aby uniknac problemow w trakcie tygodnia.`,
        metric: `${lowStockProducts.length} produktow`,
        actionLabel: "Przejdz do magazynu",
        actionHref: "/dashboard/products",
      });
    }

    // 9. TOP SERVICE FOCUS - Strategic suggestion based on popular services
    const topService = topServicesLast30[0];
    if (topService && topService.count >= 5) {
      const weekTopServiceApts = weekAppointments.filter(
        (a) => a.serviceName === topService.serviceName
      );

      recommendations.push({
        id: "service-strategy",
        type: "strategy",
        priority: "low",
        title: `Promuj najpopularniejsza usluge: ${topService.serviceName}`,
        description: `"${topService.serviceName}" to hit ostatnich 30 dni (${topService.count} rezerwacji). Na ten tydzien zaplanowano ${weekTopServiceApts.length} takich wizyt. Rozważ pakiet "tydzien ${topService.serviceName}" ze znizka lub dodanie wariantu premium.`,
        metric: `${topService.count} rez./mies.`,
        actionLabel: "Zarzadzaj uslugami",
        actionHref: "/dashboard/services",
      });
    }

    // 10. RATING STRATEGY - If rating is below target
    if (avgRating.totalReviews >= 5 && avgRating.average < 4.5) {
      recommendations.push({
        id: "rating-improvement",
        type: "strategy",
        priority: avgRating.average < 4.0 ? "high" : "low",
        title: "Plan poprawy opinii klientow",
        description: `Srednia ocena salonu wynosi ${avgRating.average.toFixed(1)}/5.0 (${avgRating.totalReviews} opinii). W tym tygodniu skup sie na: personalizacji obslugi, pytaniu zadowolonych klientow o opinie, i szybkim reagowaniu na uwagi.`,
        metric: `${avgRating.average.toFixed(1)}/5.0`,
        actionLabel: "Moderuj opinie",
        actionHref: "/dashboard/reviews",
      });
    }

    // 11. ACTIVE PROMOTIONS - Remind about running promotions
    if (activePromotions.length > 0) {
      const promoNames = activePromotions
        .slice(0, 3)
        .map((p) => p.name)
        .join(", ");

      recommendations.push({
        id: "active-promotions",
        type: "marketing",
        priority: "low",
        title: `${activePromotions.length} aktywnych promocji w tym tygodniu`,
        description: `Trwajace promocje: ${promoNames}${activePromotions.length > 3 ? ` i ${activePromotions.length - 3} wiecej` : ""}. Upewnij sie, ze pracownicy znaja warunki i informuja klientow o dostepnych ofertach.`,
        actionLabel: "Zarzadzaj promocjami",
        actionHref: "/dashboard/promotions",
      });
    }

    // Sort: high > medium > low priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    recommendations.sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
    );

    return NextResponse.json({
      success: true,
      summary,
      recommendations,
      dayBreakdown: dayStats.map((d) => ({
        date: d.dateStr,
        dayName: d.dayName,
        appointmentCount: d.appointmentCount,
        revenue: d.revenue,
      })),
      generatedAt: now.toISOString(),
      weekRange: {
        start: weekStart.toISOString(),
        end: weekEnd.toISOString(),
      },
    });
  } catch (error) {
    console.error("[AI Weekly Recommendations] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate weekly recommendations" },
      { status: 500 }
    );
  }
}
