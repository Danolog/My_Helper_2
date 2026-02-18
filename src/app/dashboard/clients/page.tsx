"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  Lock,
  Users,
  Plus,
  Phone,
  Mail,
  Search,
  UserPlus,
  StickyNote,
  AlertTriangle,
  Filter,
  X,
  Calendar,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

interface Client {
  id: string;
  salonId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  preferences: string | null;
  allergies: string | null;
  favoriteEmployeeId: string | null;
  createdAt: string;
  updatedAt: string;
  lastVisit: string | null;
}

export default function ClientsPage() {
  const { data: session, isPending } = useSession();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Filter state
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateAddedFrom, setDateAddedFrom] = useState("");
  const [dateAddedTo, setDateAddedTo] = useState("");
  const [lastVisitFrom, setLastVisitFrom] = useState("");
  const [lastVisitTo, setLastVisitTo] = useState("");
  const [filterHasAllergies, setFilterHasAllergies] = useState(false);

  // Track whether filters are actively applied (after clicking "Filtruj")
  const [appliedFilters, setAppliedFilters] = useState({
    dateAddedFrom: "",
    dateAddedTo: "",
    lastVisitFrom: "",
    lastVisitTo: "",
    hasAllergies: false,
  });

  // Form state
  const [formFirstName, setFormFirstName] = useState("");
  const [formLastName, setFormLastName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formNotes, setFormNotes] = useState("");

  // Form validation errors
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const hasActiveFilters =
    appliedFilters.dateAddedFrom !== "" ||
    appliedFilters.dateAddedTo !== "" ||
    appliedFilters.lastVisitFrom !== "" ||
    appliedFilters.lastVisitTo !== "" ||
    appliedFilters.hasAllergies;

  const activeFilterCount = [
    appliedFilters.dateAddedFrom || appliedFilters.dateAddedTo ? 1 : 0,
    appliedFilters.lastVisitFrom || appliedFilters.lastVisitTo ? 1 : 0,
    appliedFilters.hasAllergies ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const fetchClients = useCallback(
    async (filters?: {
      dateAddedFrom: string;
      dateAddedTo: string;
      lastVisitFrom: string;
      lastVisitTo: string;
      hasAllergies: boolean;
    }) => {
      try {
        const params = new URLSearchParams({
          salonId: DEMO_SALON_ID,
        });

        const f = filters || appliedFilters;

        if (f.dateAddedFrom) {
          params.set("dateAddedFrom", new Date(f.dateAddedFrom).toISOString());
        }
        if (f.dateAddedTo) {
          // Set to end of day
          const endDate = new Date(f.dateAddedTo);
          endDate.setHours(23, 59, 59, 999);
          params.set("dateAddedTo", endDate.toISOString());
        }
        if (f.lastVisitFrom) {
          params.set("lastVisitFrom", f.lastVisitFrom);
        }
        if (f.lastVisitTo) {
          params.set("lastVisitTo", f.lastVisitTo);
        }
        if (f.hasAllergies) {
          params.set("hasAllergies", "true");
        }

        const res = await fetch(`/api/clients?${params.toString()}`);
        const data = await res.json();
        if (data.success) {
          setClients(data.data);
        }
      } catch (error) {
        console.error("Failed to fetch clients:", error);
      }
    },
    [appliedFilters]
  );

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      await fetchClients();
      setLoading(false);
    }
    loadData();
  }, [fetchClients]);

  const handleApplyFilters = async () => {
    const newFilters = {
      dateAddedFrom,
      dateAddedTo,
      lastVisitFrom,
      lastVisitTo,
      hasAllergies: filterHasAllergies,
    };
    setAppliedFilters(newFilters);
    setLoading(true);
    await fetchClients(newFilters);
    setLoading(false);
    toast.success("Filtry zastosowane");
  };

  const handleClearFilters = async () => {
    setDateAddedFrom("");
    setDateAddedTo("");
    setLastVisitFrom("");
    setLastVisitTo("");
    setFilterHasAllergies(false);
    const emptyFilters = {
      dateAddedFrom: "",
      dateAddedTo: "",
      lastVisitFrom: "",
      lastVisitTo: "",
      hasAllergies: false,
    };
    setAppliedFilters(emptyFilters);
    setLoading(true);
    await fetchClients(emptyFilters);
    setLoading(false);
    toast.success("Filtry wyczyszczone");
  };

  const resetForm = () => {
    setFormFirstName("");
    setFormLastName("");
    setFormPhone("");
    setFormEmail("");
    setFormNotes("");
    setFormErrors({});
  };

  const clearFieldError = (field: string) => {
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validateClientForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!formFirstName.trim()) {
      errors.firstName = "Imie jest wymagane";
    }
    if (!formLastName.trim()) {
      errors.lastName = "Nazwisko jest wymagane";
    }
    if (formEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail.trim())) {
      errors.email = "Wprowadz poprawny adres email";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveClient = async () => {
    if (!validateClientForm()) {
      toast.error("Wypelnij wymagane pola");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonId: DEMO_SALON_ID,
          firstName: formFirstName.trim(),
          lastName: formLastName.trim(),
          phone: formPhone.trim() || null,
          email: formEmail.trim() || null,
          notes: formNotes.trim() || null,
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(
          `Klient "${formFirstName.trim()} ${formLastName.trim()}" zostal dodany`
        );
        resetForm();
        setDialogOpen(false);
        await fetchClients();
      } else {
        toast.error(data.error || "Nie udalo sie dodac klienta");
      }
    } catch (error) {
      console.error("Failed to save client:", error);
      toast.error("Blad podczas zapisywania klienta");
    } finally {
      setSaving(false);
    }
  };

  // Filter clients by search query (client-side text search on top of server-side date filters)
  const filteredClients = clients.filter((client) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      client.firstName.toLowerCase().includes(query) ||
      client.lastName.toLowerCase().includes(query) ||
      (client.phone && client.phone.toLowerCase().includes(query)) ||
      (client.email && client.email.toLowerCase().includes(query))
    );
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("pl-PL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return null;
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
            Musisz sie zalogowac, aby zarzadzac klientami
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <Users className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Klienci</h1>
            <p className="text-muted-foreground text-sm">
              Zarzadzaj baza klientow salonu
            </p>
          </div>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="add-client-btn">
              <Plus className="h-4 w-4 mr-2" />
              Dodaj klienta
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Dodaj nowego klienta</DialogTitle>
              <DialogDescription>
                Wypelnij formularz, aby dodac nowego klienta do bazy salonu.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="client-first-name">Imie *</Label>
                  <Input
                    id="client-first-name"
                    placeholder="np. Jan"
                    value={formFirstName}
                    onChange={(e) => {
                      setFormFirstName(e.target.value);
                      if (e.target.value.trim()) clearFieldError("firstName");
                    }}
                    required
                    aria-invalid={!!formErrors.firstName}
                    className={formErrors.firstName ? "border-destructive" : ""}
                    data-testid="client-first-name-input"
                  />
                  {formErrors.firstName && (
                    <p className="text-sm text-destructive" data-testid="error-first-name">
                      {formErrors.firstName}
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="client-last-name">Nazwisko *</Label>
                  <Input
                    id="client-last-name"
                    placeholder="np. Kowalski"
                    value={formLastName}
                    onChange={(e) => {
                      setFormLastName(e.target.value);
                      if (e.target.value.trim()) clearFieldError("lastName");
                    }}
                    required
                    aria-invalid={!!formErrors.lastName}
                    className={formErrors.lastName ? "border-destructive" : ""}
                    data-testid="client-last-name-input"
                  />
                  {formErrors.lastName && (
                    <p className="text-sm text-destructive" data-testid="error-last-name">
                      {formErrors.lastName}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="client-phone">Numer telefonu</Label>
                <Input
                  id="client-phone"
                  type="tel"
                  placeholder="np. +48 600 123 456"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  data-testid="client-phone-input"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="client-email">Adres email</Label>
                <Input
                  id="client-email"
                  type="email"
                  placeholder="np. jan.kowalski@example.com"
                  value={formEmail}
                  onChange={(e) => {
                    setFormEmail(e.target.value);
                    clearFieldError("email");
                  }}
                  aria-invalid={!!formErrors.email}
                  data-testid="client-email-input"
                />
                {formErrors.email && (
                  <p className="text-sm text-destructive">{formErrors.email}</p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="client-notes">Notatki</Label>
                <Textarea
                  id="client-notes"
                  placeholder="Dodatkowe informacje o kliencie..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  rows={3}
                  data-testid="client-notes-input"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  resetForm();
                  setDialogOpen(false);
                }}
              >
                Anuluj
              </Button>
              <Button
                onClick={handleSaveClient}
                disabled={saving}
                data-testid="save-client-btn"
              >
                {saving ? "Zapisywanie..." : "Zapisz klienta"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Szukaj klienta po imieniu, nazwisku, telefonie lub emailu..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
          data-testid="client-search-input"
        />
      </div>

      {/* Filter toggle button */}
      <div className="flex items-center gap-2 mb-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFiltersOpen(!filtersOpen)}
          data-testid="toggle-filters-btn"
          className="flex items-center gap-2"
        >
          <Filter className="h-4 w-4" />
          Filtry
          {hasActiveFilters && (
            <Badge variant="default" className="ml-1 text-xs px-1.5 py-0" data-testid="active-filter-count">
              {activeFilterCount}
            </Badge>
          )}
          {filtersOpen ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </Button>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearFilters}
            data-testid="clear-filters-btn"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4 mr-1" />
            Wyczysc filtry
          </Button>
        )}
      </div>

      {/* Active filter badges */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-2 mb-4" data-testid="active-filters-badges">
          {(appliedFilters.dateAddedFrom || appliedFilters.dateAddedTo) && (
            <Badge variant="secondary" className="text-xs gap-1" data-testid="filter-badge-date-added">
              <Calendar className="h-3 w-3" />
              Data dodania: {appliedFilters.dateAddedFrom || "..."} - {appliedFilters.dateAddedTo || "..."}
            </Badge>
          )}
          {(appliedFilters.lastVisitFrom || appliedFilters.lastVisitTo) && (
            <Badge variant="secondary" className="text-xs gap-1" data-testid="filter-badge-last-visit">
              <Calendar className="h-3 w-3" />
              Ostatnia wizyta: {appliedFilters.lastVisitFrom || "..."} - {appliedFilters.lastVisitTo || "..."}
            </Badge>
          )}
          {appliedFilters.hasAllergies && (
            <Badge variant="secondary" className="text-xs gap-1" data-testid="filter-badge-allergies">
              <AlertTriangle className="h-3 w-3" />
              Z alergiami
            </Badge>
          )}
        </div>
      )}

      {/* Filter panel */}
      {filtersOpen && (
        <Card className="mb-6" data-testid="filter-panel">
          <CardContent className="p-4">
            <div className="grid gap-4">
              {/* Date Added filter row */}
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  Data dodania klienta
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="filter-date-added-from" className="text-xs text-muted-foreground">
                      Od
                    </Label>
                    <Input
                      id="filter-date-added-from"
                      type="date"
                      value={dateAddedFrom}
                      onChange={(e) => setDateAddedFrom(e.target.value)}
                      data-testid="filter-date-added-from"
                    />
                  </div>
                  <div>
                    <Label htmlFor="filter-date-added-to" className="text-xs text-muted-foreground">
                      Do
                    </Label>
                    <Input
                      id="filter-date-added-to"
                      type="date"
                      value={dateAddedTo}
                      onChange={(e) => setDateAddedTo(e.target.value)}
                      data-testid="filter-date-added-to"
                    />
                  </div>
                </div>
              </div>

              {/* Last Visit filter row */}
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  Ostatnia wizyta
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="filter-last-visit-from" className="text-xs text-muted-foreground">
                      Od
                    </Label>
                    <Input
                      id="filter-last-visit-from"
                      type="date"
                      value={lastVisitFrom}
                      onChange={(e) => setLastVisitFrom(e.target.value)}
                      data-testid="filter-last-visit-from"
                    />
                  </div>
                  <div>
                    <Label htmlFor="filter-last-visit-to" className="text-xs text-muted-foreground">
                      Do
                    </Label>
                    <Input
                      id="filter-last-visit-to"
                      type="date"
                      value={lastVisitTo}
                      onChange={(e) => setLastVisitTo(e.target.value)}
                      data-testid="filter-last-visit-to"
                    />
                  </div>
                </div>
              </div>

              {/* Has Allergies filter */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="filter-has-allergies"
                  checked={filterHasAllergies}
                  onCheckedChange={(checked) =>
                    setFilterHasAllergies(checked === true)
                  }
                  data-testid="filter-has-allergies"
                />
                <Label htmlFor="filter-has-allergies" className="text-sm cursor-pointer">
                  Tylko klienci z alergiami
                </Label>
              </div>

              {/* Filter action buttons */}
              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={handleApplyFilters}
                  data-testid="apply-filters-btn"
                >
                  <Filter className="h-4 w-4 mr-2" />
                  Filtruj
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearFilters}
                  data-testid="clear-filters-panel-btn"
                >
                  <X className="h-4 w-4 mr-2" />
                  Wyczysc
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Clients list */}
      {loading ? (
        <div className="flex justify-center items-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : clients.length === 0 && !hasActiveFilters ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <UserPlus className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              Brak klientow. Dodaj pierwszego klienta, aby rozpoczac.
            </p>
            <Button
              onClick={() => setDialogOpen(true)}
              data-testid="empty-state-add-client-btn"
            >
              <Plus className="h-4 w-4 mr-2" />
              Dodaj klienta
            </Button>
          </CardContent>
        </Card>
      ) : clients.length === 0 && hasActiveFilters ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Filter className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-2" data-testid="no-filter-results">
              Brak klientow pasujacych do wybranych filtrow
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearFilters}
              className="mt-2"
            >
              <X className="h-4 w-4 mr-1" />
              Wyczysc filtry
            </Button>
          </CardContent>
        </Card>
      ) : filteredClients.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Search className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Nie znaleziono klientow pasujacych do &quot;{searchQuery}&quot;
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground mb-2" data-testid="clients-count-text">
            {hasActiveFilters
              ? `Wyniki filtrowania: ${filteredClients.length} klientow`
              : filteredClients.length === clients.length
                ? `Liczba klientow: ${clients.length}`
                : `Wyniki wyszukiwania: ${filteredClients.length} z ${clients.length}`}
          </p>
          {filteredClients.map((client) => {
            const clientAllergies = client.allergies
              ? client.allergies
                  .split(",")
                  .map((a) => a.trim())
                  .filter((a) => a.length > 0)
              : [];
            const hasAllergies = clientAllergies.length > 0;
            const lastVisitFormatted = formatDate(client.lastVisit);
            const createdAtFormatted = formatDate(client.createdAt);

            return (
              <Link
                key={client.id}
                href={`/dashboard/clients/${client.id}`}
                className="block"
                data-testid={`client-link-${client.id}`}
              >
                <Card
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  data-testid={`client-card-${client.id}`}
                >
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-base" data-testid={`client-name-${client.id}`}>
                          {client.firstName} {client.lastName}
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          Klient
                        </Badge>
                        {hasAllergies && (
                          <AlertTriangle
                            className="h-4 w-4 text-orange-500"
                            data-testid={`client-allergy-icon-${client.id}`}
                          />
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                        {client.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5" />
                            {client.phone}
                          </span>
                        )}
                        {client.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3.5 w-3.5" />
                            {client.email}
                          </span>
                        )}
                        {client.notes && (
                          <span className="flex items-center gap-1">
                            <StickyNote className="h-3.5 w-3.5" />
                            {client.notes.length > 50
                              ? client.notes.substring(0, 50) + "..."
                              : client.notes}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                        {createdAtFormatted && (
                          <span data-testid={`client-created-${client.id}`}>
                            Dodano: {createdAtFormatted}
                          </span>
                        )}
                        {lastVisitFormatted && (
                          <span data-testid={`client-last-visit-${client.id}`}>
                            Ostatnia wizyta: {lastVisitFormatted}
                          </span>
                        )}
                      </div>
                      {hasAllergies && (
                        <div
                          className="flex flex-wrap items-center gap-1.5 mt-2"
                          data-testid={`client-allergies-${client.id}`}
                        >
                          <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                          {clientAllergies.map((allergy, idx) => (
                            <Badge
                              key={`${allergy}-${idx}`}
                              variant="destructive"
                              className="text-xs"
                            >
                              {allergy}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
