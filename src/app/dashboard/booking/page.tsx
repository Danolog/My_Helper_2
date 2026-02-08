"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Lock, CalendarPlus, Scissors, Users, User, Star } from "lucide-react";
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

  const handleServiceChange = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setSelectedEmployeeId(""); // Reset employee selection
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

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <CalendarPlus className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Rezerwacja wizyty</h1>
          <p className="text-muted-foreground text-sm">
            Wybierz klienta, usluge i pracownika, aby zarezerwowac wizyte
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
                    onClick={() => setSelectedEmployeeId(emp.id)}
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
    </div>
  );
}
