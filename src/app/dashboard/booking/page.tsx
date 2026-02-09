"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Lock, CalendarPlus, Scissors, Users, User, Star, Clock, CalendarDays, Check, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";
const NO_CLIENT = "__no_client__";

interface Service {
  id: string;
  name: string;
  basePrice: string;
  baseDuration: number;
  isActive: boolean;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  color: string | null;
}

interface Client {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  favoriteEmployeeId: string | null;
}

interface TimeSlot {
  time: string;
  available: boolean;
}

interface BlockedRange {
  start: string;
  end: string;
  type: string;
  label: string;
}

interface AvailableSlotsData {
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

export default function BookingPage() {
  const { data: session, isPending } = useSession();
  const [services, setServices] = useState<Service[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string>("");
  const [availableEmployees, setAvailableEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [loadingServices, setLoadingServices] = useState(true);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  // Client selection state
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [loadingClients, setLoadingClients] = useState(true);

  // Date and time slot state
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [slotsData, setSlotsData] = useState<AvailableSlotsData | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>("");

  // Booking submission state
  const [isBooking, setIsBooking] = useState(false);

  const fetchServices = useCallback(async () => {
    try {
      setLoadingServices(true);
      const res = await fetch(`/api/services?salonId=${DEMO_SALON_ID}&activeOnly=true`);
      const data = await res.json();
      if (data.success) {
        setServices(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch services:", error);
    } finally {
      setLoadingServices(false);
    }
  }, []);

  const fetchClients = useCallback(async () => {
    try {
      setLoadingClients(true);
      const res = await fetch(`/api/clients?salonId=${DEMO_SALON_ID}`);
      const data = await res.json();
      if (data.success) {
        setClients(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch clients:", error);
    } finally {
      setLoadingClients(false);
    }
  }, []);

  useEffect(() => {
    fetchServices();
    fetchClients();
  }, [fetchServices, fetchClients]);

  // When a service is selected, fetch assigned employees
  const fetchAssignedEmployees = useCallback(async (serviceId: string) => {
    if (!serviceId) {
      setAvailableEmployees([]);
      return;
    }

    setLoadingEmployees(true);
    try {
      const res = await fetch(`/api/services/${serviceId}/employee-assignments`);
      const data = await res.json();
      if (data.success) {
        // Extract employee objects from assignments
        const employees: Employee[] = data.data
          .map((assignment: { employee: Employee | null }) => assignment.employee)
          .filter((emp: Employee | null): emp is Employee => emp !== null && emp.isActive);
        setAvailableEmployees(employees);
      }
    } catch (error) {
      console.error("Failed to fetch assigned employees:", error);
    } finally {
      setLoadingEmployees(false);
    }
  }, []);

  // Fetch available slots when employee and date change
  const fetchAvailableSlots = useCallback(async (employeeId: string, date: string, duration: number) => {
    if (!employeeId || !date || !duration) {
      setSlotsData(null);
      return;
    }

    setLoadingSlots(true);
    setSelectedTimeSlot("");
    try {
      const res = await fetch(
        `/api/available-slots?employeeId=${employeeId}&date=${date}&duration=${duration}`
      );
      const data = await res.json();
      if (data.success) {
        setSlotsData(data.data);
      } else {
        toast.error(data.error || "Nie udalo sie zaladowac dostepnych terminow");
        setSlotsData(null);
      }
    } catch (error) {
      console.error("Failed to fetch available slots:", error);
      toast.error("Blad pobierania dostepnych terminow");
      setSlotsData(null);
    } finally {
      setLoadingSlots(false);
    }
  }, []);

  // Auto-fetch slots when employee or date changes
  useEffect(() => {
    const selectedService = services.find((s) => s.id === selectedServiceId);
    if (selectedEmployeeId && selectedDate && selectedService) {
      fetchAvailableSlots(selectedEmployeeId, selectedDate, selectedService.baseDuration);
    } else {
      setSlotsData(null);
      setSelectedTimeSlot("");
    }
  }, [selectedEmployeeId, selectedDate, selectedServiceId, services, fetchAvailableSlots]);

  const handleServiceChange = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setSelectedEmployeeId(""); // Reset employee selection
    setSelectedDate("");
    setSelectedTimeSlot("");
    setSlotsData(null);
    fetchAssignedEmployees(serviceId);
  };

  // Get the selected client's favorite employee ID
  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const favoriteEmployeeId = selectedClient?.favoriteEmployeeId || null;

  const handleClientChange = (clientId: string) => {
    const actualClientId = clientId === NO_CLIENT ? "" : clientId;
    setSelectedClientId(actualClientId);

    // If client has a favorite employee and that employee is available, auto-select them
    if (actualClientId) {
      const client = clients.find((c) => c.id === actualClientId);
      if (client?.favoriteEmployeeId) {
        const isFavoriteAvailable = availableEmployees.some(
          (e) => e.id === client.favoriteEmployeeId
        );
        if (isFavoriteAvailable) {
          setSelectedEmployeeId(client.favoriteEmployeeId);
          const favEmp = availableEmployees.find(
            (e) => e.id === client.favoriteEmployeeId
          );
          if (favEmp) {
            toast.info(
              `Automatycznie wybrano ulubionego pracownika: ${favEmp.firstName} ${favEmp.lastName}`,
              { duration: 3000 }
            );
          }
        }
      }
    }
  };

  const handleEmployeeSelect = (empId: string) => {
    setSelectedEmployeeId(empId);
    // Reset time slot when employee changes
    setSelectedTimeSlot("");
  };

  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    setSelectedTimeSlot("");
  };

  const navigateDate = (direction: number) => {
    const current = selectedDate ? new Date(selectedDate) : new Date();
    current.setDate(current.getDate() + direction);
    const yyyy = current.getFullYear();
    const mm = String(current.getMonth() + 1).padStart(2, "0");
    const dd = String(current.getDate()).padStart(2, "0");
    handleDateChange(`${yyyy}-${mm}-${dd}`);
  };

  // Book the appointment
  const handleBookAppointment = async () => {
    const selectedService = services.find((s) => s.id === selectedServiceId);
    if (!selectedService || !selectedEmployeeId || !selectedDate || !selectedTimeSlot) {
      toast.error("Wypelnij wszystkie wymagane pola");
      return;
    }

    setIsBooking(true);
    try {
      const startTime = new Date(`${selectedDate}T${selectedTimeSlot}:00`);
      const endTime = new Date(startTime.getTime() + selectedService.baseDuration * 60000);

      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonId: DEMO_SALON_ID,
          clientId: selectedClientId || null,
          employeeId: selectedEmployeeId,
          serviceId: selectedServiceId,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          notes: `Rezerwacja online: ${selectedService.name}`,
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success("Wizyta zarezerwowana pomyslnie!", { duration: 4000 });
        // Refresh slots to show the newly booked slot as unavailable
        fetchAvailableSlots(selectedEmployeeId, selectedDate, selectedService.baseDuration);
        setSelectedTimeSlot("");
      } else {
        toast.error(data.error || "Nie udalo sie zarezerwowac wizyty");
      }
    } catch (error) {
      console.error("Failed to book appointment:", error);
      toast.error("Blad rezerwacji wizyty");
    } finally {
      setIsBooking(false);
    }
  };

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

  const selectedService = services.find((s) => s.id === selectedServiceId);

  // Get today's date as minimum for date picker
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // Format date for display
  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T12:00:00");
    const dayNames = ["Niedziela", "Poniedzialek", "Wtorek", "Sroda", "Czwartek", "Piatek", "Sobota"];
    const monthNames = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paz", "lis", "gru"];
    return `${dayNames[d.getDay()]}, ${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
  };

  // Check if booking is ready
  const canBook = selectedServiceId && selectedEmployeeId && selectedDate && selectedTimeSlot && !isBooking;

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

      {/* Step 1: Select Client */}
      <Card className="mb-6" data-testid="booking-client-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">1. Wybierz klienta</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {loadingClients ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : (
            <Select
              value={selectedClientId || NO_CLIENT}
              onValueChange={handleClientChange}
            >
              <SelectTrigger data-testid="booking-client-select">
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
          )}
          {selectedClient && selectedClient.favoriteEmployeeId && (
            <div
              className="flex items-center gap-2 mt-3 p-2 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800"
              data-testid="favorite-employee-hint"
            >
              <Star className="h-4 w-4 text-yellow-500 fill-yellow-500 shrink-0" />
              <span className="text-sm text-yellow-800 dark:text-yellow-300">
                Ten klient ma ulubionego pracownika
                {(() => {
                  const favEmp = availableEmployees.find(
                    (e) => e.id === selectedClient.favoriteEmployeeId
                  );
                  return favEmp
                    ? `: ${favEmp.firstName} ${favEmp.lastName}`
                    : "";
                })()}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Select Service */}
      <Card className="mb-6" data-testid="booking-service-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Scissors className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">2. Wybierz usluge</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {loadingServices ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : (
            <Select
              value={selectedServiceId}
              onValueChange={handleServiceChange}
            >
              <SelectTrigger data-testid="booking-service-select">
                <SelectValue placeholder="Wybierz usluge..." />
              </SelectTrigger>
              <SelectContent>
                {services.map((svc) => (
                  <SelectItem key={svc.id} value={svc.id}>
                    {svc.name} - {parseFloat(svc.basePrice).toFixed(2)} PLN ({svc.baseDuration} min)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selectedService && (
            <div className="mt-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{selectedService.name}</span>
              {" "}&bull;{" "}
              {parseFloat(selectedService.basePrice).toFixed(2)} PLN
              {" "}&bull;{" "}
              {selectedService.baseDuration} min
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 3: Select Employee */}
      <Card className="mb-6" data-testid="booking-employee-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">3. Wybierz pracownika</CardTitle>
            {selectedServiceId && (
              <Badge variant="outline" data-testid="available-employees-count">
                {availableEmployees.length} dostepnych
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!selectedServiceId ? (
            <p className="text-muted-foreground text-sm" data-testid="select-service-first-message">
              Najpierw wybierz usluge, aby zobaczyc dostepnych pracownikow.
            </p>
          ) : loadingEmployees ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : availableEmployees.length === 0 ? (
            <div className="text-center py-6">
              <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm" data-testid="no-employees-for-service-message">
                Brak przypisanych pracownikow do tej uslugi.
                Przypisz pracownikow w ustawieniach uslugi.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {availableEmployees.map((emp) => {
                const isFavorite = favoriteEmployeeId === emp.id;
                return (
                  <div
                    key={emp.id}
                    className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedEmployeeId === emp.id
                        ? "bg-primary/10 border-primary"
                        : isFavorite
                          ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700 hover:bg-yellow-100 dark:hover:bg-yellow-900/30"
                          : "hover:bg-muted/50"
                    }`}
                    onClick={() => handleEmployeeSelect(emp.id)}
                    data-testid={`booking-employee-option-${emp.id}`}
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
                    {isFavorite && (
                      <Badge
                        variant="secondary"
                        className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300"
                        data-testid={`favorite-employee-badge-${emp.id}`}
                      >
                        <Star className="h-3 w-3 mr-1 fill-yellow-500 text-yellow-500" />
                        Ulubiony
                      </Badge>
                    )}
                    {emp.role === "owner" && (
                      <Badge variant="outline" className="text-xs">
                        wlasciciel
                      </Badge>
                    )}
                    {selectedEmployeeId === emp.id && (
                      <Badge variant="default" className="ml-auto text-xs">
                        Wybrany
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 4: Select Date */}
      <Card className="mb-6" data-testid="booking-date-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">4. Wybierz date</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {!selectedEmployeeId ? (
            <p className="text-muted-foreground text-sm" data-testid="select-employee-first-message">
              Najpierw wybierz pracownika, aby zobaczyc dostepne daty.
            </p>
          ) : (
            <div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => navigateDate(-1)}
                  disabled={!selectedDate || selectedDate <= todayStr}
                  data-testid="date-prev-btn"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Input
                  type="date"
                  value={selectedDate}
                  min={todayStr}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="flex-1"
                  data-testid="booking-date-input"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => navigateDate(1)}
                  disabled={!selectedDate}
                  data-testid="date-next-btn"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              {selectedDate && (
                <p className="text-sm text-muted-foreground mt-2" data-testid="selected-date-display">
                  {formatDateDisplay(selectedDate)}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 5: Select Time Slot */}
      <Card className="mb-6" data-testid="booking-slots-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">5. Wybierz godzine</CardTitle>
            {slotsData && !slotsData.dayOff && (
              <Badge variant="outline" data-testid="available-slots-count">
                {slotsData.slots.length} wolnych terminow
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!selectedDate || !selectedEmployeeId ? (
            <p className="text-muted-foreground text-sm" data-testid="select-date-first-message">
              Wybierz pracownika i date, aby zobaczyc dostepne godziny.
            </p>
          ) : loadingSlots ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : slotsData?.dayOff ? (
            <div className="text-center py-6" data-testid="day-off-message">
              <AlertCircle className="w-10 h-10 text-orange-500 mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">
                {slotsData.message || "Pracownik nie pracuje w tym dniu"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Wybierz inna date
              </p>
            </div>
          ) : slotsData && slotsData.slots.length === 0 ? (
            <div className="text-center py-6" data-testid="no-slots-message">
              <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">
                Brak wolnych terminow w tym dniu
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Wszystkie terminy sa zajete. Wybierz inna date.
              </p>
              {slotsData.blockedRanges && slotsData.blockedRanges.length > 0 && (
                <div className="mt-4 text-left">
                  <p className="text-xs text-muted-foreground mb-2 font-medium">Zajete terminy:</p>
                  {slotsData.blockedRanges.map((range, i) => (
                    <div key={i} className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                      <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
                      {range.start} - {range.end} ({range.type === "appointment" ? "wizyta" : range.label})
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : slotsData ? (
            <div>
              {/* Work hours info */}
              <div className="flex items-center gap-2 mb-3 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>Godziny pracy: {slotsData.workStart} - {slotsData.workEnd}</span>
              </div>

              {/* Blocked ranges info */}
              {slotsData.blockedRanges && slotsData.blockedRanges.length > 0 && (
                <div className="mb-4 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-md border border-orange-200 dark:border-orange-800" data-testid="blocked-ranges-info">
                  <p className="text-xs font-medium text-orange-800 dark:text-orange-300 mb-1">Zajete terminy:</p>
                  {slotsData.blockedRanges.map((range, i) => (
                    <div key={i} className="text-xs text-orange-700 dark:text-orange-400 flex items-center gap-1 mb-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
                      {range.start} - {range.end}
                      <span className="text-orange-500">
                        ({range.type === "appointment" ? "wizyta" : range.type === "vacation" ? "urlop" : range.type === "break" ? "przerwa" : range.label})
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Time slot grid */}
              <div className="grid grid-cols-4 gap-2" data-testid="time-slots-grid">
                {slotsData.slots.map((slot) => (
                  <Button
                    key={slot.time}
                    variant={selectedTimeSlot === slot.time ? "default" : "outline"}
                    size="sm"
                    className={`text-sm ${
                      selectedTimeSlot === slot.time
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-primary/10"
                    }`}
                    onClick={() => setSelectedTimeSlot(slot.time)}
                    data-testid={`time-slot-${slot.time}`}
                  >
                    {slot.time}
                  </Button>
                ))}
              </div>

              {selectedTimeSlot && selectedService && (
                <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-md border border-green-200 dark:border-green-800" data-testid="selected-slot-summary">
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium text-green-800 dark:text-green-300">
                      Wybrany termin: {selectedTimeSlot} - {(() => {
                        const parts = selectedTimeSlot.split(":").map(Number);
                        const h = parts[0] ?? 0;
                        const m = parts[1] ?? 0;
                        const endMinutes = h * 60 + m + selectedService.baseDuration;
                        const endH = Math.floor(endMinutes / 60);
                        const endM = endMinutes % 60;
                        return `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;
                      })()}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Booking Summary & Submit */}
      {canBook && selectedService && (
        <Card className="mb-6 border-primary" data-testid="booking-summary-section">
          <CardHeader>
            <CardTitle className="text-lg">Podsumowanie rezerwacji</CardTitle>
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
                <span className="text-muted-foreground">Usluga:</span>
                <span className="font-medium">{selectedService.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Pracownik:</span>
                <span className="font-medium">
                  {(() => {
                    const emp = availableEmployees.find((e) => e.id === selectedEmployeeId);
                    return emp ? `${emp.firstName} ${emp.lastName}` : "";
                  })()}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Data:</span>
                <span className="font-medium">{formatDateDisplay(selectedDate)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Godzina:</span>
                <span className="font-medium">
                  {selectedTimeSlot} - {(() => {
                    const parts = selectedTimeSlot.split(":").map(Number);
                        const h = parts[0] ?? 0;
                        const m = parts[1] ?? 0;
                    const endMinutes = h * 60 + m + selectedService.baseDuration;
                    const endH = Math.floor(endMinutes / 60);
                    const endM = endMinutes % 60;
                    return `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;
                  })()}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Cena:</span>
                <span className="font-medium">{parseFloat(selectedService.basePrice).toFixed(2)} PLN</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Czas trwania:</span>
                <span className="font-medium">{selectedService.baseDuration} min</span>
              </div>
            </div>
            <Button
              className="w-full"
              size="lg"
              onClick={handleBookAppointment}
              disabled={isBooking}
              data-testid="book-appointment-btn"
            >
              {isBooking ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Rezerwowanie...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <CalendarPlus className="h-5 w-5" />
                  Zarezerwuj wizyte
                </div>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
