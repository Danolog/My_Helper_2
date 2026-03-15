"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Lock, Users, Clock, UserPlus, Pencil } from "lucide-react";
import { useTabSync } from "@/hooks/use-tab-sync";
import { toast } from "sonner";

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  role: string;
  isActive: boolean;
  color: string | null;
}

interface EmployeeDetail extends Employee {
  serviceIds: string[];
}

interface Service {
  id: string;
  name: string;
}

export default function EmployeesPage() {
  const { data: session, isPending } = useSession();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [salonId, setSalonId] = useState<string | null>(null);

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editData, setEditData] = useState<EmployeeDetail | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(
    new Set()
  );

  // Fetch the user's salon
  useEffect(() => {
    async function fetchSalon() {
      try {
        const res = await fetch("/api/salons/mine");
        const data = await res.json();
        if (data.success && data.salon) {
          setSalonId(data.salon.id);
        } else {
          setLoading(false);
        }
      } catch {
        setLoading(false);
      }
    }
    if (session?.user) {
      fetchSalon();
    }
  }, [session]);

  const fetchEmployees = useCallback(async () => {
    if (!salonId) return;
    try {
      const res = await fetch(`/api/employees?salonId=${salonId}`);
      const data = await res.json();
      if (data.success) {
        setEmployees(data.data);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [salonId]);

  useEffect(() => {
    if (salonId) {
      fetchEmployees();
    }
  }, [salonId, fetchEmployees]);

  // Cross-tab sync: refetch when another tab modifies employees
  useTabSync("employees", fetchEmployees);

  // Fetch services for the salon (for edit dialog)
  useEffect(() => {
    async function fetchServices() {
      if (!salonId) return;
      try {
        const res = await fetch(`/api/services?salonId=${salonId}`);
        const data = await res.json();
        if (data.success) {
          setServices(data.data);
        }
      } catch {
      }
    }
    if (salonId) {
      fetchServices();
    }
  }, [salonId]);

  const openEditDialog = async (emp: Employee) => {
    setEditOpen(true);
    setEditLoading(true);
    try {
      const res = await fetch(`/api/employees/${emp.id}`);
      const data = await res.json();
      if (data.success) {
        setEditData(data.data);
        setSelectedServiceIds(new Set(data.data.serviceIds));
      } else {
        toast.error("Nie udalo sie pobrac danych pracownika");
        setEditOpen(false);
      }
    } catch {
      toast.error("Blad polaczenia");
      setEditOpen(false);
    } finally {
      setEditLoading(false);
    }
  };

  const handleEditChange = (
    field: keyof EmployeeDetail,
    value: string | boolean
  ) => {
    setEditData((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const toggleService = (serviceId: string) => {
    setSelectedServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) {
        next.delete(serviceId);
      } else {
        next.add(serviceId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!editData) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/employees/${editData.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: editData.firstName,
          lastName: editData.lastName,
          email: editData.email,
          phone: editData.phone,
          role: editData.role,
          isActive: editData.isActive,
          serviceIds: Array.from(selectedServiceIds),
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Pracownik zaktualizowany");
        setEditOpen(false);
        fetchEmployees();
      } else {
        toast.error(data.error || "Nie udalo sie zapisac zmian");
      }
    } catch {
      toast.error("Blad polaczenia");
    } finally {
      setSaving(false);
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
            Musisz sie zalogowac, aby zarzadzac pracownikami
          </p>
        </div>
      </div>
    );
  }

  const roleLabels: Record<string, string> = {
    owner: "Wlasciciel",
    employee: "Pracownik",
    reception: "Recepcja",
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <Users className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Pracownicy</h1>
            <p className="text-muted-foreground text-sm">
              Zarzadzaj zespolem i harmonogramem pracy
            </p>
          </div>
        </div>
        <Button asChild>
          <Link href="/employees/add">
            <UserPlus className="h-4 w-4 mr-2" />
            Dodaj pracownika
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : employees.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              Brak pracownikow. Dodaj pierwszego pracownika, aby rozpoczac.
            </p>
            <Button asChild>
              <Link href="/employees/add">
                <UserPlus className="h-4 w-4 mr-2" />
                Dodaj pracownika
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {employees.map((emp) => (
            <Card key={emp.id} className="hover:shadow-md transition-shadow">
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm"
                    style={{ backgroundColor: emp.color || "#3b82f6" }}
                  >
                    {emp.firstName[0]}{emp.lastName[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {emp.firstName} {emp.lastName}
                      </span>
                      <Badge variant={emp.isActive ? "default" : "secondary"}>
                        {emp.isActive ? "Aktywny" : "Nieaktywny"}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {roleLabels[emp.role] || emp.role}
                      {emp.email && ` · ${emp.email}`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/dashboard/employees/${emp.id}/schedule`}>
                      <Clock className="h-4 w-4 mr-1" />
                      Harmonogram
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditDialog(emp)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Employee Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edytuj pracownika</DialogTitle>
            <DialogDescription>
              Zmien dane pracownika i przypisane uslugi.
            </DialogDescription>
          </DialogHeader>

          {editLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : editData ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-firstName">Imie *</Label>
                  <Input
                    id="edit-firstName"
                    value={editData.firstName}
                    onChange={(e) =>
                      handleEditChange("firstName", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-lastName">Nazwisko *</Label>
                  <Input
                    id="edit-lastName"
                    value={editData.lastName}
                    onChange={(e) =>
                      handleEditChange("lastName", e.target.value)
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editData.email || ""}
                  onChange={(e) => handleEditChange("email", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-phone">Telefon</Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  value={editData.phone || ""}
                  onChange={(e) => handleEditChange("phone", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-role">Rola</Label>
                <select
                  id="edit-role"
                  value={editData.role}
                  onChange={(e) => handleEditChange("role", e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="employee">Pracownik</option>
                  <option value="owner">Wlasciciel</option>
                  <option value="reception">Recepcja</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="edit-active">Aktywny</Label>
                <Switch
                  id="edit-active"
                  checked={editData.isActive}
                  onCheckedChange={(checked) =>
                    handleEditChange("isActive", checked)
                  }
                />
              </div>

              {/* Service assignments */}
              {services.length > 0 && (
                <div className="space-y-2">
                  <Label>Przypisane uslugi</Label>
                  <div className="border rounded-md p-3 space-y-2 max-h-48 overflow-y-auto">
                    {services.map((service) => (
                      <div
                        key={service.id}
                        className="flex items-center gap-2"
                      >
                        <Checkbox
                          id={`service-${service.id}`}
                          checked={selectedServiceIds.has(service.id)}
                          onCheckedChange={() => toggleService(service.id)}
                        />
                        <label
                          htmlFor={`service-${service.id}`}
                          className="text-sm cursor-pointer"
                        >
                          {service.name}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={saving}
            >
              Anuluj
            </Button>
            <Button onClick={handleSave} disabled={saving || editLoading}>
              {saving ? "Zapisywanie..." : "Zapisz"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
