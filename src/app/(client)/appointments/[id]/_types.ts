import {
  Timer,
  CalendarCheck,
  CheckCircle2,
  CalendarX,
  AlertCircle,
} from "lucide-react";

export type TreatmentInfo = {
  id: string;
  recipe: string | null;
  techniques: string | null;
  notes: string | null;
  materialsJson: unknown;
};

export type DepositPaymentInfo = {
  amount: string;
  currency: string;
  paymentMethod: string;
  blikPhoneNumber: string | null;
  status: string;
  paidAt: string | null;
};

export type AppointmentDetail = {
  id: string;
  salonId: string;
  salonName: string;
  salonAddress: string | null;
  salonPhone: string | null;
  salonEmail: string | null;
  employeeName: string;
  employeeColor: string | null;
  serviceName: string;
  serviceDescription: string | null;
  servicePrice: string | null;
  serviceDuration: number | null;
  variantName: string | null;
  variantPriceModifier: string | null;
  variantDurationModifier: number | null;
  startTime: string;
  endTime: string;
  status: string;
  notes: string | null;
  depositAmount: string | null;
  depositPaid: boolean | null;
  createdAt: string;
  treatment: TreatmentInfo | null;
  depositPayment: DepositPaymentInfo | null;
};

export type ReviewInfo = {
  id: string;
  rating: number;
  comment: string | null;
  /** 'pending', 'approved', 'rejected' */
  status: string;
  createdAt: string;
};

export type CancelInfo = {
  appointmentId: string;
  status: string;
  startTime: string;
  endTime: string;
  hoursUntilAppointment: number;
  isMoreThan24h: boolean;
  isPast: boolean;
  canCancel: boolean;
  deposit: {
    amount: number;
    paid: boolean;
    action: "refund" | "forfeit" | "none";
  };
  employee: { name: string } | null;
  service: { name: string; price: string } | null;
  salon: { name: string } | null;
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) return `${hours}h`;
  return `${hours}h ${remaining}min`;
}

export function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTimeRemaining(hours: number): string {
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes} min`;
  }
  if (hours < 48) {
    return `${Math.round(hours)}h`;
  }
  const days = Math.round(hours / 24);
  return `${days} dni`;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

export const STATUS_CONFIG = {
  scheduled: {
    icon: Timer,
    label: "Zaplanowana",
    className:
      "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300",
  },
  confirmed: {
    icon: CalendarCheck,
    label: "Potwierdzona",
    className:
      "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300",
  },
  completed: {
    icon: CheckCircle2,
    label: "Zakonczona",
    className:
      "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  cancelled: {
    icon: CalendarX,
    label: "Anulowana",
    className:
      "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300",
  },
  no_show: {
    icon: AlertCircle,
    label: "Nieobecnosc",
    className:
      "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300",
  },
} as const;

export type KnownStatus = keyof typeof STATUS_CONFIG;

export function isKnownStatus(status: string): status is KnownStatus {
  return status in STATUS_CONFIG;
}

export function isUpcoming(startTime: string, status: string): boolean {
  return (
    new Date(startTime) > new Date() &&
    status !== "cancelled" &&
    status !== "completed" &&
    status !== "no_show"
  );
}

/** Calculate effective price from base + variant modifier */
export function computeEffectivePrice(appointment: AppointmentDetail): number {
  const basePrice = appointment.servicePrice
    ? parseFloat(appointment.servicePrice)
    : 0;
  const variantMod = appointment.variantPriceModifier
    ? parseFloat(appointment.variantPriceModifier)
    : 0;
  return basePrice + variantMod;
}

/** Calculate effective duration from base + variant modifier */
export function computeEffectiveDuration(
  appointment: AppointmentDetail,
): number {
  const baseDuration = appointment.serviceDuration || 0;
  const variantMod = appointment.variantDurationModifier || 0;
  return baseDuration + variantMod;
}
