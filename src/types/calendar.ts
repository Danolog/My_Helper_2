export interface Employee {
  id: string;
  salonId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  photoUrl: string | null;
  role: string;
  isActive: boolean;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Client {
  id: string;
  salonId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  preferences: string | null;
  allergies: string | null;
  favoriteEmployeeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Service {
  id: string;
  salonId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  basePrice: string;
  baseDuration: number;
  suggestedNextVisitDays: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Appointment {
  id: string;
  salonId: string;
  clientId: string | null;
  employeeId: string;
  serviceId: string | null;
  startTime: Date;
  endTime: Date;
  status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
  notes: string | null;
  depositAmount: string | null;
  depositPaid: boolean;
  createdAt: Date;
  updatedAt: Date;
  client?: Client | null;
  employee?: Employee | null;
  service?: Service | null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  employeeId: string;
  employeeColor: string;
  appointment: Appointment;
}

export interface TimeSlot {
  time: Date;
  displayTime: string;
}

export interface WorkSchedule {
  id: string;
  employeeId: string;
  dayOfWeek: number; // 0=Sunday, 1=Monday, etc.
  startTime: string; // e.g., "09:00"
  endTime: string; // e.g., "17:00"
  createdAt: Date;
}

export type CalendarView = "day" | "week" | "month";
