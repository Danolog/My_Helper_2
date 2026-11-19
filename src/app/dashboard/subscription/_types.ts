import { hasRealStripeSubscription } from "@/lib/subscription-predicates";

export type SubscriptionData = {
  id: string;
  salonId: string;
  planId: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  status: string;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
  scheduledPlanId: string | null;
  scheduledChangeAt: string | null;
  createdAt: string;
};

export type PlanData = {
  id: string;
  name: string;
  slug: string;
  priceMonthly: string;
  features: string[];
  isActive: boolean;
};

export type ScheduledPlanData = {
  id: string;
  name: string;
  slug: string;
  priceMonthly: string;
  features: string[];
} | null;

export type AllPlansMap = Record<string, PlanData>;

export type ExpirationData = {
  daysRemaining: number | null;
  warningThreshold: number;
  isNearExpiry: boolean;
  renewalAmount: string | null;
};

/**
 * Access state computed by the server (`access` in the current subscription
 * response). `until` is the end of full access as an ISO string, or null.
 */
export type AccessData = {
  state: string;
  mode: "full" | "read_only";
  planSlug: string | null;
  until: string | null;
};

/** Format a date string to Polish locale (e.g. "15 marca 2026") */
export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  try {
    return new Intl.DateTimeFormat("pl-PL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

/**
 * Toast description after a successful cancellation: the "active until <date>"
 * text only when the period end is a valid date strictly later than `now`;
 * otherwise (missing, empty, invalid, equal to or before `now`) only the
 * "will not be renewed" text, with no statement about access.
 */
export function cancelSuccessDescription(
  currentPeriodEnd: string | null | undefined,
  now: Date,
): string {
  const periodEndMs = currentPeriodEnd
    ? new Date(currentPeriodEnd).getTime()
    : Number.NaN;
  if (currentPeriodEnd && periodEndMs > now.getTime()) {
    return `Dostep do planu jest aktywny do ${formatDate(currentPeriodEnd)}. Subskrypcja nie zostanie odnowiona.`;
  }
  return "Subskrypcja nie zostanie odnowiona.";
}

/** Label of the period end tile on the plan card for a subscription status. */
export function periodEndLabel(status: string): string {
  switch (status) {
    case "trialing":
      return "Koniec okresu probnego";
    case "canceled":
    case "past_due":
      return "Koniec okresu";
    default:
      return "Nastepna platnosc";
  }
}

/** Text shown instead of the reactivation button while a new purchase is refused. */
export function purchaseBlockedText(blockedUntil: string): string {
  return `Nowy zakup bedzie mozliwy po ${formatDate(blockedUntil)}.`;
}

const NEW_PURCHASE_AFTER_TEXT = "Nowy zakup bedzie mozliwy po tym terminie.";

/**
 * Canceled subscription notice. The "access active until <date>" sentence
 * appears only when the server reports full access in the `canceled` state
 * with an end date; otherwise there is no statement about access. Ends with
 * the "new purchase after that date" sentence when `blockedUntil` is set,
 * otherwise with the reactivation sentence.
 */
export function canceledNoticeText(
  canceledAt: string | null,
  access: AccessData | null,
  blockedUntil: string | null,
): string {
  const parts = [
    canceledAt
      ? `Anulowano: ${formatDate(canceledAt)}.`
      : "Twoja subskrypcja zostala anulowana.",
  ];
  if (access?.state === "canceled" && access.mode === "full" && access.until) {
    parts.push(`Dostep do funkcji planu jest aktywny do ${formatDate(access.until)}.`);
  }
  parts.push(
    blockedUntil
      ? NEW_PURCHASE_AFTER_TEXT
      : "Mozesz w kazdej chwili ponownie aktywowac plan.",
  );
  return parts.join(" ");
}

/**
 * Past due notice. The "access active until <date>" sentence appears only
 * when the server reports full access in the `past_due` state with an end
 * date; the "new purchase after that date" sentence only when `blockedUntil`
 * is set. Always ends with the instruction to contact support.
 */
export function pastDueNoticeText(
  access: AccessData | null,
  blockedUntil: string | null,
): string {
  const parts = ["Ostatnia platnosc nie powiodla sie."];
  if (access?.state === "past_due" && access.mode === "full" && access.until) {
    parts.push(`Dostep do funkcji planu jest aktywny do ${formatDate(access.until)}.`);
  }
  if (blockedUntil) {
    parts.push(NEW_PURCHASE_AFTER_TEXT);
  }
  parts.push("W sprawie zaleglej platnosci skontaktuj sie z obsluga.");
  return parts.join(" ");
}

/** True when the period end is a valid date strictly later than `now`. */
function isPeriodEndInFuture(currentPeriodEnd: string | null, now: Date): boolean {
  if (!currentPeriodEnd) return false;
  return new Date(currentPeriodEnd).getTime() > now.getTime();
}

/**
 * Access sentence in the cancel dialog: access until the period end only
 * when the period end is a valid date strictly later than `now` (as in
 * `cancelSuccessDescription`); otherwise only the "will not be renewed" text.
 */
export function cancelDialogAccessText(
  planName: string,
  currentPeriodEnd: string | null,
  now: Date,
): string {
  if (isPeriodEndInFuture(currentPeriodEnd, now)) {
    return `Zachowasz dostep do wszystkich funkcji planu ${planName} do konca biezacego okresu rozliczeniowego (${formatDate(currentPeriodEnd)}). Po tym terminie subskrypcja nie zostanie odnowiona.`;
  }
  return "Subskrypcja nie zostanie odnowiona.";
}

/**
 * Repurchase sentence in the cancel dialog: with a real Stripe subscription
 * and the period end strictly later than `now`, a new purchase is possible
 * only after that date; otherwise reactivation is possible at any time.
 */
export function cancelDialogRepurchaseText(
  stripeSubscriptionId: string | null,
  currentPeriodEnd: string | null,
  now: Date,
): string {
  if (
    hasRealStripeSubscription(stripeSubscriptionId) &&
    isPeriodEndInFuture(currentPeriodEnd, now)
  ) {
    return NEW_PURCHASE_AFTER_TEXT;
  }
  return "Mozesz ponownie aktywowac subskrypcje w dowolnym momencie.";
}

/**
 * Heading of the plan features list. With read-only access the list
 * describes the plan of the row, so the heading names that plan.
 */
export function planFeaturesHeading(
  planName: string,
  access: AccessData | null,
): string {
  if (access?.mode === "read_only") return `Funkcje planu ${planName}`;
  return "Funkcje w Twoim planie";
}

/** Map subscription status to a Polish label */
export function statusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Aktywna";
    case "past_due":
      return "Zalegla platnosc";
    case "canceled":
      return "Anulowana";
    case "trialing":
      return "Okres probny";
    default:
      return status;
  }
}

/** Map subscription status to Tailwind CSS badge color classes */
export function statusColor(status: string): string {
  switch (status) {
    case "active":
      return "bg-green-100 text-green-800 hover:bg-green-100 border-green-200";
    case "past_due":
      return "bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200";
    case "canceled":
      return "bg-red-100 text-red-800 hover:bg-red-100 border-red-200";
    case "trialing":
      return "bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-200";
    default:
      return "";
  }
}
