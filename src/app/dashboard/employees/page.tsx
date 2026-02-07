"use client";

import { useState, useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock, Users, Clock, UserPlus, Settings } from "lucide-react";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

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

export default function EmployeesPage() {
  const { data: session, isPending } = useSession();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchEmployees() {
      try {
        const res = await fetch(`/api/employees?salonId=${DEMO_SALON_ID}`);
        const data = await res.json();
        if (data.success) {
          setEmployees(data.data);
        }
      } catch (error) {
        console.error("Failed to fetch employees:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchEmployees();
  }, []);

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
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/dashboard/employees/${emp.id}/schedule`}>
                      <Settings className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
