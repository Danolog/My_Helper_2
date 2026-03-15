"use client";

import { useState } from "react";
import { Lock, CalendarPlus } from "lucide-react";
import { useSalonId } from "@/hooks/use-salon-id";
import { useSession } from "@/lib/auth-client";
import { BookingModeToggle } from "./_components/booking-mode-toggle";
import { BookingSummaryCard } from "./_components/booking-summary-card";
import { ClientSelectCard } from "./_components/client-select-card";
import { DateSelectCard } from "./_components/date-select-card";
import { EmployeeSelectCard } from "./_components/employee-select-card";
import { PackageBookingFlow } from "./_components/package-booking-flow";
import { PromoCodeCard } from "./_components/promo-code-card";
import { ServiceSelectCard } from "./_components/service-select-card";
import { TimeSlotsCard } from "./_components/time-slots-card";
import { usePackageBooking } from "./_hooks/use-package-booking";
import { useServiceBooking } from "./_hooks/use-service-booking";

export default function BookingPage() {
  const { data: session, isPending } = useSession();
  const { salonId } = useSalonId();
  const [bookingMode, setBookingMode] = useState<"service" | "package">("service");

  const serviceBooking = useServiceBooking({ salonId });
  const packageBooking = usePackageBooking({
    salonId,
    selectedClientId: serviceBooking.selectedClientId,
  });

  if (isPending) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-bold mb-2">Wymagane logowanie</h1>
          <p className="text-muted-foreground mb-6">
            Musisz sie zalogowac, aby zarezerwowac wizyte
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <CalendarPlus className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Rezerwacja wizyty</h1>
          <p className="text-muted-foreground text-sm">
            Wybierz klienta, usluge, pracownika i dostepny termin
          </p>
        </div>
      </div>

      <BookingModeToggle
        bookingMode={bookingMode}
        packagesCount={packageBooking.availablePackages.length}
        onSelectService={() => { setBookingMode("service"); packageBooking.resetPackageState(); }}
        onSelectPackage={() => setBookingMode("package")}
      />

      {/* Package Booking Flow */}
      {bookingMode === "package" && (
        <PackageBookingFlow
          clients={serviceBooking.clients}
          selectedClientId={serviceBooking.selectedClientId}
          selectedClient={serviceBooking.selectedClient}
          onClientChange={serviceBooking.handleClientChange}
          availablePackages={packageBooking.availablePackages}
          selectedPackageId={packageBooking.selectedPackageId}
          selectedPackage={packageBooking.selectedPackage}
          onSelectPackage={packageBooking.handleSelectPackage}
          allEmployees={packageBooking.allEmployees}
          loadingAllEmployees={packageBooking.loadingAllEmployees}
          packageEmployeeId={packageBooking.packageEmployeeId}
          onPackageEmployeeSelect={packageBooking.handlePackageEmployeeSelect}
          packageDate={packageBooking.packageDate}
          onPackageDateChange={packageBooking.handlePackageDateChange}
          packageTimeSlot={packageBooking.packageTimeSlot}
          onPackageTimeSlotSelect={packageBooking.setPackageTimeSlot}
          packageSlotsData={packageBooking.packageSlotsData}
          loadingPackageSlots={packageBooking.loadingPackageSlots}
          isBooking={packageBooking.isBooking}
          onBookPackage={packageBooking.handleBookPackage}
        />
      )}

      {/* Regular Service Booking Flow */}
      {bookingMode === "service" && (
        <>
          <ClientSelectCard
            stepNumber={1}
            clients={serviceBooking.clients}
            selectedClientId={serviceBooking.selectedClientId}
            loadingClients={serviceBooking.loadingClients}
            availableEmployees={serviceBooking.availableEmployees}
            onClientChange={serviceBooking.handleClientChange}
          />

          <ServiceSelectCard
            services={serviceBooking.services}
            selectedServiceId={serviceBooking.selectedServiceId}
            selectedService={serviceBooking.selectedService}
            loadingServices={serviceBooking.loadingServices}
            selectedClientId={serviceBooking.selectedClientId}
            promoCheck={serviceBooking.promoCheck}
            loadingPromo={serviceBooking.loadingPromo}
            onServiceChange={serviceBooking.handleServiceChange}
          />

          <EmployeeSelectCard
            stepNumber={3}
            employees={serviceBooking.availableEmployees}
            selectedEmployeeId={serviceBooking.selectedEmployeeId}
            loadingEmployees={serviceBooking.loadingEmployees}
            hasServiceSelected={!!serviceBooking.selectedServiceId}
            favoriteEmployeeId={serviceBooking.favoriteEmployeeId}
            onEmployeeSelect={serviceBooking.handleEmployeeSelect}
          />

          <DateSelectCard
            stepNumber={4}
            selectedDate={serviceBooking.selectedDate}
            selectedEmployeeId={serviceBooking.selectedEmployeeId}
            onDateChange={serviceBooking.handleDateChange}
            onNavigateDate={serviceBooking.navigateDate}
          />

          <TimeSlotsCard
            stepNumber={5}
            slotsData={serviceBooking.slotsData}
            loadingSlots={serviceBooking.loadingSlots}
            selectedDate={serviceBooking.selectedDate}
            selectedEmployeeId={serviceBooking.selectedEmployeeId}
            selectedTimeSlot={serviceBooking.selectedTimeSlot}
            selectedService={serviceBooking.selectedService}
            onTimeSlotSelect={serviceBooking.setSelectedTimeSlot}
          />

          <PromoCodeCard
            promoCodeInput={serviceBooking.promoCodeInput}
            promoCodeValidation={serviceBooking.promoCodeValidation}
            validatingPromoCode={serviceBooking.validatingPromoCode}
            selectedServiceId={serviceBooking.selectedServiceId}
            onPromoCodeInputChange={serviceBooking.setPromoCodeInput}
            onValidatePromoCode={serviceBooking.handleValidatePromoCode}
            onClearPromoCode={serviceBooking.handleClearPromoCode}
            getPromoCodeDiscount={serviceBooking.getPromoCodeDiscount}
          />

          {serviceBooking.canBook && serviceBooking.selectedService && (
            <BookingSummaryCard
              selectedService={serviceBooking.selectedService}
              selectedClient={serviceBooking.selectedClient}
              availableEmployees={serviceBooking.availableEmployees}
              selectedEmployeeId={serviceBooking.selectedEmployeeId}
              selectedDate={serviceBooking.selectedDate}
              selectedTimeSlot={serviceBooking.selectedTimeSlot}
              promoCheck={serviceBooking.promoCheck}
              promoCodeValidation={serviceBooking.promoCodeValidation}
              isBooking={serviceBooking.isBooking}
              getPromoCodeDiscount={serviceBooking.getPromoCodeDiscount}
              onBookAppointment={serviceBooking.handleBookAppointment}
            />
          )}
        </>
      )}
    </div>
  );
}
