"use client";

import { BookingSummary } from "@/components/booking/booking-summary";
import { EmployeeSelector } from "@/components/booking/employee-selector";
import { VariantSelector } from "@/components/booking/promo-code-input";
import { ServiceSelector } from "@/components/booking/service-selector";
import { TimeSlotPicker } from "@/components/booking/time-slot-picker";
import type { UseBookingDataReturn } from "../_types";

type BookingStepsProps = Pick<
  UseBookingDataReturn,
  | "salon"
  | "selectedServiceId"
  | "selectedVariantId"
  | "selectedEmployeeId"
  | "selectedDate"
  | "selectedTimeSlot"
  | "expandedServices"
  | "assignedEmployees"
  | "loadingEmployees"
  | "slotsData"
  | "loadingSlots"
  | "isBooking"
  | "isProcessingPayment"
  | "isLoggedIn"
  | "selectedPaymentMethod"
  | "blikPhoneNumber"
  | "blikPhoneError"
  | "guestName"
  | "guestPhone"
  | "guestEmail"
  | "happyHoursPromo"
  | "firstVisitPromo"
  | "derived"
  | "variantStepRef"
  | "employeeStepRef"
  | "dateStepRef"
  | "summaryStepRef"
  | "handleServiceSelect"
  | "handleVariantSelect"
  | "handleEmployeeSelect"
  | "handleDateChange"
  | "navigateDate"
  | "handleBackToService"
  | "handleBackToEmployee"
  | "handleBackToDateTime"
  | "toggleServiceExpanded"
  | "handleBookAppointment"
  | "setSelectedPaymentMethod"
  | "setBlikPhoneNumber"
  | "setBlikPhoneError"
  | "setGuestName"
  | "setGuestPhone"
  | "setGuestEmail"
  | "setSelectedTimeSlot"
>;

export function BookingSteps({
  salon,
  selectedServiceId,
  selectedVariantId,
  selectedEmployeeId,
  selectedDate,
  selectedTimeSlot,
  expandedServices,
  assignedEmployees,
  loadingEmployees,
  slotsData,
  loadingSlots,
  isBooking,
  isProcessingPayment,
  isLoggedIn,
  selectedPaymentMethod,
  blikPhoneNumber,
  blikPhoneError,
  guestName,
  guestPhone,
  guestEmail,
  happyHoursPromo,
  firstVisitPromo,
  derived,
  variantStepRef,
  employeeStepRef,
  dateStepRef,
  summaryStepRef,
  handleServiceSelect,
  handleVariantSelect,
  handleEmployeeSelect,
  handleDateChange,
  navigateDate,
  handleBackToService,
  handleBackToEmployee,
  handleBackToDateTime,
  toggleServiceExpanded,
  handleBookAppointment,
  setSelectedPaymentMethod,
  setBlikPhoneNumber,
  setBlikPhoneError,
  setGuestName,
  setGuestPhone,
  setGuestEmail,
  setSelectedTimeSlot,
}: BookingStepsProps) {
  if (!salon) return null;

  const {
    selectedService,
    selectedVariant,
    hasVariants,
    baseEffectivePrice,
    effectivePrice,
    effectiveDuration,
    bestDiscountAmount,
    activePromoType,
    depositRequired,
    depositAmount,
    depositPercentage,
    canShowVariantStep,
    canShowEmployeeStep,
    canShowDateStep,
    canShowSummaryStep,
  } = derived;

  return (
    <>
      {/* Step 1: Select Service */}
      <ServiceSelector
        services={salon.services}
        categories={salon.categories}
        selectedServiceId={selectedServiceId}
        expandedServices={expandedServices}
        onServiceSelect={handleServiceSelect}
        onToggleExpanded={toggleServiceExpanded}
      />

      {/* Step 2: Select Variant (only if service has variants) */}
      <VariantSelector
        ref={variantStepRef}
        canShow={canShowVariantStep}
        selectedService={selectedService}
        selectedVariantId={selectedVariantId}
        onVariantSelect={handleVariantSelect}
      />

      {/* Step 3: Select Employee */}
      <EmployeeSelector
        ref={employeeStepRef}
        canShow={canShowEmployeeStep}
        hasSelectedService={selectedServiceId !== ""}
        hasVariants={hasVariants}
        stepNumber={hasVariants ? 3 : 2}
        assignedEmployees={assignedEmployees}
        loadingEmployees={loadingEmployees}
        selectedEmployeeId={selectedEmployeeId}
        onEmployeeSelect={handleEmployeeSelect}
        onBackToService={handleBackToService}
      />

      {/* Step 4: Select Date & Time */}
      <TimeSlotPicker
        ref={dateStepRef}
        canShow={canShowDateStep}
        hasVariants={hasVariants}
        stepNumber={hasVariants ? 4 : 3}
        selectedDate={selectedDate}
        selectedTimeSlot={selectedTimeSlot}
        slotsData={slotsData}
        loadingSlots={loadingSlots}
        effectiveDuration={effectiveDuration}
        onDateChange={handleDateChange}
        onNavigateDate={navigateDate}
        onTimeSlotSelect={setSelectedTimeSlot}
        onBackToEmployee={handleBackToEmployee}
      />

      {/* Step 5: Review & Confirm */}
      <BookingSummary
        ref={summaryStepRef}
        canShow={canShowSummaryStep}
        hasVariants={hasVariants}
        stepNumber={hasVariants ? 5 : 4}
        salon={{ name: salon.name }}
        selectedService={selectedService}
        selectedVariant={selectedVariant}
        assignedEmployees={assignedEmployees}
        selectedEmployeeId={selectedEmployeeId}
        selectedDate={selectedDate}
        selectedTimeSlot={selectedTimeSlot}
        effectiveDuration={effectiveDuration}
        isLoggedIn={isLoggedIn}
        isBooking={isBooking}
        isProcessingPayment={isProcessingPayment}
        promotion={{
          activePromoType,
          bestDiscountAmount,
          baseEffectivePrice,
          effectivePrice,
          happyHoursPromo,
          firstVisitPromo,
        }}
        deposit={{
          depositRequired,
          depositAmount,
          depositPercentage,
        }}
        guest={{
          guestName,
          guestPhone,
          guestEmail,
          onGuestNameChange: setGuestName,
          onGuestPhoneChange: setGuestPhone,
          onGuestEmailChange: setGuestEmail,
        }}
        payment={{
          selectedPaymentMethod,
          blikPhoneNumber,
          blikPhoneError,
          onPaymentMethodChange: setSelectedPaymentMethod,
          onBlikPhoneChange: setBlikPhoneNumber,
          onBlikPhoneErrorClear: () => setBlikPhoneError(""),
        }}
        onBackToDateTime={handleBackToDateTime}
        onBook={handleBookAppointment}
      />
    </>
  );
}
