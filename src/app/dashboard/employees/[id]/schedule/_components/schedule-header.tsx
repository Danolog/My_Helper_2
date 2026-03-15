"use client";

import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Employee } from "../_hooks/use-schedule-data";

interface ScheduleHeaderProps {
  employee: Employee | null;
  workingDays: number;
  isPending: boolean;
  loading: boolean;
  session: unknown;
}

export function ScheduleHeader({
  employee,
  workingDays,
  isPending,
  loading,
  session,
}: ScheduleHeaderProps) {
  if (isPending || loading) {
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
            Musisz sie zalogowac, aby zarzadzac harmonogramem
          </p>
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-2xl font-bold mb-2">Pracownik nie znaleziony</h1>
          <p className="text-muted-foreground mb-6">
            Nie znaleziono pracownika o podanym ID
          </p>
          <Button asChild>
            <Link href="/dashboard/employees">Powrot do listy</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Back link */}
      <Link
        href="/dashboard/employees"
        className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Powrot do listy pracownikow
      </Link>

      {/* Employee info header */}
      <div className="flex items-center gap-4 mb-6">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold"
          style={{ backgroundColor: employee.color || "#3b82f6" }}
        >
          {employee.firstName[0]}{employee.lastName[0]}
        </div>
        <div>
          <h1 className="text-2xl font-bold">
            {employee.firstName} {employee.lastName}
          </h1>
          <p className="text-muted-foreground text-sm">
            Harmonogram pracy · {workingDays} dni roboczych
          </p>
        </div>
      </div>
    </>
  );
}
