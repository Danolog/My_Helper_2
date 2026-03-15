"use client";

import Link from "next/link";
import { CalendarPlus, Contact, Scissors, Users, BarChart3, Package, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function DashboardQuickActions() {
  return (
    <Card className="mb-6" data-testid="quick-actions">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Zap className="h-5 w-5 text-primary" />
          Szybkie akcje
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/dashboard/calendar">
              <CalendarPlus className="h-4 w-4 mr-2" />
              Nowa wizyta
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/clients">
              <Contact className="h-4 w-4 mr-2" />
              Dodaj klienta
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/services">
              <Scissors className="h-4 w-4 mr-2" />
              Zarzadzaj uslugami
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/employees">
              <Users className="h-4 w-4 mr-2" />
              Pracownicy
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/reports/revenue">
              <BarChart3 className="h-4 w-4 mr-2" />
              Raporty
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/products">
              <Package className="h-4 w-4 mr-2" />
              Magazyn
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
