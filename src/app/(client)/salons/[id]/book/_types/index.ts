// ---------------------------------------------------------------------------
// Types for the client booking flow
// ---------------------------------------------------------------------------

import type {
  SalonDetail,
  ServiceItem,
  ServiceVariant,
  AssignedEmployee,
  AvailableSlotsData,
} from "@/components/booking/types";

// Re-export shared booking types used by sub-components
export type {
  SalonDetail,
  ServiceItem,
  ServiceVariant,
  AssignedEmployee,
  AvailableSlotsData,
};

// ---------------------------------------------------------------------------
// Client-specific deposit settings fetched from salon's client record
// ---------------------------------------------------------------------------

export interface ClientDepositSettings {
  found: boolean;
  clientId?: string;
  requireDeposit: boolean;
  depositType: string | null;
  depositValue: string | null;
}

// ---------------------------------------------------------------------------
// Promotion state types
// ---------------------------------------------------------------------------

export interface HappyHoursPromo {
  eligible: boolean;
  promotionId?: string;
  promotionName?: string;
  discountPercent?: number;
  startTime?: string;
  endTime?: string;
  reason?: string;
}

export interface FirstVisitPromo {
  eligible: boolean;
  promotionId?: string;
  promotionName?: string;
  discountPercent?: number;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Active promotion discriminator
// ---------------------------------------------------------------------------

export type ActivePromoType = "happy_hours" | "first_visit" | "none";

// ---------------------------------------------------------------------------
// Derived pricing/deposit values exposed by the hook
// ---------------------------------------------------------------------------

export interface BookingDerived {
  selectedService: ServiceItem | null;
  selectedVariant: ServiceVariant | null;
  hasVariants: boolean;
  baseEffectivePrice: number;
  effectivePrice: number;
  effectiveDuration: number;
  happyHoursDiscountAmount: number;
  firstVisitDiscountAmount: number;
  bestDiscountAmount: number;
  activePromoType: ActivePromoType;
  depositRequired: boolean;
  depositAmount: number;
  depositPercentage: number;
  variantStepRequired: boolean;
  variantStepSatisfied: boolean;
  canShowVariantStep: boolean;
  canShowEmployeeStep: boolean;
  canShowDateStep: boolean;
  canShowSummaryStep: boolean;
}

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------

export interface UseBookingDataReturn {
  // Salon
  salon: SalonDetail | null;
  loadingSalon: boolean;

  // Selections
  selectedServiceId: string;
  selectedVariantId: string;
  selectedEmployeeId: string;
  selectedDate: string;
  selectedTimeSlot: string;
  expandedServices: Set<string>;

  // Employee data
  assignedEmployees: AssignedEmployee[];
  loadingEmployees: boolean;

  // Slots data
  slotsData: AvailableSlotsData | null;
  loadingSlots: boolean;

  // Booking state
  isBooking: boolean;
  bookingSuccess: boolean;
  isProcessingPayment: boolean;

  // Payment
  selectedPaymentMethod: string;
  blikPhoneNumber: string;
  blikPhoneError: string;

  // Guest info
  guestName: string;
  guestPhone: string;
  guestEmail: string;

  // Promotions
  happyHoursPromo: HappyHoursPromo | null;
  firstVisitPromo: FirstVisitPromo | null;

  // Session
  isLoggedIn: boolean;

  // Derived values
  derived: BookingDerived;

  // Step card refs for auto-scroll
  variantStepRef: React.RefObject<HTMLDivElement | null>;
  employeeStepRef: React.RefObject<HTMLDivElement | null>;
  dateStepRef: React.RefObject<HTMLDivElement | null>;
  summaryStepRef: React.RefObject<HTMLDivElement | null>;

  // Handlers
  handleServiceSelect: (serviceId: string) => void;
  handleVariantSelect: (variantId: string) => void;
  handleEmployeeSelect: (empId: string) => void;
  handleDateChange: (newDate: string) => void;
  navigateDate: (direction: number) => void;
  handleBackToService: () => void;
  handleBackToEmployee: () => void;
  handleBackToDateTime: () => void;
  toggleServiceExpanded: (serviceId: string) => void;
  handleBookAppointment: () => Promise<void>;
  resetBooking: () => void;
  setSelectedPaymentMethod: (method: string) => void;
  setBlikPhoneNumber: (phone: string) => void;
  setBlikPhoneError: (error: string) => void;
  setGuestName: (name: string) => void;
  setGuestPhone: (phone: string) => void;
  setGuestEmail: (email: string) => void;
  setSelectedTimeSlot: (slot: string) => void;
}
