/**
 * Dostęp salonu wynikający z subskrypcji — JEDNO źródło prawdy (decyzja D2,
 * docs/PLAN_WEJSCIA_NA_RYNEK_2026-11.md, bloker B1).
 *
 * Stany:  trialing → expired → active → past_due → canceled
 *
 *   stan        | zapis | odczyt panelu | rezerwacje online | funkcje Pro
 *   ------------|-------|---------------|-------------------|------------
 *   trialing    |  tak  |      tak      |        tak        | wg planu
 *   active      |  tak  |      tak      |        tak        | wg planu
 *   past_due    |  tak  |      tak      |        tak        | wg planu
 *   canceled*   |  tak  |      tak      |        tak        | wg planu
 *   canceled    |  nie  |      tak      |        nie        | nie
 *   expired     |  nie  |      tak      |        nie        | nie
 *   none        |  nie  |      tak      |        nie        | nie
 *
 *   canceled* = anulowana, ale opłacony okres (currentPeriodEnd) jeszcze trwa.
 *
 * `expired` jest stanem WYLICZANYM przy odczycie, nie zapisywanym: wiersz ze
 * statusem `trialing`, którego okres próbny minął, jest wygasły. Dzięki temu
 * poprawność nie zależy od crona ani od tego, czy ktoś zaktualizował status.
 *
 * Kto zapisuje statusy w bazie (kolumna `salon_subscriptions.status`, zwykły text):
 *   - trialing — POST /api/register-subscription (rejestracja, 14 dni),
 *   - active   — POST /api/subscriptions/confirm (powrót ze Stripe Checkout),
 *                webhook Stripe (invoice.paid, customer.subscription.updated),
 *   - past_due — webhook Stripe (invoice.payment_failed, customer.subscription.updated),
 *   - canceled — POST /api/subscriptions/cancel, webhook Stripe
 *                (customer.subscription.deleted / .updated).
 *
 * Gdzie stan jest egzekwowany:
 *   - mutacje API panelu — src/proxy.ts (denyIfSalonReadOnly),
 *   - publiczna rezerwacja — trasy tworzące wizytę sprawdzają canAcceptBookings,
 *   - funkcje Pro (AI) — isProPlan() w src/lib/subscription.ts,
 *   - interfejs — layout panelu (baner) i hook useSubscription.
 *
 * Moduł świadomie nie importuje `next/headers` ani sesji — jest używany także
 * w proxy, gdzie nie ma kontekstu żądania Route Handlera.
 */
import { desc, eq } from "drizzle-orm";
import { TRIAL_DAYS } from "@/lib/constants";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { salonSubscriptions, subscriptionPlans } from "@/lib/schema";

export type PlanSlug = "basic" | "pro";

/**
 * Stan efektywny (po uwzględnieniu dat), nie surowa wartość kolumny `status`.
 * - `none`    — salon nie ma żadnego wiersza subskrypcji,
 * - `unknown` — nie udało się odczytać subskrypcji (błąd bazy).
 */
export type AccessStatus =
  | "trialing"
  | "expired"
  | "active"
  | "past_due"
  | "canceled"
  | "none"
  | "unknown";

export interface SalonAccess {
  /**
   * Plan zapisany w subskrypcji — także wtedy, gdy dostęp już wygasł (żeby
   * interfejs mógł zaproponować wykupienie tego samego planu). O uprawnieniach
   * decydują `canWrite` i `hasPro`, nie to pole.
   */
  plan: PlanSlug;
  planName: string;
  status: AccessStatus;
  /** Czy salon może zmieniać swoje dane (false = tryb tylko do odczytu). */
  canWrite: boolean;
  /** Czy publiczna rezerwacja online może przyjąć nową wizytę. */
  canAcceptBookings: boolean;
  /** Czy salon ma ważny dostęp do funkcji planu Pro (AI). */
  hasPro: boolean;
  /** Koniec okresu próbnego (tylko dla stanów `trialing` i `expired`). */
  trialEndsAt: Date | null;
  /** Kiedy obecny dostęp się kończy albo skończył (trial, opłacony okres po anulowaniu). */
  accessEndsAt: Date | null;
}

