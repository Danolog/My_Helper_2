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
} from "@/lib/schema";
import { eq, and, gte, lte, sql, desc, asc } from "drizzle-orm";
import { isProPlan } from "@/lib/subscription";
import { getUserSalonId } from "@/lib/get-user-salon";

interface DailyRecommendation {
  id: string;
  type: "schedule" | "client" | "preparation" | "opportunity" | "warning";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  timeSlot?: string;
  actionLabel?: string;
  actionHref?: string;
}

interface TomorrowSummary {
  date: string;
  dayOfWeek: string;
  totalAppointments: number;
  totalRevenue: number;
  employeesWorking: number;
  employeesOff: number;
  firstAppointment: string | null;
  lastAppointment: string | null;
  freeSlots: number;
}

export async function GET(_request: Request) {
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
    // Calculate tomorrow's date range
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStart = new Date(
      tomorrow.getFullYear(),
      tomorrow.getMonth(),
      tomorrow.getDate(),
      0,
      0,
      0
    );
    const tomorrowEnd = new Date(
      tomorrow.getFullYear(),
      tomorrow.getMonth(),
      tomorrow.getDate(),
      23,
      59,
      59
    );

    const dayNames = [
      "Niedziela",
      "Poniedzialek",
      "Wtorek",
      "Sroda",
      "Czwartek",
      "Piatek",
      "Sobota",
    ];
    const tomorrowDayOfWeek = tomorrowStart.getDay(); // 0=Sunday
    const tomorrowDayName = dayNames[tomorrowDayOfWeek]!;

    // Gather all data in parallel
    const [
      tomorrowAppointments,
      allEmployees,
      tomorrowTimeBlocks,
      tomorrowWorkSchedules,
      lowStockProducts,
      recentClientHistory,
    ] = await Promise.all([
      // Tomorrow's appointments with full details
      db
        .select({
          appointmentId: appointments.id,
          startTime: appointments.startTime,
          endTime: appointments.endTime,
          status: appointments.status,
          notes: appointments.notes,
          clientId: appointments.clientId,
          clientFirstName: clients.firstName,
          clientLastName: clients.lastName,
          clientPhone: clients.phone,
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
            gte(appointments.startTime, tomorrowStart),
            lte(appointments.startTime, tomorrowEnd),
            sql`${appointments.status} NOT IN ('cancelled', 'no_show')`
          )
        )
        .orderBy(asc(appointments.startTime)),

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

      // Time blocks tomorrow (vacations, breaks)
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
            lte(timeBlocks.startTime, tomorrowEnd),
            gte(timeBlocks.endTime, tomorrowStart)
          )
        ),

      // Work schedules for tomorrow's day of week
      db
        .select({
          employeeId: workSchedules.employeeId,
          startTime: workSchedules.startTime,
          endTime: workSchedules.endTime,
        })
        .from(workSchedules)
        .innerJoin(employees, eq(workSchedules.employeeId, employees.id))
        .where(
          and(
            eq(employees.salonId, salonId),
            eq(workSchedules.dayOfWeek, tomorrowDayOfWeek)
          )
        ),

      // Low stock products that may be needed tomorrow
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

      // Recent reviews from clients who have appointments tomorrow
      db
        .select({
          clientId: reviews.clientId,
          rating: reviews.rating,
          comment: reviews.comment,
          createdAt: reviews.createdAt,
        })
        .from(reviews)
        .where(
          and(
            eq(reviews.salonId, salonId),
            sql`${reviews.rating} IS NOT NULL`
          )
        )
        .orderBy(desc(reviews.createdAt))
        .limit(50),
    ]);

    // Process data and generate recommendations
    const recommendations: DailyRecommendation[] = [];

    // Calculate summary
    const totalRevenue = tomorrowAppointments.reduce((sum, apt) => {
      return sum + (apt.servicePrice ? parseFloat(apt.servicePrice) : 0);
    }, 0);

    // Determine who's working tomorrow
    const scheduledEmployeeIds = new Set(
      tomorrowWorkSchedules.map((ws) => ws.employeeId)
    );
    // Employees on vacation/time off
    const offEmployeeIds = new Set(
      tomorrowTimeBlocks
        .filter(
          (tb) =>
            tb.blockType === "vacation" ||
            tb.blockType === "personal"
        )
        .map((tb) => tb.employeeId)
    );

    const employeesWorking = allEmployees.filter(
      (emp) => scheduledEmployeeIds.has(emp.id) && !offEmployeeIds.has(emp.id)
    );
    const employeesOff = allEmployees.filter(
      (emp) => offEmployeeIds.has(emp.id) || !scheduledEmployeeIds.has(emp.id)
    );

    // First and last appointments
    const firstApt =
      tomorrowAppointments.length > 0 ? tomorrowAppointments[0] : null;
    const lastApt =
      tomorrowAppointments.length > 0
        ? tomorrowAppointments[tomorrowAppointments.length - 1]
        : null;

    const formatTime = (date: Date) => {
      return date.toLocaleTimeString("pl-PL", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Warsaw",
      });
    };

    const summary: TomorrowSummary = {
      date: tomorrowStart.toLocaleDateString("pl-PL", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      dayOfWeek: tomorrowDayName,
      totalAppointments: tomorrowAppointments.length,
      totalRevenue,
      employeesWorking: employeesWorking.length,
      employeesOff: employeesOff.length,
      firstAppointment: firstApt ? formatTime(firstApt.startTime) : null,
      lastAppointment: lastApt ? formatTime(lastApt.endTime) : null,
      freeSlots: 0, // Calculated below
    };

    // ─── Recommendation #1: Schedule overview ───
    if (tomorrowAppointments.length === 0) {
      recommendations.push({
        id: "empty-schedule",
        type: "warning",
        priority: "high",
        title: "Brak zaplanowanych wizyt na jutro",
        description: `Na ${tomorrowDayName.toLowerCase()} (${summary.date}) nie ma jeszcze zadnych zarezerwowanych wizyt. Rozważ kontakt z klientami lub uruchomienie promocji last-minute, aby wypelnic grafik.`,
        actionLabel: "Otworz kalendarz",
        actionHref: "/dashboard/calendar",
      });
    } else {
      recommendations.push({
        id: "schedule-overview",
        type: "schedule",
        priority: "low",
        title: `${tomorrowAppointments.length} ${tomorrowAppointments.length === 1 ? "wizyta" : tomorrowAppointments.length < 5 ? "wizyty" : "wizyt"} zaplanowanych na jutro`,
        description: `Na ${tomorrowDayName.toLowerCase()} (${summary.date}) zaplanowano ${tomorrowAppointments.length} wizyt z szacowanym przychodem ${totalRevenue.toFixed(0)} PLN. ${firstApt ? `Pierwsza wizyta o ${formatTime(firstApt.startTime)}, ostatnia konczy sie o ${formatTime(lastApt!.endTime)}.` : ""}`,
        actionLabel: "Zobacz kalendarz",
        actionHref: "/dashboard/calendar",
      });
    }

    // ─── Recommendation #2: Employee availability ───
    if (offEmployeeIds.size > 0) {
      const offEmployeeNames = tomorrowTimeBlocks
        .filter(
          (tb) =>
            tb.blockType === "vacation" || tb.blockType === "personal"
        )
        .map(
          (tb) =>
            `${tb.employeeFirstName} ${tb.employeeLastName} (${tb.reason || tb.blockType})`
        );

      const uniqueOffNames = [...new Set(offEmployeeNames)];

      recommendations.push({
        id: "employee-availability",
        type: "warning",
        priority: "high",
        title: `${uniqueOffNames.length} ${uniqueOffNames.length === 1 ? "pracownik nieobecny" : "pracownikow nieobecnych"} jutro`,
        description: `Nieobecni: ${uniqueOffNames.join(", ")}. Upewnij sie, ze ich wizyty zostaly przeniescione lub ze inni pracownicy moga ich zastapic.`,
        actionLabel: "Grafik pracownikow",
        actionHref: "/dashboard/employees",
      });
    }

    // ─── Recommendation #3: Workload distribution ───
    if (tomorrowAppointments.length > 0) {
      const appointmentsByEmployee: Record<
        string,
        { name: string; count: number }
      > = {};
      for (const apt of tomorrowAppointments) {
        const key = apt.employeeId;
        if (!appointmentsByEmployee[key]) {
          appointmentsByEmployee[key] = {
            name: `${apt.employeeFirstName} ${apt.employeeLastName}`,
            count: 0,
          };
        }
        appointmentsByEmployee[key].count++;
      }

      const empEntries = Object.values(appointmentsByEmployee);
      if (empEntries.length >= 2) {
        const maxLoad = Math.max(...empEntries.map((e) => e.count));
        const minLoad = Math.min(...empEntries.map((e) => e.count));

        if (maxLoad > 0 && minLoad >= 0 && maxLoad - minLoad >= 3) {
          const busiest = empEntries.find((e) => e.count === maxLoad);
          const leastBusy = empEntries.find((e) => e.count === minLoad);

          recommendations.push({
            id: "workload-balance",
            type: "opportunity",
            priority: "medium",
            title: "Nierowny rozklad wizyt jutro",
            description: `${busiest?.name} ma ${maxLoad} wizyt, a ${leastBusy?.name} tylko ${minLoad}. Rozważ przekierowanie nowych rezerwacji do mniej obciazonego pracownika.`,
            actionLabel: "Otworz kalendarz",
            actionHref: "/dashboard/calendar",
          });
        }
      }
    }

    // ─── Recommendation #4: Time gaps detection ───
    if (tomorrowAppointments.length >= 2) {
      const aptsByEmployee: Record<
        string,
        { name: string; apts: typeof tomorrowAppointments }
      > = {};
      for (const apt of tomorrowAppointments) {
        const key = apt.employeeId;
        if (!aptsByEmployee[key]) {
          aptsByEmployee[key] = {
            name: `${apt.employeeFirstName} ${apt.employeeLastName}`,
            apts: [],
          };
        }
        aptsByEmployee[key].apts.push(apt);
      }

      let totalGapMinutes = 0;
      let gapCount = 0;

      for (const empData of Object.values(aptsByEmployee)) {
        const sortedApts = empData.apts.sort(
          (a, b) => a.startTime.getTime() - b.startTime.getTime()
        );
        for (let i = 0; i < sortedApts.length - 1; i++) {
          const gapMs =
            sortedApts[i + 1]!.startTime.getTime() -
            sortedApts[i]!.endTime.getTime();
          const gapMin = gapMs / 60000;
          if (gapMin >= 60) {
            totalGapMinutes += gapMin;
            gapCount++;
          }
        }
      }

      if (gapCount > 0) {
        const totalGapHours = Math.round(totalGapMinutes / 60);
        summary.freeSlots = gapCount;

        recommendations.push({
          id: "time-gaps",
          type: "opportunity",
          priority: "medium",
          title: `${gapCount} ${gapCount === 1 ? "wolne okno" : gapCount < 5 ? "wolne okna" : "wolnych okien"} w grafiku jutro`,
          description: `Wykryto ${gapCount} ${gapCount === 1 ? "przerwe" : "przerw"} miedzy wizytami (lącznie ok. ${totalGapHours}h). To dobry moment na przyjecie wizyt walk-in lub rezerwacji last-minute.`,
          actionLabel: "Dodaj wizyte",
          actionHref: "/dashboard/booking",
        });
      }
    }

    // ─── Recommendation #5: Low stock warning ───
    if (lowStockProducts.length > 0) {
      const productNames = lowStockProducts
        .slice(0, 3)
        .map((p) => `${p.name} (${p.quantity} ${p.unit || "szt."})`)
        .join(", ");

      recommendations.push({
        id: "low-stock-prep",
        type: "preparation",
        priority: lowStockProducts.length >= 3 ? "high" : "medium",
        title: "Uzupelnij magazyn przed jutrzejszymi wizytami",
        description: `${lowStockProducts.length} ${lowStockProducts.length === 1 ? "produkt ma" : "produktow ma"} niski stan: ${productNames}${lowStockProducts.length > 3 ? ` i ${lowStockProducts.length - 3} wiecej` : ""}. Upewnij sie, ze beda dostepne na jutro.`,
        actionLabel: "Przejdz do magazynu",
        actionHref: "/dashboard/products",
      });
    }

    // ─── Recommendation #6: VIP/returning client attention ───
    if (tomorrowAppointments.length > 0) {
      // Check for clients with reviews (loyal clients)
      const clientIdsWithReviews = new Set(
        recentClientHistory
          .filter((r) => r.clientId)
          .map((r) => r.clientId)
      );

      const returningClients = tomorrowAppointments.filter(
        (apt) =>
          apt.clientId && clientIdsWithReviews.has(apt.clientId)
      );

      // Check for clients with low ratings (need extra attention)
      const lowRatingClients = recentClientHistory
        .filter(
          (r) =>
            r.rating !== null &&
            r.rating <= 3 &&
            tomorrowAppointments.some((apt) => apt.clientId === r.clientId)
        );

      if (lowRatingClients.length > 0) {
        const affectedApts = tomorrowAppointments.filter((apt) =>
          lowRatingClients.some((r) => r.clientId === apt.clientId)
        );
        const clientNames = [
          ...new Set(
            affectedApts
              .filter((a) => a.clientFirstName)
              .map(
                (a) => `${a.clientFirstName} ${a.clientLastName}`
              )
          ),
        ].slice(0, 3);

        recommendations.push({
          id: "attention-clients",
          type: "client",
          priority: "high",
          title: "Klienci wymagajacy szczegolnej uwagi",
          description: `${clientNames.join(", ")} ${clientNames.length === 1 ? "wystawil(a)" : "wystawili"} wczesniej niska ocene. Poswiec im dodatkowa uwage jutro, aby poprawic ich doswiadczenie.`,
          actionLabel: "Zobacz opinie",
          actionHref: "/dashboard/reviews",
        });
      } else if (returningClients.length > 0) {
        const clientNames = [
          ...new Set(
            returningClients
              .filter((a) => a.clientFirstName)
              .map(
                (a) => `${a.clientFirstName} ${a.clientLastName}`
              )
          ),
        ].slice(0, 3);

        recommendations.push({
          id: "returning-clients",
          type: "client",
          priority: "low",
          title: `${returningClients.length} ${returningClients.length === 1 ? "powracajacy klient" : "powracajacych klientow"} jutro`,
          description: `Stali klienci: ${clientNames.join(", ")}${returningClients.length > 3 ? ` i ${returningClients.length - 3} wiecej` : ""}. Pamietaj o personalizacji obslugi!`,
          actionLabel: "Lista klientow",
          actionHref: "/dashboard/clients",
        });
      }
    }

    // ─── Recommendation #7: First appointment preparation ───
    if (firstApt) {
      const aptTime = formatTime(firstApt.startTime);
      const prepTime = new Date(firstApt.startTime);
      prepTime.setMinutes(prepTime.getMinutes() - 15);
      const prepTimeStr = formatTime(prepTime);

      recommendations.push({
        id: "first-appointment-prep",
        type: "preparation",
        priority: "medium",
        title: `Przygotuj salon do ${aptTime}`,
        description: `Pierwsza wizyta jutro o ${aptTime} (${firstApt.serviceName || "usluga"} dla ${firstApt.clientFirstName ? `${firstApt.clientFirstName} ${firstApt.clientLastName}` : "klienta walk-in"} z ${firstApt.employeeFirstName} ${firstApt.employeeLastName}). Zalecane otwarcie salonu o ${prepTimeStr} - 15 minut przed wizyta.`,
        timeSlot: aptTime,
      });
    }

    // ─── Recommendation #8: Peak hours analysis ───
    if (tomorrowAppointments.length >= 3) {
      const hourBuckets: Record<number, number> = {};
      for (const apt of tomorrowAppointments) {
        const hour = apt.startTime.getHours();
        hourBuckets[hour] = (hourBuckets[hour] || 0) + 1;
      }

      const peakHour = Object.entries(hourBuckets).reduce(
        (max, [hour, count]) =>
          count > max.count ? { hour: parseInt(hour), count } : max,
        { hour: 0, count: 0 }
      );

      if (peakHour.count >= 3) {
        recommendations.push({
          id: "peak-hour",
          type: "schedule",
          priority: "medium",
          title: `Szczyt wizyt o ${peakHour.hour}:00`,
          description: `O godzinie ${peakHour.hour}:00 zaplanowanych jest ${peakHour.count} wizyt jednoczesnie. Upewnij sie, ze wystarczy stanowisk i produktow na obsluge wszystkich klientow.`,
          timeSlot: `${peakHour.hour}:00`,
        });
      }
    }

    // ─── Recommendation #9: Unconfirmed appointments ───
    const unconfirmedApts = tomorrowAppointments.filter(
      (apt) => apt.status === "scheduled"
    );
    if (unconfirmedApts.length > 0) {
      const confirmedCount =
        tomorrowAppointments.length - unconfirmedApts.length;
      recommendations.push({
        id: "unconfirmed-appointments",
        type: "warning",
        priority: unconfirmedApts.length >= 3 ? "high" : "medium",
        title: `${unconfirmedApts.length} ${unconfirmedApts.length === 1 ? "wizyta niepotwierdzona" : "wizyt niepotwierdzonych"}`,
        description: `${unconfirmedApts.length} z ${tomorrowAppointments.length} jutrzejszych wizyt nie zostalo potwierdzonych (${confirmedCount} potwierdzonych). Rozważ wyslanie przypomnien SMS, aby zmniejszyc ryzyko no-show.`,
        actionLabel: "Konfiguruj powiadomienia",
        actionHref: "/dashboard/notifications",
      });
    }

    // Sort recommendations: high > medium > low priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    recommendations.sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
    );

    return NextResponse.json({
      success: true,
      summary,
      recommendations,
      generatedAt: now.toISOString(),
      tomorrowDate: tomorrowStart.toISOString(),
    });
  } catch (error) {
    console.error("[AI Daily Recommendations] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate daily recommendations" },
      { status: 500 }
    );
  }
}
