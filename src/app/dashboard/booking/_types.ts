export const NO_CLIENT = "__no_client__";

export interface Service {
  id: string;
  name: string;
  basePrice: string;
  baseDuration: number;
  isActive: boolean;
}

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  color: string | null;
}

export interface Client {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  favoriteEmployeeId: string | null;
}

export interface TimeSlot {
  time: string;
  available: boolean;
}

export interface BlockedRange {
  start: string;
  end: string;
  type: string;
  label: string;
}

export interface AvailableSlotsData {
  date: string;
  employeeId: string;
  duration: number;
  dayOff: boolean;
  workStart: string | null;
  workEnd: string | null;
  slots: TimeSlot[];
  allSlots?: TimeSlot[];
  blockedRanges?: BlockedRange[];
  message?: string;
}

export interface PromotionCheck {
  eligible: boolean;
  appointmentCount?: number;
  remainingForPromo?: number;
  promotionId?: string;
  promotionName?: string;
  discountPercent?: number;
  originalPrice?: number;
  discountAmount?: number;
  finalPrice?: number;
  reason?: string;
}

export interface PackageInfo {
  id: string;
  name: string;
  packagePrice: number;
  totalIndividualPrice: number;
  savings: number;
  totalDuration: number;
  services: Array<{
    id: string;
    name: string;
    basePrice: string;
    baseDuration: number;
  }>;
}

export interface PromoCodeValidation {
  valid: boolean;
  reason?: string;
  errorType?: string;
  code?: string;
  promoCodeId?: string;
  promotionId?: string;
  promotionName?: string;
  discountType?: string;
  discountValue?: number;
  usedCount?: number;
  usageLimit?: number | null;
  expiresAt?: string | null;
  conditionsJson?: Record<string, unknown>;
}

/** Format a date string (YYYY-MM-DD) to a Polish human-readable display */
export function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  const dayNames = ["Niedziela", "Poniedzialek", "Wtorek", "Sroda", "Czwartek", "Piatek", "Sobota"];
  const monthNames = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paz", "lis", "gru"];
  return `${dayNames[d.getDay()]}, ${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
}

/** Calculate end time string from a start time (HH:MM) and duration in minutes */
export function calculateEndTime(startTime: string, durationMinutes: number): string {
  const parts = startTime.split(":").map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const endMinutes = h * 60 + m + durationMinutes;
  const endH = Math.floor(endMinutes / 60);
  const endM = endMinutes % 60;
  return `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;
}

/** Get today's date as YYYY-MM-DD string */
export function getTodayStr(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}
