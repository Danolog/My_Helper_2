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

import { logger } from "@/lib/logger";
/**
 * Severity levels for business alerts.
 * - critical: Requires immediate attention (severe drops, major issues)
 * - warning: Notable problem that should be addressed soon
 * - info: Informational trend to monitor
 */
type AlertSeverity = "critical" | "warning" | "info";

interface BusinessAlert {
  id: string;
  severity: AlertSeverity;
  category: string;
  title: string;
  problem: string;
  impact: string;
  suggestions: string[];
  metric: {
    label: string;
    current: number | string;
    previous: number | string;
    changePercent: number;
    unit: string;
  };
  actionHref?: string;
  actionLabel?: string;
}

function computeChangePercent(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100 * 10) / 10;
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
    const fourteenDaysAgo = new Date(now);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    // Gather all data in parallel for comprehensive problem detection
    const [
      // Appointments: current 30 days vs previous 30 days
      recentAppointmentCount,
      previousAppointmentCount,
      // Revenue: current 30 days vs previous 30 days
      recentRevenue,
      previousRevenue,
      // Recent week vs previous week appointments
      thisWeekAppointments,
      lastWeekAppointments,
      // Appointment statuses (for cancellation & no-show)
      appointmentsByStatus,
      // Previous period statuses (for cancellation rate comparison)
      previousAppointmentsByStatus,
      // Review quality
      recentLowReviews,
      avgRatingRecent,
      avgRatingPrevious,
      // Low stock products
      lowStockProducts,
      // Upcoming appointments (next 7 days)
      upcomingAppointments,
      // Inactive clients (no visit in 60 days)
      inactiveClientCount,
      totalClientCount,
      // Services declining in popularity
      servicesCurrent,
      servicesPrevious,
      // Employee workload
      employeeWorkload,
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

      // Previous 30-day period appointments
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

      // Revenue current 30 days
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

      // Revenue previous 30 days
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

      // This week appointments
      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, sevenDaysAgo),
            lte(appointments.startTime, now)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Last week appointments
      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, fourteenDaysAgo),
            lte(appointments.startTime, sevenDaysAgo)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Current period appointment statuses
      db
        .select({
          status: appointments.status,
          count: count(),
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, thirtyDaysAgo),
            lte(appointments.startTime, now)
          )
        )
        .groupBy(appointments.status),

      // Previous period appointment statuses
      db
        .select({
          status: appointments.status,
          count: count(),
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, sixtyDaysAgo),
            lte(appointments.startTime, thirtyDaysAgo)
          )
        )
        .groupBy(appointments.status),

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
        .limit(10),

      // Average rating last 30 days
      db
        .select({
          avg: sql<string>`COALESCE(AVG(${reviews.rating}), 0)`,
          count: count(),
        })
        .from(reviews)
        .where(
          and(
            eq(reviews.salonId, salonId),
            gte(reviews.createdAt, thirtyDaysAgo),
            sql`${reviews.rating} IS NOT NULL`
          )
        )
        .then((r) => ({
          average: parseFloat(r[0]?.avg ?? "0"),
          total: r[0]?.count ?? 0,
        })),

      // Average rating previous 30 days
      db
        .select({
          avg: sql<string>`COALESCE(AVG(${reviews.rating}), 0)`,
          count: count(),
        })
        .from(reviews)
        .where(
          and(
            eq(reviews.salonId, salonId),
            gte(reviews.createdAt, sixtyDaysAgo),
            lte(reviews.createdAt, thirtyDaysAgo),
            sql`${reviews.rating} IS NOT NULL`
          )
        )
        .then((r) => ({
          average: parseFloat(r[0]?.avg ?? "0"),
          total: r[0]?.count ?? 0,
        })),

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
              AND ${appointments.startTime} >= ${sixtyDaysAgo.toISOString()}
              AND ${appointments.clientId} IS NOT NULL
            )`
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Total clients
      db
        .select({ count: count() })
        .from(clients)
        .where(eq(clients.salonId, salonId))
        .then((r) => r[0]?.count ?? 0),

      // Service popularity current period
      db
        .select({
          serviceName: services.name,
          serviceId: services.id,
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
        .groupBy(services.name, services.id),

      // Service popularity previous period
      db
        .select({
          serviceName: services.name,
          serviceId: services.id,
          count: count(),
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, sixtyDaysAgo),
            lte(appointments.startTime, thirtyDaysAgo),
            sql`${appointments.status} NOT IN ('cancelled', 'no_show')`
          )
        )
        .groupBy(services.name, services.id),

      // Employee workload (appointments per employee)
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
    ]);

    // ── Generate alerts based on detected problems ──

    const alerts: BusinessAlert[] = [];

    // ─── 1. BOOKING DECLINE ALERT ───
    if (previousAppointmentCount > 0) {
      const bookingChange = computeChangePercent(
        recentAppointmentCount,
        previousAppointmentCount
      );
      if (bookingChange < -20) {
        alerts.push({
          id: "booking-severe-decline",
          severity: "critical",
          category: "Wizyty",
          title: "Znaczny spadek liczby rezerwacji",
          problem: `Liczba wizyt spadla o ${Math.abs(bookingChange)}% w porownaniu z poprzednim okresem (z ${previousAppointmentCount} do ${recentAppointmentCount} wizyt w ciagu 30 dni). To powayny trend spadkowy wymagajacy natychmiastowej reakcji.`,
          impact: `Przy utrzymaniu tego trendu mozesz stracic ok. ${Math.round((previousAppointmentCount - recentAppointmentCount) * 1.5)} wizyt w nastepnym kwartale, co przelada sie na znaczny spadek przychodow.`,
          suggestions: [
            "Uruchom kampanie promocyjna dla stalych klientow (np. -15% na nastepna wizyte)",
            "Skontaktuj sie z klientami, ktorzy dawno nie odwiedzili salonu - wyslij SMS z oferta specjalna",
            "Sprawdz grafik pracownikow - moze brakuje wolnych terminow w popularnych godzinach",
            "Rozwaaz wprowadzenie nowej uslugi lub pakietu, ktory przyciagnie nowych klientow",
            "Sprawdz opinie klientow - moze jest problem z jakoscia uslug",
          ],
          metric: {
            label: "Zmiana liczby wizyt",
            current: recentAppointmentCount,
            previous: previousAppointmentCount,
            changePercent: bookingChange,
            unit: "wizyt",
          },
          actionHref: "/dashboard/calendar",
          actionLabel: "Otworz kalendarz",
        });
      } else if (bookingChange < -10) {
        alerts.push({
          id: "booking-moderate-decline",
          severity: "warning",
          category: "Wizyty",
          title: "Spadek liczby rezerwacji",
          problem: `Liczba wizyt spadla o ${Math.abs(bookingChange)}% (z ${previousAppointmentCount} do ${recentAppointmentCount}). Monitoruj ten trend - jesli utrzyma sie, bedzie wymagal dzialania.`,
          impact: `Umiarkowany spadek rezerwacji moze wskazywac na sezonowe wahania lub poczatek dluzszego trendu. Warto dzialac profilaktycznie.`,
          suggestions: [
            "Przypomnienie SMS do klientow o mozliwosci rezerwacji online",
            "Rozwaaz promocje last-minute na wolne terminy w najblizszym tygodniu",
            "Sprawdz czy kalendarz ma wystarczajaco duzo wolnych terminow",
          ],
          metric: {
            label: "Zmiana liczby wizyt",
            current: recentAppointmentCount,
            previous: previousAppointmentCount,
            changePercent: bookingChange,
            unit: "wizyt",
          },
          actionHref: "/dashboard/calendar",
          actionLabel: "Otworz kalendarz",
        });
      }
    }

    // ─── 2. WEEKLY BOOKING DECLINE (short-term) ───
    if (lastWeekAppointments > 0) {
      const weeklyChange = computeChangePercent(
        thisWeekAppointments,
        lastWeekAppointments
      );
      if (weeklyChange < -25) {
        alerts.push({
          id: "weekly-booking-decline",
          severity: "warning",
          category: "Wizyty",
          title: "Gwalstowny spadek wizyt w tym tygodniu",
          problem: `Ten tydzien: ${thisWeekAppointments} wizyt vs ${lastWeekAppointments} w poprzednim tygodniu (spadek ${Math.abs(weeklyChange)}%). Krotkoterminowy spadek moze wskazywac na problem z dostepnoscia terminow.`,
          impact: `Jesli trend sie utrzyma przez kolejne tygodnie, miesiecne przychody moga znaczaco spasc.`,
          suggestions: [
            "Sprawdz czy nie ma problemow technicznych z systemem rezerwacji online",
            "Wyslij przypomnienia do klientow z wolnymi terminami na ten tydzien",
            "Rozwaaz oferte last-minute dla wolnych terminow",
          ],
          metric: {
            label: "Tydzien do tygodnia",
            current: thisWeekAppointments,
            previous: lastWeekAppointments,
            changePercent: weeklyChange,
            unit: "wizyt",
          },
          actionHref: "/dashboard/calendar",
          actionLabel: "Sprawdz grafik",
        });
      }
    }

    // ─── 3. REVENUE DECLINE ALERT ───
    if (previousRevenue > 0) {
      const revenueChange = computeChangePercent(recentRevenue, previousRevenue);
      if (revenueChange < -20) {
        alerts.push({
          id: "revenue-severe-decline",
          severity: "critical",
          category: "Przychody",
          title: "Znaczny spadek przychodow",
          problem: `Przychody spadly o ${Math.abs(revenueChange)}% (z ${previousRevenue.toFixed(0)} PLN do ${recentRevenue.toFixed(0)} PLN). Roznica: ${Math.abs(recentRevenue - previousRevenue).toFixed(0)} PLN mniej niz w poprzednim okresie.`,
          impact: `Przy utrzymaniu tego trendu miesieczna strata wyniesie ok. ${Math.abs(recentRevenue - previousRevenue).toFixed(0)} PLN. W skali roku to ${(Math.abs(recentRevenue - previousRevenue) * 12).toFixed(0)} PLN.`,
          suggestions: [
            "Przeanalizuj ktore uslugi generuja mniej przychodow i rozwaaz ich modyfikacje",
            "Wprowadz uslugi premium lub pakiety o wyzszej wartosci",
            "Sprawdz czy spadek nie jest zwiazany z obnizeniem cen u konkurencji",
            "Rozwaaz cross-selling produktow (szampony, odzywki) przy kazdej wizycie",
            "Zorganizuj akcje lojalnosciowa zachecajaca do czestszych wizyt",
          ],
          metric: {
            label: "Zmiana przychodow",
            current: `${recentRevenue.toFixed(0)} PLN`,
            previous: `${previousRevenue.toFixed(0)} PLN`,
            changePercent: revenueChange,
            unit: "PLN",
          },
          actionHref: "/dashboard/reports",
          actionLabel: "Zobacz raporty",
        });
      } else if (revenueChange < -10) {
        alerts.push({
          id: "revenue-moderate-decline",
          severity: "warning",
          category: "Przychody",
          title: "Spadek przychodow",
          problem: `Przychody spadly o ${Math.abs(revenueChange)}% (${recentRevenue.toFixed(0)} PLN vs ${previousRevenue.toFixed(0)} PLN). Warto zwrocic uwage na ten trend.`,
          impact: `Umiarkowany spadek moze byc sezonowy, ale warto go monitorowac i podjac dzialania zapobiegawcze.`,
          suggestions: [
            "Przeanalizuj popularne uslugi - moze warto dodac warianty premium",
            "Rozwaaz drobna podwyzke cen lub wprowadzenie dodatkowych uslug",
            "Sprawdz czy nie straciles stalych klientow na rzecz konkurencji",
          ],
          metric: {
            label: "Zmiana przychodow",
            current: `${recentRevenue.toFixed(0)} PLN`,
            previous: `${previousRevenue.toFixed(0)} PLN`,
            changePercent: revenueChange,
            unit: "PLN",
          },
          actionHref: "/dashboard/reports",
          actionLabel: "Zobacz raporty",
        });
      }
    }

    // ─── 4. HIGH CANCELLATION RATE ───
    const currentStatusMap: Record<string, number> = {};
    for (const s of appointmentsByStatus) {
      currentStatusMap[s.status] = s.count;
    }
    const currentCancelled =
      (currentStatusMap["cancelled"] ?? 0) +
      (currentStatusMap["no_show"] ?? 0);
    const currentCancellationRate =
      recentAppointmentCount > 0
        ? (currentCancelled / recentAppointmentCount) * 100
        : 0;

    const prevStatusMap: Record<string, number> = {};
    for (const s of previousAppointmentsByStatus) {
      prevStatusMap[s.status] = s.count;
    }
    const prevCancelled =
      (prevStatusMap["cancelled"] ?? 0) + (prevStatusMap["no_show"] ?? 0);
    const prevCancellationRate =
      previousAppointmentCount > 0
        ? (prevCancelled / previousAppointmentCount) * 100
        : 0;

    if (currentCancellationRate > 15) {
      alerts.push({
        id: "high-cancellation-rate",
        severity: "critical",
        category: "Anulacje",
        title: "Bardzo wysoki wskaznik anulacji",
        problem: `Wskaznik anulacji wynosi ${currentCancellationRate.toFixed(1)}% (${currentCancelled} z ${recentAppointmentCount} wizyt). Srednia branzowa to 8-10%. Poprzedni okres: ${prevCancellationRate.toFixed(1)}%.`,
        impact: `Kazda anulowana wizyta to stracony przychod i pusty termin. Przy ${currentCancelled} anulacjach tracisz potencjalne przychody z tych terminow.`,
        suggestions: [
          "Wprowadz obowiazkowe zadatki przy rezerwacji (np. 30% wartosci uslugi)",
          "Wlacz automatyczne przypomnienia SMS 24h i 2h przed wizyta",
          "Wprowadz polityke oplatty za pozne odwolanie (mniej niz 24h przed wizyta)",
          "Przeanalizuj przyczyny anulacji - moze sa problemy z dostepnoscia lub jakoscia",
        ],
        metric: {
          label: "Wskaznik anulacji",
          current: `${currentCancellationRate.toFixed(1)}%`,
          previous: `${prevCancellationRate.toFixed(1)}%`,
          changePercent: computeChangePercent(
            currentCancellationRate,
            prevCancellationRate
          ),
          unit: "%",
        },
        actionHref: "/dashboard/reports/cancellations",
        actionLabel: "Raport anulacji",
      });
    } else if (currentCancellationRate > 10) {
      alerts.push({
        id: "elevated-cancellation-rate",
        severity: "warning",
        category: "Anulacje",
        title: "Podwyzszony wskaznik anulacji",
        problem: `Wskaznik anulacji wynosi ${currentCancellationRate.toFixed(1)}% (norma branzowa: do 10%). Poprzedni okres: ${prevCancellationRate.toFixed(1)}%.`,
        impact: `Podwyzszony wskaznik anulacji moze prowadzic do pustych terminow i utraty przychodow.`,
        suggestions: [
          "Wlacz automatyczne przypomnienia SMS",
          "Rozwaaz wprowadzenie zadatkow",
          "Sprawdz przyczyny odwolan w raporcie anulacji",
        ],
        metric: {
          label: "Wskaznik anulacji",
          current: `${currentCancellationRate.toFixed(1)}%`,
          previous: `${prevCancellationRate.toFixed(1)}%`,
          changePercent: computeChangePercent(
            currentCancellationRate,
            prevCancellationRate
          ),
          unit: "%",
        },
        actionHref: "/dashboard/reports/cancellations",
        actionLabel: "Raport anulacji",
      });
    }

    // ─── 5. NO-SHOW PROBLEM ───
    const noShowCount = currentStatusMap["no_show"] ?? 0;
    if (noShowCount >= 3) {
      alerts.push({
        id: "no-show-problem",
        severity: noShowCount >= 5 ? "critical" : "warning",
        category: "Nieobecnosci",
        title: `${noShowCount} klientow nie stawilo sie na wizyty`,
        problem: `W ostatnich 30 dniach ${noShowCount} klientow nie stawilo sie na umowione wizyty bez odwolania. To strata czasu pracownikow i potencjalnych przychodow.`,
        impact: `Kazdy no-show to stracony termin, ktory mogl zostac wykorzystany przez innego klienta.`,
        suggestions: [
          "Wprowadz potwierdzanie wizyt SMS/telefonicznie dzien przed",
          "Dodaj obowiazkowe zadatki - klienci rzadziej opuszczaja oplacone wizyty",
          "Stworz liste klientow z historias no-show i wymagaj od nich przedplaty",
          "Rozwaaz polityke 'trzech ostrzezen' - po 3 no-show wymagaj pelnej przedplaty",
        ],
        metric: {
          label: "Nieobecnosci",
          current: noShowCount,
          previous: prevStatusMap["no_show"] ?? 0,
          changePercent: computeChangePercent(
            noShowCount,
            prevStatusMap["no_show"] ?? 0
          ),
          unit: "wizyt",
        },
        actionHref: "/dashboard/settings/payments",
        actionLabel: "Konfiguruj zadatki",
      });
    }

    // ─── 6. RATING DECLINE ───
    if (avgRatingPrevious.total > 0 && avgRatingRecent.total > 0) {
      if (avgRatingRecent.average < avgRatingPrevious.average - 0.3) {
        alerts.push({
          id: "rating-decline",
          severity:
            avgRatingRecent.average < 3.5 ? "critical" : "warning",
          category: "Opinie",
          title: "Spadek sredniej oceny klientow",
          problem: `Srednia ocena spadla z ${avgRatingPrevious.average.toFixed(1)}/5 do ${avgRatingRecent.average.toFixed(1)}/5 (na podstawie ${avgRatingRecent.total} opinii). Klienci oceniaja uslugi gorzej niz poprzednio.`,
          impact: `Nizsze oceny moga odstraszac nowych klientow. Salony z ocena ponizej 4.0 traca do 30% potencjalnych rezerwacji online.`,
          suggestions: [
            "Przejrzyj ostatnie opinie i zidentyfikuj powtarzajace sie problemy",
            "Porozmawiaj z pracownikami o jakosci uslug i obslugi klienta",
            "Odpowiedz na negatywne opinie - pokaz, ze zalezy Ci na klientach",
            "Rozwaaz dodatkowe szkolenie pracownikow z obslugi klienta",
          ],
          metric: {
            label: "Srednia ocena",
            current: avgRatingRecent.average.toFixed(1),
            previous: avgRatingPrevious.average.toFixed(1),
            changePercent: computeChangePercent(
              avgRatingRecent.average,
              avgRatingPrevious.average
            ),
            unit: "/5",
          },
          actionHref: "/dashboard/reviews",
          actionLabel: "Moderuj opinie",
        });
      }
    }

    // ─── 7. NEGATIVE REVIEWS SPIKE ───
    if (recentLowReviews.length >= 3) {
      alerts.push({
        id: "negative-reviews-spike",
        severity: recentLowReviews.length >= 5 ? "critical" : "warning",
        category: "Opinie",
        title: `${recentLowReviews.length} negatywnych opinii w ostatnim miesiacu`,
        problem: `Otrzymano ${recentLowReviews.length} opinii z ocena 3 lub nizej. Negatywne opinie moga zniechecac potencjalnych klientow do rezerwacji.`,
        impact: `Badania pokazuja, ze 1 negatywna opinia wymaga 12 pozytywnych, aby zneutralizowac wplyw na decyzje potencjalnych klientow.`,
        suggestions: [
          "Odpowiedz profesjonalnie na kazda negatywna opinie",
          "Skontaktuj sie z niezadowolonymi klientami i zaproponuj naprawienie sytuacji",
          "Przeanalizuj powtarzajace sie skargi i wdraz poprawki",
          "Zachecaj zadowolonych klientow do wystawiania pozytywnych opinii",
        ],
        metric: {
          label: "Negatywne opinie",
          current: recentLowReviews.length,
          previous: 0,
          changePercent: 0,
          unit: "opinii",
        },
        actionHref: "/dashboard/reviews",
        actionLabel: "Przejrzyj opinie",
      });
    }

    // ─── 8. LOW STOCK ALERT ───
    if (lowStockProducts.length > 0) {
      const productNames = lowStockProducts
        .slice(0, 3)
        .map((p) => p.name)
        .join(", ");
      alerts.push({
        id: "low-stock",
        severity: lowStockProducts.length >= 5 ? "critical" : "warning",
        category: "Magazyn",
        title: `${lowStockProducts.length} produktow z niskim stanem magazynowym`,
        problem: `Nastepujace produkty wymagaja uzupelnienia: ${productNames}${lowStockProducts.length > 3 ? ` i ${lowStockProducts.length - 3} wiecej` : ""}. Brak produktow moze uniemozliwic wykonywanie niektorych uslug.`,
        impact: `Brak produktow w magazynie moze prowadzic do odwolania wizyt lub obnizenia jakosci uslug.`,
        suggestions: [
          "Zamow brakujace produkty u dostawcow",
          "Ustaw automatyczne alerty o niskim stanie magazynowym",
          "Przeanalizuj zuzycie i ustaw optymalne minimalne stany",
        ],
        metric: {
          label: "Produkty z niskim stanem",
          current: lowStockProducts.length,
          previous: 0,
          changePercent: 0,
          unit: "produktow",
        },
        actionHref: "/dashboard/products",
        actionLabel: "Przejdz do magazynu",
      });
    }

    // ─── 9. LOW UPCOMING APPOINTMENTS ───
    if (upcomingAppointments < 3) {
      alerts.push({
        id: "low-upcoming-bookings",
        severity: upcomingAppointments === 0 ? "critical" : "warning",
        category: "Kalendarz",
        title:
          upcomingAppointments === 0
            ? "Brak wizyt na najblizszy tydzien!"
            : `Tylko ${upcomingAppointments} wizyty na najblizszy tydzien`,
        problem: `W najblizszych 7 dniach zaplanowano tylko ${upcomingAppointments} wizyt. To bardzo malo - kalendarz jest prawie pusty.`,
        impact: `Puste terminy to stracone przychody. Kazdy niewykorzystany dzien to utrata potencjalnego zarobku.`,
        suggestions: [
          "Wyslij masowe SMS do klientow z oferta specjalna na ten tydzien",
          "Opublikuj promocje last-minute w mediach spolecznosciowych",
          "Sprawdz czy system rezerwacji online dziala poprawnie",
          "Rozwaaz obnizke cen na wolne terminy",
        ],
        metric: {
          label: "Zaplanowane wizyty (7 dni)",
          current: upcomingAppointments,
          previous: "-",
          changePercent: 0,
          unit: "wizyt",
        },
        actionHref: "/dashboard/calendar",
        actionLabel: "Otworz kalendarz",
      });
    }

    // ─── 10. INACTIVE CLIENTS ───
    if (totalClientCount > 0) {
      const inactivePercent = (inactiveClientCount / totalClientCount) * 100;
      if (inactivePercent > 40) {
        alerts.push({
          id: "high-client-churn",
          severity: "warning",
          category: "Klienci",
          title: "Duzy odsetek nieaktywnych klientow",
          problem: `${inactiveClientCount} z ${totalClientCount} klientow (${inactivePercent.toFixed(0)}%) nie odwiedzilo salonu w ciagu ostatnich 60 dni. To sygnalizuje problem z retencja klientow.`,
          impact: `Pozyskanie nowego klienta kosztuje 5-7 razy wiecej niz utrzymanie istniejacego. Warto zadzialam, zeby odzyskac nieaktywnych klientow.`,
          suggestions: [
            "Wyslij kampanie 'tesknilimy za Toba' z kodem rabatowym",
            "Zaoferuj darmowa usluge dodatkowa przy nastepnej wizycie",
            "Sprawdz przyczyny odejsc - ankieta lub telefon do wybranych klientow",
            "Wprowadz program lojalnosciowy nagradzajacy regularne wizyty",
          ],
          metric: {
            label: "Nieaktywni klienci",
            current: `${inactivePercent.toFixed(0)}%`,
            previous: "-",
            changePercent: 0,
            unit: "%",
          },
          actionHref: "/dashboard/clients",
          actionLabel: "Lista klientow",
        });
      }
    }

    // ─── 11. SERVICE POPULARITY DECLINE ───
    const servicePrevMap = new Map(
      servicesPrevious.map((s) => [s.serviceId, s])
    );
    for (const current of servicesCurrent) {
      const prev = servicePrevMap.get(current.serviceId);
      if (prev && prev.count >= 3) {
        const svcChange = computeChangePercent(current.count, prev.count);
        if (svcChange < -30) {
          alerts.push({
            id: `service-decline-${current.serviceId}`,
            severity: "warning",
            category: "Uslugi",
            title: `Spadek popularnosci: ${current.serviceName}`,
            problem: `Usluga "${current.serviceName}" odnotowala spadek o ${Math.abs(svcChange)}% (z ${prev.count} do ${current.count} wizyt). To znaczacy spadek popytu na te usluge.`,
            impact: `Spadek popularnosci uslugi moze oznaczac zmiane preferencji klientow lub silniejsza konkurencje.`,
            suggestions: [
              `Rozwaaz modyfikacje uslugi "${current.serviceName}" lub dodanie nowego wariantu`,
              "Zapytaj klientow o powody - moze trzeba zmienic podejscie",
              "Sprawdz ceny u konkurencji dla tej uslugi",
              "Rozwaaz promocje lub pakiet z ta usluga",
            ],
            metric: {
              label: current.serviceName,
              current: current.count,
              previous: prev.count,
              changePercent: svcChange,
              unit: "wizyt",
            },
            actionHref: "/dashboard/services",
            actionLabel: "Zarzadzaj uslugami",
          });
        }
      }
    }

    // ─── 12. EMPLOYEE WORKLOAD IMBALANCE ───
    if (employeeWorkload.length >= 2) {
      const counts = employeeWorkload.map((e) => e.count);
      const maxCount = Math.max(...counts);
      const minCount = Math.min(...counts);
      if (maxCount > 0 && minCount > 0 && maxCount / minCount > 3) {
        const busiest = employeeWorkload.find((e) => e.count === maxCount);
        const leastBusy = employeeWorkload.find((e) => e.count === minCount);
        if (busiest && leastBusy) {
          alerts.push({
            id: "workload-imbalance",
            severity: "info",
            category: "Pracownicy",
            title: "Nierowne obciazenie pracownikow",
            problem: `${busiest.firstName} ${busiest.lastName} ma ${busiest.count} wizyt, podczas gdy ${leastBusy.firstName} ${leastBusy.lastName} tylko ${leastBusy.count}. Roznica ${(maxCount / minCount).toFixed(1)}x moze prowadzic do wypalenia jednych i braku doswiadczenia u drugich.`,
            impact: `Przeciazony pracownik moze obnizac jakosc uslug, a niedostatecznie obciazony generuje koszt bez proporcjonalnego przychodu.`,
            suggestions: [
              "Przekieruj czesc rezerwacji do mniej obciazonych pracownikow",
              "Sprawdz czy grafiki pracy sa rownomiernie rozlozone",
              "Rozwaaz szkolenie mniej obciazonych pracownikow w popularnych uslugach",
            ],
            metric: {
              label: "Stosunek obciazenia",
              current: `${maxCount}:${minCount}`,
              previous: "-",
              changePercent: 0,
              unit: "wizyt",
            },
            actionHref: "/dashboard/employees",
            actionLabel: "Grafik pracownikow",
          });
        }
      }
    }

    // Sort alerts by severity: critical > warning > info
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    alerts.sort(
      (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
    );

    return NextResponse.json({
      success: true,
      alerts,
      totalAlerts: alerts.length,
      criticalCount: alerts.filter((a) => a.severity === "critical").length,
      warningCount: alerts.filter((a) => a.severity === "warning").length,
      infoCount: alerts.filter((a) => a.severity === "info").length,
      generatedAt: now.toISOString(),
      dataRange: {
        from: sixtyDaysAgo.toISOString(),
        to: now.toISOString(),
      },
    });
  } catch (error) {
    logger.error("[AI Business Alerts] Error", { error: error });
    return NextResponse.json(
      { error: "Failed to generate business alerts" },
      { status: 500 }
    );
  }
}
