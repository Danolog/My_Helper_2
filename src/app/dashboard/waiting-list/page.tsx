"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Clock,
  Bell,
  Check,
  X,
  Trash2,
  Plus,
  ArrowLeft,
  Users,
  Scissors,
  User,
  CalendarDays,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface WaitingListEntry {
  id: string;
  salonId: string;
  clientId: string;
  clientName: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  serviceId: string | null;
  serviceName: string | null;
  preferredEmployeeId: string | null;
  preferredEmployeeName: string | null;
  preferredDate: string | null;
  notifiedAt: string | null;
  accepted: boolean | null;
  createdAt: string;
}

interface ClientOption {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
}

interface ServiceOption {
  id: string;
  name: string;
}

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
}

function getStatusBadge(entry: WaitingListEntry) {
  if (entry.accepted === true) {
    return <Badge className="bg-green-500 text-white">Zaakceptowane</Badge>;
  }
  if (entry.accepted === false) {
    return <Badge variant="destructive">Odrzucone</Badge>;
  }
  if (entry.notifiedAt) {
    return <Badge className="bg-yellow-500 text-white">Powiadomiony</Badge>;
  }
  return <Badge variant="secondary">Oczekuje</Badge>;
}

export default function WaitingListPage() {
  const [entries, setEntries] = useState<WaitingListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchEntries = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/waiting-list?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setEntries(data.data || []);
      }
    } catch (error) {
      console.error("Failed to fetch waiting list:", error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchOptions = useCallback(async () => {
    try {
      const [clientsRes, servicesRes, employeesRes] = await Promise.all([
        fetch("/api/clients"),
        fetch("/api/services"),
        fetch("/api/employees"),
      ]);
      const [clientsData, servicesData, employeesData] = await Promise.all([
        clientsRes.json(),
        servicesRes.json(),
        employeesRes.json(),
      ]);
      if (clientsData.success) setClients(clientsData.data || []);
      if (servicesData.success) setServices(servicesData.data || []);
      if (employeesData.success) setEmployees(employeesData.data || []);
    } catch (error) {
      console.error("Failed to fetch options:", error);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  const handleAdd = async () => {
    if (!selectedClientId) {
      toast.error("Wybierz klienta");
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, string> = { clientId: selectedClientId };
      if (selectedServiceId) body.serviceId = selectedServiceId;
      if (selectedEmployeeId) body.preferredEmployeeId = selectedEmployeeId;
      if (preferredDate) body.preferredDate = new Date(preferredDate).toISOString();

      const res = await fetch("/api/waiting-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Dodano do listy oczekujacych");
        setAddDialogOpen(false);
        setSelectedClientId("");
        setSelectedServiceId("");
        setSelectedEmployeeId("");
        setPreferredDate("");
        fetchEntries();
      } else {
        toast.error(data.error || "Blad podczas dodawania");
      }
    } catch {
      toast.error("Blad polaczenia");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/waiting-list/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        toast.success("Usunieto z listy oczekujacych");
        fetchEntries();
      } else {
        toast.error(data.error || "Blad podczas usuwania");
      }
    } catch {
      toast.error("Blad polaczenia");
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("pl-PL", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <h1 className="text-3xl font-bold">Lista oczekujacych</h1>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filtruj status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wszystkie</SelectItem>
              <SelectItem value="pending">Oczekujace</SelectItem>
              <SelectItem value="notified">Powiadomione</SelectItem>
              <SelectItem value="accepted">Zaakceptowane</SelectItem>
              <SelectItem value="declined">Odrzucone</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => fetchEntries()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Dodaj do listy
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Dodaj klienta do listy oczekujacych</DialogTitle>
              <DialogDescription>
                Klient zostanie powiadomiony gdy zwolni sie termin.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Klient *</Label>
                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Wybierz klienta" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.firstName} {c.lastName} {c.phone ? `(${c.phone})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Usluga (opcjonalnie)</Label>
                <Select value={selectedServiceId} onValueChange={setSelectedServiceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Dowolna usluga" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Dowolna usluga</SelectItem>
                    {services.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Preferowany pracownik (opcjonalnie)</Label>
                <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Dowolny pracownik" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Dowolny pracownik</SelectItem>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.firstName} {e.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Preferowana data (opcjonalnie)</Label>
                <Input
                  type="datetime-local"
                  value={preferredDate}
                  onChange={(e) => setPreferredDate(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                Anuluj
              </Button>
              <Button onClick={handleAdd} disabled={submitting}>
                {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Dodaj
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">Brak wpisow na liscie oczekujacych</p>
            <p className="text-sm mt-1">
              Klienci moga dodac sie do listy oczekujacych gdy brak wolnych terminow.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <Card key={entry.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    <User className="w-4 h-4" />
                    {entry.clientName || "Nieznany klient"}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(entry)}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(entry.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  {entry.serviceName && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Scissors className="w-3.5 h-3.5" />
                      <span>{entry.serviceName}</span>
                    </div>
                  )}
                  {entry.preferredEmployeeName && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Users className="w-3.5 h-3.5" />
                      <span>{entry.preferredEmployeeName}</span>
                    </div>
                  )}
                  {entry.preferredDate && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <CalendarDays className="w-3.5 h-3.5" />
                      <span>{formatDate(entry.preferredDate)}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Dodano: {formatDate(entry.createdAt)}</span>
                  </div>
                </div>
                {entry.clientPhone && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Tel: {entry.clientPhone}
                    {entry.clientEmail && ` | Email: ${entry.clientEmail}`}
                  </div>
                )}
                {entry.notifiedAt && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Bell className="w-3 h-3" />
                    Powiadomiono: {formatDate(entry.notifiedAt)}
                    {entry.accepted === true && (
                      <span className="flex items-center gap-1 text-green-600 ml-2">
                        <Check className="w-3 h-3" /> Zaakceptowane
                      </span>
                    )}
                    {entry.accepted === false && (
                      <span className="flex items-center gap-1 text-red-600 ml-2">
                        <X className="w-3 h-3" /> Odrzucone
                      </span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-4 text-sm text-muted-foreground text-center">
        Laczna liczba wpisow: {entries.length}
      </div>
    </div>
  );
}
