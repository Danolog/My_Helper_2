"use client";

import { useParams } from "next/navigation";

import { BookingConfirmation } from "@/components/booking/booking-confirmation";
import { useBookingData } from "./_hooks/use-booking-data";
import { BookingLoading } from "./_components/booking-loading";
import { BookingNotFound } from "./_components/booking-not-found";
import { BookingHeader } from "./_components/booking-header";
import { BookingSteps } from "./_components/booking-steps";

// ---------------------------------------------------------------------------
// Page — Client Booking Flow
// ---------------------------------------------------------------------------

export default function ClientBookingPage() {
  const params = useParams();
  const salonId = params.id as string;

  const booking = useBookingData();
  const {
    salon,
    loadingSalon,
    bookingSuccess,
    assignedEmployees,
    selectedEmployeeId,
    selectedServiceId,
    selectedVariantId,
    selectedDate,
    selectedTimeSlot,
    selectedPaymentMethod,
    blikPhoneNumber,
    happyHoursPromo,
    firstVisitPromo,
    resetBooking,
    derived,
  } = booking;

  // -------------------------------------------------------------------------
  // Early returns for loading / not-found states
  // -------------------------------------------------------------------------

  if (loadingSalon) {
    return <BookingLoading />;
  }

  if (!salon) {
    return <BookingNotFound />;
  }

  // -------------------------------------------------------------------------
  // Booking success view
  // -------------------------------------------------------------------------

  if (bookingSuccess && derived.selectedService) {
    return (
      <BookingConfirmation
        salonId={salonId}
        salonName={salon.name}
        selectedService={derived.selectedService}
        selectedVariant={derived.selectedVariant}
        assignedEmployees={assignedEmployees}
        selectedEmployeeId={selectedEmployeeId}
        selectedDate={selectedDate}
        selectedTimeSlot={selectedTimeSlot}
        effectiveDuration={derived.effectiveDuration}
        baseEffectivePrice={derived.baseEffectivePrice}
        effectivePrice={derived.effectivePrice}
        bestDiscountAmount={derived.bestDiscountAmount}
        activePromoType={derived.activePromoType}
        happyHoursPromo={happyHoursPromo}
        firstVisitPromo={firstVisitPromo}
        depositRequired={derived.depositRequired}
        depositAmount={derived.depositAmount}
        selectedPaymentMethod={selectedPaymentMethod}
        blikPhoneNumber={blikPhoneNumber}
        onReset={resetBooking}
      />
    );
  }

  // -------------------------------------------------------------------------
  // Main booking flow
  // -------------------------------------------------------------------------

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <BookingHeader
        salonId={salonId}
        salonName={salon.name}
        selectedServiceId={selectedServiceId}
        variantStepSatisfied={derived.variantStepSatisfied}
        canShowEmployeeStep={derived.canShowEmployeeStep}
        selectedEmployeeId={selectedEmployeeId}
        canShowDateStep={derived.canShowDateStep}
        selectedDate={selectedDate}
        selectedTimeSlot={selectedTimeSlot}
        canShowSummaryStep={derived.canShowSummaryStep}
        bookingSuccess={bookingSuccess}
      />

      <BookingSteps
        salon={salon}
        selectedServiceId={selectedServiceId}
        selectedVariantId={selectedVariantId}
        selectedEmployeeId={selectedEmployeeId}
        selectedDate={selectedDate}
        selectedTimeSlot={selectedTimeSlot}
        expandedServices={booking.expandedServices}
        assignedEmployees={assignedEmployees}
        loadingEmployees={booking.loadingEmployees}
        slotsData={booking.slotsData}
        loadingSlots={booking.loadingSlots}
        isBooking={booking.isBooking}
        isProcessingPayment={booking.isProcessingPayment}
        isLoggedIn={booking.isLoggedIn}
        selectedPaymentMethod={selectedPaymentMethod}
        blikPhoneNumber={blikPhoneNumber}
        blikPhoneError={booking.blikPhoneError}
        guestName={booking.guestName}
        guestPhone={booking.guestPhone}
        guestEmail={booking.guestEmail}
        happyHoursPromo={happyHoursPromo}
        firstVisitPromo={firstVisitPromo}
        derived={derived}
        variantStepRef={booking.variantStepRef}
        employeeStepRef={booking.employeeStepRef}
        dateStepRef={booking.dateStepRef}
        summaryStepRef={booking.summaryStepRef}
        handleServiceSelect={booking.handleServiceSelect}
        handleVariantSelect={booking.handleVariantSelect}
        handleEmployeeSelect={booking.handleEmployeeSelect}
        handleDateChange={booking.handleDateChange}
        navigateDate={booking.navigateDate}
        handleBackToService={booking.handleBackToService}
        handleBackToEmployee={booking.handleBackToEmployee}
        handleBackToDateTime={booking.handleBackToDateTime}
        toggleServiceExpanded={booking.toggleServiceExpanded}
        handleBookAppointment={booking.handleBookAppointment}
        setSelectedPaymentMethod={booking.setSelectedPaymentMethod}
        setBlikPhoneNumber={booking.setBlikPhoneNumber}
        setBlikPhoneError={booking.setBlikPhoneError}
        setGuestName={booking.setGuestName}
        setGuestPhone={booking.setGuestPhone}
        setGuestEmail={booking.setGuestEmail}
        setSelectedTimeSlot={booking.setSelectedTimeSlot}
      />
    </div>
  );
}
