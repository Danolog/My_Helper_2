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
  recentWarnings: Array<{
    id: string;
    type: string;
    message: string;
    status: string;
    sentAt: string | null;
    createdAt: string;
  }>;
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
