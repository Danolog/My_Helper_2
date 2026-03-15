// ---------------------------------------------------------------------------
// Shared types for Booking components
// ---------------------------------------------------------------------------

export interface ServiceVariant {
  id: string;
  serviceId: string;
  name: string;
  priceModifier: string | null;
  durationModifier: number | null;
}

export interface ServiceItem {
  id: string;
  name: string;
  basePrice: string;
  baseDuration: number;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  depositRequired: boolean;
  depositPercentage: number | null;
  variants: ServiceVariant[];
}

export interface ServiceCategory {
  id: string;
  name: string;
  sortOrder: number | null;
}

export interface EmployeeProfile {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  photoUrl: string | null;
  color: string | null;
  specialties: string[];
  averageRating: number | null;
  reviewCount: number;
  galleryCount: number;
}

export interface SalonDetail {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  industryType: string | null;
  services: ServiceItem[];
  categories: ServiceCategory[];
  employees: EmployeeProfile[];
  averageRating: number | null;
}

export interface AssignedEmployee {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  color: string | null;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const DAY_NAMES = [
  "Niedziela",
  "Poniedzialek",
  "Wtorek",
  "Sroda",
  "Czwartek",
  "Piatek",
  "Sobota",
];

export const MONTH_ABBRS = [
  "sty",
  "lut",
  "mar",
  "kwi",
  "maj",
  "cze",
  "lip",
  "sie",
  "wrz",
  "paz",
  "lis",
  "gru",
];

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) return `${hours}h`;
  return `${hours}h ${remaining}min`;
}

export function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_ABBRS[d.getMonth()]} ${d.getFullYear()}`;
}

export function getTodayStr(): string {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Calculate end time string from start time + duration in minutes. */
export function calcEndTime(startTime: string, durationMinutes: number): string {
  const parts = startTime.split(":").map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const total = h * 60 + m + durationMinutes;
  const endH = Math.floor(total / 60);
  const endM = total % 60;
  return `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;
}
