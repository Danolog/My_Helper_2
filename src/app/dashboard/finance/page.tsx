"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  DollarSign,
  Users,
  Percent,
  RefreshCw,
  CalendarDays,
  Settings,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";

interface CommissionRecord {
  id: string;
  employeeId: string;
  appointmentId: string;
  amount: string;
  percentage: string | null;
  paidAt: string | null;
  createdAt: string;
  employeeFirstName: string | null;
  employeeLastName: string | null;
  employeeColor: string | null;
  serviceName: string | null;
  servicePrice: string | null;
  clientFirstName: string | null;
  clientLastName: string | null;
  appointmentDate: string | null;
}

interface EmployeeTotal {
  employeeId: string;
  firstName: string | null;
  lastName: string | null;
  color: string | null;
  commissionRate: string | null;
  totalAmount: string;
  commissionCount: number;
  avgPercentage: string;
}

interface EmployeeRate {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  color: string | null;
  commissionRate: string | null;
  isActive: boolean;
}

interface CommissionsData {
  commissions: CommissionRecord[];
  employeeTotals: EmployeeTotal[];
  summary: {
    totalCommissions: number;
    commissionCount: number;
    employeeCount: number;
  };
}

export default function FinancePage() {
  const { data: session, isPending } = useSession();
  const [data, setData] = useState<CommissionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState("");

  // Commission rate settings
  const [employeeRates, setEmployeeRates] = useState<EmployeeRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [editingRate, setEditingRate] = useState<EmployeeRate | null>(null);
  const [newRate, setNewRate] = useState("");
  const [savingRate, setSavingRate] = useState(false);

  const fetchCommissions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (selectedEmployee) params.set("employeeId", selectedEmployee);

      const res = await fetch(`/api/finance/commissions?${params}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        toast.error("Nie udalo sie pobrac prowizji");
      }
    } catch {
      toast.error("Blad polaczenia z serwerem");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedEmployee]);

  const fetchRates = useCallback(async () => {
    setRatesLoading(true);
    try {
      const res = await fetch("/api/employees/commission-rate");
      const json = await res.json();
      if (json.success) {
        setEmployeeRates(json.data);
      }
    } catch {
    } finally {
      setRatesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) {
      fetchCommissions();
      fetchRates();
    }
  }, [session, fetchCommissions, fetchRates]);

  const handleSaveRate = async () => {
    if (!editingRate) return;
    const rate = parseFloat(newRate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast.error("Prowizja musi byc liczba od 0 do 100");
      return;
    }

    setSavingRate(true);
    try {
      const res = await fetch("/api/employees/commission-rate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: editingRate.id,
          commissionRate: rate,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message);
        setEditingRate(null);
        fetchRates();
      } else {
        toast.error(json.error || "Nie udalo sie zapisac");
      }
    } catch {
      toast.error("Blad polaczenia z serwerem");
    } finally {
      setSavingRate(false);
    }
  };

  if (isPending) {
    return (
      <div className="flex justify-center items-center h-64">Loading...</div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto p-6 text-center">
        <p>Musisz byc zalogowany aby zobaczyc finanse.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Finanse - Prowizje</h1>
          <p className="text-muted-foreground">
            Zarzadzaj prowizjami pracownikow
          </p>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">
            <DollarSign className="h-4 w-4 mr-2" />
            Przeglad prowizji
          </TabsTrigger>
          <TabsTrigger value="details" data-testid="tab-details">
            <CalendarDays className="h-4 w-4 mr-2" />
            Szczegoly
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">
            <Settings className="h-4 w-4 mr-2" />
            Stawki prowizji
          </TabsTrigger>
        </TabsList>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview" className="space-y-6">
          {/* Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-wrap gap-4 items-end">
                <div>
                  <Label>Od daty</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    data-testid="date-from-input"
                  />
                </div>
                <div>
                  <Label>Do daty</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    data-testid="date-to-input"
                  />
                </div>
                <Button
                  onClick={fetchCommissions}
                  variant="outline"
                  data-testid="refresh-btn"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Odswiez
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Summary Cards */}
          {data && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Laczne prowizje
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className="text-2xl font-bold"
                    data-testid="total-commissions"
                  >
                    {data.summary.totalCommissions.toFixed(2)} PLN
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Liczba prowizji
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className="text-2xl font-bold"
                    data-testid="commission-count"
                  >
                    {data.summary.commissionCount}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Pracownicy z prowizja
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className="text-2xl font-bold"
                    data-testid="employee-count"
                  >
                    {data.summary.employeeCount}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Employee Totals */}
          {data && data.employeeTotals.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Prowizje wg pracownikow
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="employee-totals-table">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-3 font-medium">
                          Pracownik
                        </th>
                        <th className="text-right p-3 font-medium">
                          Liczba wizyt
                        </th>
                        <th className="text-right p-3 font-medium">
                          Sredni %
                        </th>
                        <th className="text-right p-3 font-medium">
                          Domyslna stawka
                        </th>
                        <th className="text-right p-3 font-medium">
                          Suma prowizji
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.employeeTotals.map((emp) => (
                        <tr
                          key={emp.employeeId}
                          className="border-b hover:bg-muted/50"
                        >
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-full flex-shrink-0"
                                style={{
                                  backgroundColor: emp.color || "#6b7280",
                                }}
                              />
                              <span className="font-medium">
                                {emp.firstName} {emp.lastName}
                              </span>
                            </div>
                          </td>
                          <td className="p-3 text-right">
                            {emp.commissionCount}
                          </td>
                          <td className="p-3 text-right">
                            <Badge variant="secondary">
                              {parseFloat(emp.avgPercentage).toFixed(0)}%
                            </Badge>
                          </td>
                          <td className="p-3 text-right">
                            <Badge variant="outline">
                              {emp.commissionRate
                                ? `${parseFloat(emp.commissionRate).toFixed(0)}%`
                                : "50%"}
                            </Badge>
                          </td>
                          <td className="p-3 text-right font-semibold">
                            {parseFloat(emp.totalAmount).toFixed(2)} PLN
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {loading && (
            <div className="flex justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && data && data.employeeTotals.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">Brak prowizji</p>
                <p className="text-sm">
                  Prowizje pojawia sie po zakonczeniu wizyt z przypisanym
                  pracownikiem.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* DETAILS TAB */}
        <TabsContent value="details" className="space-y-6">
          {/* Employee Filter */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-wrap gap-4 items-end">
                <div>
                  <Label>Filtruj wg pracownika</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                    value={selectedEmployee}
                    onChange={(e) => setSelectedEmployee(e.target.value)}
                    data-testid="employee-filter"
                  >
                    <option value="">Wszyscy pracownicy</option>
                    {data?.employeeTotals.map((emp) => (
                      <option key={emp.employeeId} value={emp.employeeId}>
                        {emp.firstName} {emp.lastName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Od daty</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Do daty</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
                <Button onClick={fetchCommissions} variant="outline">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Filtruj
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Commission Detail Table */}
          {data && data.commissions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5" />
                  Prowizje za wizyty ({data.commissions.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="commissions-detail-table">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-3 font-medium">Data</th>
                        <th className="text-left p-3 font-medium">
                          Pracownik
                        </th>
                        <th className="text-left p-3 font-medium">Usluga</th>
                        <th className="text-left p-3 font-medium">Klient</th>
                        <th className="text-right p-3 font-medium">
                          Cena uslugi
                        </th>
                        <th className="text-right p-3 font-medium">
                          Prowizja %
                        </th>
                        <th className="text-right p-3 font-medium">
                          Kwota prowizji
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.commissions.map((c) => (
                        <tr
                          key={c.id}
                          className="border-b hover:bg-muted/50"
                        >
                          <td className="p-3">
                            {c.appointmentDate
                              ? new Date(c.appointmentDate).toLocaleDateString(
                                  "pl-PL",
                                  {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric",
                                  }
                                )
                              : new Date(c.createdAt).toLocaleDateString(
                                  "pl-PL",
                                  {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric",
                                  }
                                )}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                style={{
                                  backgroundColor:
                                    c.employeeColor || "#6b7280",
                                }}
                              />
                              {c.employeeFirstName} {c.employeeLastName}
                            </div>
                          </td>
                          <td className="p-3">
                            {c.serviceName || "-"}
                          </td>
                          <td className="p-3">
                            {c.clientFirstName
                              ? `${c.clientFirstName} ${c.clientLastName}`
                              : "-"}
                          </td>
                          <td className="p-3 text-right">
                            {c.servicePrice
                              ? `${parseFloat(c.servicePrice).toFixed(2)} PLN`
                              : "-"}
                          </td>
                          <td className="p-3 text-right">
                            <Badge variant="secondary">
                              {c.percentage
                                ? `${parseFloat(c.percentage).toFixed(0)}%`
                                : "-"}
                            </Badge>
                          </td>
                          <td className="p-3 text-right font-semibold">
                            {parseFloat(c.amount).toFixed(2)} PLN
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 font-bold">
                        <td colSpan={6} className="p-3 text-right">
                          RAZEM:
                        </td>
                        <td
                          className="p-3 text-right"
                          data-testid="detail-total"
                        >
                          {data.summary.totalCommissions.toFixed(2)} PLN
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {!loading && data && data.commissions.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <CalendarDays className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">Brak prowizji do wyswietlenia</p>
                <p className="text-sm">
                  Sprobuj zmienic zakres dat lub filtr pracownika.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* SETTINGS TAB - Commission Rates */}
        <TabsContent value="settings" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Percent className="h-5 w-5" />
                Domyslne stawki prowizji
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Ustaw domyslny procent prowizji dla kazdego pracownika. Ta
                stawka bedzie automatycznie stosowana przy konczeniu wizyt.
              </p>
              {ratesLoading ? (
                <div className="flex justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : employeeRates.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  Brak pracownikow
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="rates-table">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-3 font-medium">
                          Pracownik
                        </th>
                        <th className="text-left p-3 font-medium">Rola</th>
                        <th className="text-right p-3 font-medium">
                          Stawka prowizji
                        </th>
                        <th className="text-right p-3 font-medium">Akcje</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employeeRates.map((emp) => (
                        <tr
                          key={emp.id}
                          className="border-b hover:bg-muted/50"
                        >
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-full flex-shrink-0"
                                style={{
                                  backgroundColor: emp.color || "#6b7280",
                                }}
                              />
                              <span className="font-medium">
                                {emp.firstName} {emp.lastName}
                              </span>
                            </div>
                          </td>
                          <td className="p-3">
                            <Badge variant="outline">
                              {emp.role === "owner"
                                ? "Wlasciciel"
                                : emp.role === "receptionist"
                                  ? "Recepcja"
                                  : "Pracownik"}
                            </Badge>
                          </td>
                          <td className="p-3 text-right">
                            <Badge
                              variant="secondary"
                              className="text-base"
                              data-testid={`rate-${emp.id}`}
                            >
                              {emp.commissionRate
                                ? `${parseFloat(emp.commissionRate).toFixed(0)}%`
                                : "50%"}
                            </Badge>
                          </td>
                          <td className="p-3 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingRate(emp);
                                setNewRate(
                                  emp.commissionRate
                                    ? parseFloat(emp.commissionRate).toString()
                                    : "50"
                                );
                              }}
                              data-testid={`edit-rate-${emp.id}`}
                            >
                              <Settings className="h-3.5 w-3.5 mr-1" />
                              Zmien
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Commission Rate Dialog */}
      <Dialog
        open={!!editingRate}
        onOpenChange={(open) => !open && setEditingRate(null)}
      >
        <DialogContent className="max-w-sm" data-testid="edit-rate-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Percent className="h-5 w-5" />
              Zmien stawke prowizji
            </DialogTitle>
            <DialogDescription>
              {editingRate &&
                `Ustaw domyslna prowizje dla ${editingRate.firstName} ${editingRate.lastName}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="new-rate">Procent prowizji (%)</Label>
              <Input
                id="new-rate"
                type="number"
                min="0"
                max="100"
                step="1"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                data-testid="new-rate-input"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Wartosc od 0% do 100%. Ta stawka bedzie domyslnie stosowana
                przy konczeniu wizyt.
              </p>
            </div>

            {editingRate && (
              <div className="rounded-md border p-3 bg-muted/30 text-sm">
                <p className="text-muted-foreground">
                  Aktualna stawka:{" "}
                  <span className="font-semibold text-foreground">
                    {editingRate.commissionRate
                      ? `${parseFloat(editingRate.commissionRate).toFixed(0)}%`
                      : "50%"}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  Nowa stawka:{" "}
                  <span className="font-semibold text-foreground">
                    {newRate}%
                  </span>
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingRate(null)}
            >
              Anuluj
            </Button>
            <Button
              onClick={handleSaveRate}
              disabled={savingRate}
              data-testid="save-rate-btn"
            >
              {savingRate ? (
                "Zapisywanie..."
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Zapisz
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