/** Minimalny wycinek wiersza subskrypcji potrzebny do wyliczenia dostępu. */
export interface SubscriptionSnapshot {
  id?: string;
  status: string;
  planSlug: string;
  planName: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  createdAt: Date;
}

/** Komunikat dla personelu salonu przy odrzuconej mutacji. */
export const READ_ONLY_MESSAGE =
  "Salon działa w trybie tylko do odczytu, bo nie ma aktywnego planu. Wykup plan w zakładce Subskrypcja, aby znów wprowadzać zmiany.";

/** Kod błędu w odpowiedzi API przy odrzuconej mutacji. */
export const READ_ONLY_CODE = "SUBSCRIPTION_READ_ONLY";

/** Komunikat dla klienta salonu przy próbie rezerwacji online. */
export const BOOKINGS_UNAVAILABLE_MESSAGE =
  "Ten salon chwilowo nie przyjmuje rezerwacji online. Skontaktuj się z salonem bezpośrednio.";

/** Kod błędu w odpowiedzi API przy odrzuconej rezerwacji online. */
export const BOOKINGS_UNAVAILABLE_CODE = "BOOKINGS_UNAVAILABLE";

const DAY_MS = 24 * 60 * 60 * 1000;

function toPlanSlug(slug: string): PlanSlug {
  return slug === "pro" ? "pro" : "basic";
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Koniec okresu próbnego. Gdy `trialEndsAt` jest puste (wiersz spoza
 * /api/register-subscription), liczymy `createdAt + TRIAL_DAYS` — trial bez
 * daty końca nie może być trialem bezterminowym.
 */
function getTrialEnd(sub: SubscriptionSnapshot): Date | null {
  const explicit = toDate(sub.trialEndsAt);
  if (explicit) return explicit;
  const createdAt = toDate(sub.createdAt);
  return createdAt ? new Date(createdAt.getTime() + TRIAL_DAYS * DAY_MS) : null;
}

/**
 * Wylicza dostęp z JEDNEGO wiersza subskrypcji (albo z jego braku).
 * Funkcja czysta — bez bazy i bez zegara innego niż `now`.
 */
export function resolveSubscriptionAccess(
  sub: SubscriptionSnapshot | null,
  now: Date = new Date()
): SalonAccess {
  if (!sub) {
    return {
      plan: "basic",
      planName: "Basic",
      status: "none",
      canWrite: false,
      canAcceptBookings: false,
      hasPro: false,
      trialEndsAt: null,
      accessEndsAt: null,
    };
  }

  const plan = toPlanSlug(sub.planSlug);
  const granted = (
    status: AccessStatus,
    dates: { trialEndsAt?: Date | null; accessEndsAt?: Date | null } = {}
  ): SalonAccess => ({
    plan,
    planName: sub.planName,
    status,
    canWrite: true,
    canAcceptBookings: true,
    hasPro: plan === "pro",
    trialEndsAt: dates.trialEndsAt ?? null,
    accessEndsAt: dates.accessEndsAt ?? null,
  });
  const denied = (
    status: AccessStatus,
    dates: { trialEndsAt?: Date | null; accessEndsAt?: Date | null } = {}
  ): SalonAccess => ({
    plan,
    planName: sub.planName,
    status,
    canWrite: false,
    canAcceptBookings: false,
    hasPro: false,
    trialEndsAt: dates.trialEndsAt ?? null,
    accessEndsAt: dates.accessEndsAt ?? null,
  });

  switch (sub.status) {
    case "active":
      // Stripe jest źródłem prawdy: dopóki nie przyśle innego stanu, salon
      // płaci. Nie patrzymy na currentPeriodEnd — bywa nieaktualne i nie może
      // zablokować płacącego klienta.
      return granted("active");

    case "past_due":
      // Płatność nie przeszła, Stripe ponawia próby — pełny dostęp.
      return granted("past_due");

    case "trialing": {
      const trialEnd = getTrialEnd(sub);
      const dates = { trialEndsAt: trialEnd, accessEndsAt: trialEnd };
      // Dostęp trwa, dopóki `now` jest PRZED końcem trialu; dokładnie w chwili
      // końca trial jest już wygasły.
      return trialEnd && now.getTime() < trialEnd.getTime()
        ? granted("trialing", dates)
        : denied("expired", dates);
    }

    case "canceled": {
      // Dostęp do końca opłaconego okresu, potem tylko odczyt.
      const periodEnd = toDate(sub.currentPeriodEnd);
      const dates = { accessEndsAt: periodEnd };
      return periodEnd && now.getTime() < periodEnd.getTime()
        ? granted("canceled", dates)
        : denied("canceled", dates);
    }

    default:
      // Nieznany status (np. zapisane `expired` albo `unpaid` ze Stripe) —
      // bezpiecznie: brak dostępu do zapisu.
      return denied("expired");
  }
}

/**
 * Wylicza dostęp salonu z WSZYSTKICH jego wierszy subskrypcji.
 *
 * Salon może mieć kilka wierszy (np. wygasły trial + nowa płatna subskrypcja
 * utworzona przez /api/subscriptions/confirm). Wygrywa najnowszy wiersz, który
 * daje dostęp; gdy żaden nie daje — najnowszy w ogóle (żeby interfejs pokazał
 * aktualny powód blokady).
 */
export function resolveSalonAccess(
  subscriptions: SubscriptionSnapshot[],
  now: Date = new Date()
): { access: SalonAccess; subscription: SubscriptionSnapshot | null } {
  const newestFirst = [...subscriptions].sort(
    (a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0)
  );

  for (const subscription of newestFirst) {
    const access = resolveSubscriptionAccess(subscription, now);
    if (access.canWrite) return { access, subscription };
  }

  const newest = newestFirst[0] ?? null;
  return { access: resolveSubscriptionAccess(newest, now), subscription: newest };
}

/**
 * Dostęp salonu odczytany z bazy.
 *
 * Błąd odczytu NIE blokuje zapisu (status `unknown`, canWrite = true): awaria
 * naszej bazy nie może odciąć płacących salonów od pracy. Funkcje Pro są wtedy
 * wyłączone (hasPro = false) — każde wywołanie AI kosztuje, więc tu wybieramy
 * wariant ostrożny.
 */
export async function getSalonAccess(
  salonId: string,
  now: Date = new Date()
): Promise<SalonAccess> {
  try {
    const rows = await db
      .select({
        id: salonSubscriptions.id,
        status: salonSubscriptions.status,
        planSlug: subscriptionPlans.slug,
        planName: subscriptionPlans.name,
        trialEndsAt: salonSubscriptions.trialEndsAt,
        currentPeriodEnd: salonSubscriptions.currentPeriodEnd,
        createdAt: salonSubscriptions.createdAt,
      })
      .from(salonSubscriptions)
      .innerJoin(subscriptionPlans, eq(salonSubscriptions.planId, subscriptionPlans.id))
      .where(eq(salonSubscriptions.salonId, salonId))
      .orderBy(desc(salonSubscriptions.createdAt));

    return resolveSalonAccess(rows, now).access;
  } catch (error) {
    logger.error("[Subscription] Nie udało się odczytać dostępu salonu", { error, salonId });
    return {
      plan: "basic",
      planName: "Basic",
      status: "unknown",
      canWrite: true,
      canAcceptBookings: true,
      hasPro: false,
      trialEndsAt: null,
      accessEndsAt: null,
    };
  }
}
