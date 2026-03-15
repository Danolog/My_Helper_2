"use client";

import { Package, Users, CalendarDays, Clock, AlertCircle, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NO_CLIENT, formatDateDisplay, calculateEndTime, getTodayStr } from "../_types";
import type { Client, Employee, PackageInfo, AvailableSlotsData } from "../_types";

interface PackageBookingFlowProps {
  // Client
  clients: Client[];
  selectedClientId: string;
  selectedClient: Client | null;
  onClientChange: (clientId: string) => void;
  // Packages
  availablePackages: PackageInfo[];
  selectedPackageId: string;
  selectedPackage: PackageInfo | null;
  onSelectPackage: (pkgId: string) => void;
  // Employee
  allEmployees: Employee[];
  loadingAllEmployees: boolean;
  packageEmployeeId: string;
  onPackageEmployeeSelect: (empId: string) => void;
  // Date
  packageDate: string;
  onPackageDateChange: (date: string) => void;
  // Time slots
  packageTimeSlot: string;
  onPackageTimeSlotSelect: (time: string) => void;
  packageSlotsData: AvailableSlotsData | null;
  loadingPackageSlots: boolean;
  // Booking
  isBooking: boolean;
  onBookPackage: () => void;
}

export function PackageBookingFlow({
  clients,
  selectedClientId,
  selectedClient,
  onClientChange,
  availablePackages,
  selectedPackageId,
  selectedPackage,
  onSelectPackage,
  allEmployees,
  loadingAllEmployees,
  packageEmployeeId,
  onPackageEmployeeSelect,
  packageDate,
  onPackageDateChange,
  packageTimeSlot,
  onPackageTimeSlotSelect,
  packageSlotsData,
  loadingPackageSlots,
  isBooking,
  onBookPackage,
}: PackageBookingFlowProps) {
  const todayStr = getTodayStr();

  const handleClientValueChange = (value: string) => {
    const actualClientId = value === NO_CLIENT ? "" : value;
    onClientChange(actualClientId);
  };

  return (
    <>
      {/* Step 1: Client Selection */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">1. Wybierz klienta</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <Select
            value={selectedClientId || NO_CLIENT}
            onValueChange={handleClientValueChange}
          >
            <SelectTrigger>
              <SelectValue placeholder="Wybierz klienta..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CLIENT}>Brak klienta (walk-in)</SelectItem>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {client.firstName} {client.lastName}
                  {client.phone ? ` (${client.phone})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Step 2: Package Selection */}
      <Card className="mb-6" data-testid="package-selection-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">2. Wybierz pakiet</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {availablePackages.map((pkg) => (
              <PackageOption
                key={pkg.id}
                pkg={pkg}
                isSelected={selectedPackageId === pkg.id}
                onSelect={onSelectPackage}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Step 3: Employee Selection */}
      {selectedPackageId && (
        <Card className="mb-6" data-testid="package-employee-section">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">3. Wybierz pracownika</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {loadingAllEmployees ? (
              <div className="flex justify-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              </div>
            ) : allEmployees.length === 0 ? (
              <p className="text-muted-foreground text-sm">Brak dostepnych pracownikow.</p>
            ) : (
              <div className="space-y-2">
                {allEmployees.map((emp) => (
                  <div
                    key={emp.id}
                    className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      packageEmployeeId === emp.id
                        ? "bg-primary/10 border-primary"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => onPackageEmployeeSelect(emp.id)}
                  >
                    {emp.color && (
                      <span
                        className="inline-block w-4 h-4 rounded-full shrink-0"
                        style={{ backgroundColor: emp.color }}
                      />
                    )}
                    <span className="font-medium">
                      {emp.firstName} {emp.lastName}
                    </span>
                    {packageEmployeeId === emp.id && (
                      <Badge variant="default" className="ml-auto text-xs">Wybrany</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 4: Date Selection */}
      {packageEmployeeId && (
        <Card className="mb-6" data-testid="package-date-section">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">4. Wybierz date</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <Input
              type="date"
              value={packageDate}
              min={todayStr}
              onChange={(e) => onPackageDateChange(e.target.value)}
              data-testid="package-date-input"
            />
          </CardContent>
        </Card>
      )}

      {/* Step 5: Time Slot Selection */}
      {packageDate && packageEmployeeId && (
        <PackageTimeSlotsCard
          packageSlotsData={packageSlotsData}
          loadingPackageSlots={loadingPackageSlots}
          packageTimeSlot={packageTimeSlot}
          onPackageTimeSlotSelect={onPackageTimeSlotSelect}
        />
      )}

      {/* Booking Summary */}
      {packageTimeSlot && selectedPackage && packageEmployeeId && (
        <PackageSummaryCard
          selectedPackage={selectedPackage}
          selectedClient={selectedClient}
          allEmployees={allEmployees}
          packageEmployeeId={packageEmployeeId}
          packageDate={packageDate}
          packageTimeSlot={packageTimeSlot}
          isBooking={isBooking}
          onBookPackage={onBookPackage}
        />
      )}
    </>
  );
}

// --- Sub-components ---

function PackageOption({
  pkg,
  isSelected,
  onSelect,
}: {
  pkg: PackageInfo;
  isSelected: boolean;
  onSelect: (pkgId: string) => void;
}) {
  return (
    <div
      className={`p-4 border rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? "bg-primary/10 border-primary"
          : "hover:bg-muted/50"
      }`}
      onClick={() => onSelect(pkg.id)}
      data-testid={`package-option-${pkg.id}`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">{pkg.name}</h3>
        <div className="text-right">
          <span className="text-lg font-bold text-green-600">
            {pkg.packagePrice.toFixed(2)} PLN
          </span>
          <span className="text-xs text-muted-foreground line-through ml-2">
            {pkg.totalIndividualPrice.toFixed(2)} PLN
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        {pkg.services.map((svc) => (
          <Badge key={svc.id} variant="outline" className="text-xs">
            {svc.name} ({svc.baseDuration} min)
          </Badge>
        ))}
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>Oszczedzasz: {pkg.savings.toFixed(2)} PLN</span>
        <span>Laczny czas: {pkg.totalDuration} min</span>
      </div>
      {isSelected && (
        <Badge variant="default" className="mt-2">Wybrany</Badge>
      )}
    </div>
  );
}

function PackageTimeSlotsCard({
  packageSlotsData,
  loadingPackageSlots,
  packageTimeSlot,
  onPackageTimeSlotSelect,
}: {
  packageSlotsData: AvailableSlotsData | null;
  loadingPackageSlots: boolean;
  packageTimeSlot: string;
  onPackageTimeSlotSelect: (time: string) => void;
}) {
  return (
    <Card className="mb-6" data-testid="package-slots-section">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">5. Wybierz godzine</CardTitle>
          {packageSlotsData && !packageSlotsData.dayOff && (
            <Badge variant="outline">
              {packageSlotsData.slots.length} wolnych terminow
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loadingPackageSlots ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : packageSlotsData?.dayOff ? (
          <div className="text-center py-6">
            <AlertCircle className="w-10 h-10 text-orange-500 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">
              Pracownik nie pracuje w tym dniu
            </p>
          </div>
        ) : packageSlotsData && packageSlotsData.slots.length === 0 ? (
          <div className="text-center py-6">
            <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">Brak wolnych terminow</p>
          </div>
        ) : packageSlotsData ? (
          <div>
            <div className="grid grid-cols-4 gap-2" data-testid="package-time-slots-grid">
              {packageSlotsData.slots.map((slot) => (
                <Button
                  key={slot.time}
                  variant={packageTimeSlot === slot.time ? "default" : "outline"}
                  size="sm"
                  className="text-sm"
                  onClick={() => onPackageTimeSlotSelect(slot.time)}
                  data-testid={`package-slot-${slot.time}`}
                >
                  {slot.time}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PackageSummaryCard({
  selectedPackage,
  selectedClient,
  allEmployees,
  packageEmployeeId,
  packageDate,
  packageTimeSlot,
  isBooking,
  onBookPackage,
}: {
  selectedPackage: PackageInfo;
  selectedClient: Client | null;
  allEmployees: Employee[];
  packageEmployeeId: string;
  packageDate: string;
  packageTimeSlot: string;
  isBooking: boolean;
  onBookPackage: () => void;
}) {
  const emp = allEmployees.find((e) => e.id === packageEmployeeId);
  const endTimeStr = calculateEndTime(packageTimeSlot, selectedPackage.totalDuration);

  return (
    <Card className="mb-6 border-primary" data-testid="package-booking-summary">
      <CardHeader>
        <CardTitle className="text-lg">Podsumowanie pakietu</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 mb-4">
          {selectedClient && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Klient:</span>
              <span className="font-medium">{selectedClient.firstName} {selectedClient.lastName}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Pakiet:</span>
            <span className="font-medium">{selectedPackage.name}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Pracownik:</span>
            <span className="font-medium">{emp ? `${emp.firstName} ${emp.lastName}` : ""}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Data:</span>
            <span className="font-medium">{formatDateDisplay(packageDate)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Godzina:</span>
            <span className="font-medium">{packageTimeSlot} - {endTimeStr}</span>
          </div>
          <div className="border-t pt-2 mt-2">
            <p className="text-xs text-muted-foreground mb-1">Uslugi w pakiecie:</p>
            {selectedPackage.services.map((svc) => (
              <div key={svc.id} className="flex justify-between text-xs">
                <span>{svc.name} ({svc.baseDuration} min)</span>
                <span className="line-through text-muted-foreground">{parseFloat(svc.basePrice).toFixed(2)} PLN</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-sm pt-2 border-t">
            <span className="text-muted-foreground">Suma indywidualna:</span>
            <span className="line-through text-muted-foreground">{selectedPackage.totalIndividualPrice.toFixed(2)} PLN</span>
          </div>
          <div className="flex justify-between text-sm font-bold">
            <span>Cena pakietu:</span>
            <span className="text-green-600" data-testid="package-price">{selectedPackage.packagePrice.toFixed(2)} PLN</span>
          </div>
          <div className="flex justify-between text-xs text-green-600">
            <span>Oszczednosc:</span>
            <span>{selectedPackage.savings.toFixed(2)} PLN</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Laczny czas:</span>
            <span className="font-medium">{selectedPackage.totalDuration} min</span>
          </div>
        </div>
        <Button
          className="w-full"
          size="lg"
          onClick={onBookPackage}
          disabled={isBooking}
          data-testid="book-package-btn"
        >
          {isBooking ? (
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              Rezerwowanie pakietu...
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Zarezerwuj pakiet ({selectedPackage.packagePrice.toFixed(2)} PLN)
            </div>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
