"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Lock,
  ArrowLeft,
  User,
  Phone,
  Mail,
  StickyNote,
  AlertTriangle,
  Plus,
  X,
  Save,
  Heart,
  Star,
  Calendar,
  Clock,
  ChevronDown,
  ChevronUp,
  Scissors,
  History,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface ClientData {
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
}

interface AppointmentEmployee {
  id: string;
  firstName: string;
  lastName: string;
  color: string | null;
}

interface AppointmentService {
  id: string;
  name: string;
  basePrice: string;
  baseDuration: number;
}

interface AppointmentData {
  id: string;
  salonId: string;
  clientId: string;
  employeeId: string;
  serviceId: string | null;
  startTime: string;
  endTime: string;
  status: string;
  notes: string | null;
  depositAmount: string | null;
  depositPaid: boolean;
  createdAt: string;
  updatedAt: string;
  employee: AppointmentEmployee | null;
  service: AppointmentService | null;
}

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";
const NO_FAVORITE = "__none__";

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  color: string | null;
}

/**
 * Parses a comma-separated string into an array of trimmed, non-empty entries.
 */
function parseCommaSeparated(str: string | null): string[] {
  if (!str) return [];
  return str
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Serializes an array of strings back to a comma-separated string,
 * or null if the array is empty.
 */
function serializeCommaSeparated(items: string[]): string | null {
  if (items.length === 0) return null;
  return items.join(", ");
}

/**
 * Returns a Polish label for appointment status.
 */
function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    scheduled: "Zaplanowana",
    confirmed: "Potwierdzona",
    completed: "Zakonczona",
    cancelled: "Anulowana",
    no_show: "Nieobecnosc",
  };
  return labels[status] || status;
}

/**
 * Returns badge variant for appointment status.
 */
function getStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "confirmed":
      return "secondary";
    case "cancelled":
    case "no_show":
      return "destructive";
    default:
      return "outline";
  }
}

/**
 * Formats a duration in minutes to a readable string.
 */
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}min`;
}

export default function ClientProfilePage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.id as string;
  const { data: session, isPending } = useSession();

  const [client, setClient] = useState<ClientData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Visit history state
  const [visitHistory, setVisitHistory] = useState<AppointmentData[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedAppointmentId, setExpandedAppointmentId] = useState<string | null>(null);

  // Editable form fields
  const [formNotes, setFormNotes] = useState("");
  const [allergiesList, setAllergiesList] = useState<string[]>([]);
  const [newAllergyInput, setNewAllergyInput] = useState("");
  const [preferencesList, setPreferencesList] = useState<string[]>([]);
  const [newPreferenceInput, setNewPreferenceInput] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedFavoriteEmployeeId, setSelectedFavoriteEmployeeId] = useState<string>("");

  const fetchClient = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}`);
      const data = await res.json();
      if (data.success) {
        const clientData = data.data as ClientData;
        setClient(clientData);
        setFormNotes(clientData.notes || "");
        setAllergiesList(parseCommaSeparated(clientData.allergies));
        setPreferencesList(parseCommaSeparated(clientData.preferences));
        setSelectedFavoriteEmployeeId(clientData.favoriteEmployeeId || "");
      } else {
        toast.error("Nie znaleziono klienta");
        router.push("/dashboard/clients");
      }
    } catch (error) {
      console.error("Failed to fetch client:", error);
      toast.error("Blad podczas ladowania danych klienta");
    } finally {
      setLoading(false);
    }
  }, [clientId, router]);

  const fetchVisitHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/appointments`);
      const data = await res.json();
      if (data.success) {
        setVisitHistory(data.data as AppointmentData[]);
      } else {
        console.error("Failed to fetch visit history:", data.error);
        toast.error("Nie udalo sie zaladowac historii wizyt");
      }
    } catch (error) {
      console.error("Failed to fetch visit history:", error);
      toast.error("Blad podczas ladowania historii wizyt");
    } finally {
      setLoadingHistory(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchClient();
  }, [fetchClient]);

  useEffect(() => {
    async function fetchEmployees() {
      try {
        const res = await fetch(`/api/employees?salonId=${DEMO_SALON_ID}&activeOnly=true`);
        const data = await res.json();
        if (data.success) {
          setEmployees(data.data);
        }
      } catch (error) {
        console.error("Failed to fetch employees:", error);
      }
    }
    fetchEmployees();
  }, []);

  const handleTabChange = (value: string) => {
    if (value === "history" && visitHistory.length === 0 && !loadingHistory) {
      fetchVisitHistory();
    }
  };

  const toggleAppointmentExpanded = (appointmentId: string) => {
    setExpandedAppointmentId((prev) =>
      prev === appointmentId ? null : appointmentId
    );
  };

  const handleAddAllergy = () => {
    const trimmed = newAllergyInput.trim();
    if (!trimmed) {
      toast.error("Wpisz nazwe alergii");
      return;
    }
    if (allergiesList.some((a) => a.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("Ta alergia jest juz na liscie");
      return;
    }
    setAllergiesList((prev) => [...prev, trimmed]);
    setNewAllergyInput("");
  };

  const handleRemoveAllergy = (index: number) => {
    setAllergiesList((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAllergyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddAllergy();
    }
  };

  const handleAddPreference = () => {
    const trimmed = newPreferenceInput.trim();
    if (!trimmed) {
      toast.error("Wpisz preferencje klienta");
      return;
    }
    if (
      preferencesList.some((p) => p.toLowerCase() === trimmed.toLowerCase())
    ) {
      toast.error("Ta preferencja jest juz na liscie");
      return;
    }
    setPreferencesList((prev) => [...prev, trimmed]);
    setNewPreferenceInput("");
  };

  const handleRemovePreference = (index: number) => {
    setPreferencesList((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePreferenceKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddPreference();
    }
  };

  const handleSave = async () => {
    if (!client) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: formNotes.trim() || null,
          preferences: serializeCommaSeparated(preferencesList),
          allergies: serializeCommaSeparated(allergiesList),
          favoriteEmployeeId: selectedFavoriteEmployeeId || null,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setClient(data.data as ClientData);
        toast.success("Dane klienta zostaly zapisane");
      } else {
        toast.error(data.error || "Nie udalo sie zapisac danych klienta");
      }
    } catch (error) {
      console.error("Failed to save client:", error);
      toast.error("Blad podczas zapisywania danych klienta");
    } finally {
      setSaving(false);
    }
  };

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
            Musisz sie zalogowac, aby zarzadzac klientami
          </p>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <p className="text-muted-foreground">Nie znaleziono klienta</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      {/* Header with back button */}
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push("/dashboard/clients")}
          data-testid="back-to-clients-btn"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3 flex-1">
          <User className="w-8 h-8 text-primary" />
          <div>
            <h1
              className="text-2xl font-bold"
              data-testid="client-profile-name"
            >
              {client.firstName} {client.lastName}
            </h1>
            <p className="text-muted-foreground text-sm">Profil klienta</p>
          </div>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          data-testid="save-client-btn"
        >
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Zapisywanie..." : "Zapisz zmiany"}
        </Button>
      </div>

      {/* Allergy warning banner - displayed prominently when allergies exist */}
      {allergiesList.length > 0 && (
        <div
          className="flex items-start gap-3 p-4 mb-6 rounded-lg border border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30"
          data-testid="allergy-warning-banner"
        >
          <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-orange-800 dark:text-orange-300">
              Uwaga - alergie klienta
            </p>
            <p className="text-sm text-orange-700 dark:text-orange-400 mt-1">
              {allergiesList.join(", ")}
            </p>
          </div>
        </div>
      )}

      {/* Preferences info banner - displayed when preferences exist */}
      {preferencesList.length > 0 && (
        <div
          className="flex items-start gap-3 p-4 mb-6 rounded-lg border border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30"
          data-testid="preferences-info-banner"
        >
          <StickyNote className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-blue-800 dark:text-blue-300">
              Preferencje klienta
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
              {preferencesList.join(", ")}
            </p>
          </div>
        </div>
      )}

      {/* Tabs: Profile and Visit History */}
      <Tabs defaultValue="profile" onValueChange={handleTabChange}>
        <TabsList className="mb-6" data-testid="client-tabs">
          <TabsTrigger value="profile" data-testid="tab-profile">
            <User className="h-4 w-4 mr-1" />
            Profil
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            <History className="h-4 w-4 mr-1" />
            Historia wizyt
          </TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile">
          {/* Client info card */}
          <Card className="mb-6" data-testid="client-info-card">
            <CardHeader>
              <CardTitle className="text-lg">Dane kontaktowe</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">
                    {client.firstName} {client.lastName}
                  </span>
                </div>
                {client.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span data-testid="client-phone">{client.phone}</span>
                  </div>
                )}
                {client.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span data-testid="client-email">{client.email}</span>
                  </div>
                )}
                {!client.phone && !client.email && (
                  <p className="text-sm text-muted-foreground col-span-2">
                    Brak danych kontaktowych
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Favorite employee section */}
          <Card className="mb-6" data-testid="favorite-employee-card">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Star className="h-5 w-5 text-yellow-500" />
                <CardTitle className="text-lg">Ulubiony pracownik</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Label className="text-sm text-muted-foreground">
                  Wybierz ulubionego pracownika klienta
                </Label>
                <Select
                  value={selectedFavoriteEmployeeId || NO_FAVORITE}
                  onValueChange={(value) =>
                    setSelectedFavoriteEmployeeId(value === NO_FAVORITE ? "" : value)
                  }
                >
                  <SelectTrigger className="w-full max-w-sm" data-testid="favorite-employee-select">
                    <SelectValue placeholder="Wybierz pracownika" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_FAVORITE}>Brak ulubionego pracownika</SelectItem>
                    {employees.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.firstName} {employee.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedFavoriteEmployeeId && (() => {
                  const favEmployee = employees.find((e) => e.id === selectedFavoriteEmployeeId);
                  if (!favEmployee) return null;
                  return (
                    <div className="flex items-center gap-2 mt-2">
                      <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                      <Badge
                        variant="secondary"
                        className="px-3 py-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300"
                      >
                        {favEmployee.firstName} {favEmployee.lastName}
                      </Badge>
                    </div>
                  );
                })()}
              </div>
            </CardContent>
          </Card>

          {/* Health & Preferences section */}
          <Card className="mb-6" data-testid="health-preferences-card">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Heart className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Zdrowie i preferencje</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Allergies section */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  <Label className="text-base font-medium">Alergie</Label>
                </div>

                {allergiesList.length === 0 ? (
                  <p
                    className="text-sm text-muted-foreground mb-3"
                    data-testid="no-allergies-message"
                  >
                    Brak alergii
                  </p>
                ) : (
                  <div
                    className="flex flex-wrap gap-2 mb-3"
                    data-testid="allergies-list"
                  >
                    {allergiesList.map((allergy, index) => (
                      <Badge
                        key={`${allergy}-${index}`}
                        variant="destructive"
                        className="flex items-center gap-1 px-3 py-1"
                        data-testid={`allergy-badge-${index}`}
                      >
                        {allergy}
                        <button
                          type="button"
                          onClick={() => handleRemoveAllergy(index)}
                          className="ml-1 hover:bg-destructive/80 rounded-full p-0.5"
                          aria-label={`Usun alergie: ${allergy}`}
                          data-testid={`remove-allergy-${index}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Add allergy form */}
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="np. Latex, Parafenylodiamina (PPD)"
                    value={newAllergyInput}
                    onChange={(e) => setNewAllergyInput(e.target.value)}
                    onKeyDown={handleAllergyKeyDown}
                    className="max-w-sm"
                    data-testid="new-allergy-input"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddAllergy}
                    data-testid="add-allergy-btn"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Dodaj alergie
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Preferences */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <StickyNote className="h-4 w-4 text-blue-500" />
                  <Label className="text-base font-medium">
                    Preferencje klienta
                  </Label>
                </div>

                {preferencesList.length === 0 ? (
                  <p
                    className="text-sm text-muted-foreground mb-3"
                    data-testid="no-preferences-message"
                  >
                    Brak preferencji
                  </p>
                ) : (
                  <div
                    className="flex flex-wrap gap-2 mb-3"
                    data-testid="preferences-list"
                  >
                    {preferencesList.map((preference, index) => (
                      <Badge
                        key={`${preference}-${index}`}
                        variant="secondary"
                        className="flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                        data-testid={`preference-badge-${index}`}
                      >
                        {preference}
                        <button
                          type="button"
                          onClick={() => handleRemovePreference(index)}
                          className="ml-1 hover:bg-blue-200 dark:hover:bg-blue-800 rounded-full p-0.5"
                          aria-label={`Usun preferencje: ${preference}`}
                          data-testid={`remove-preference-${index}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Add preference form */}
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="np. Preferuje kawe, Wrazliwa skora glowy"
                    value={newPreferenceInput}
                    onChange={(e) => setNewPreferenceInput(e.target.value)}
                    onKeyDown={handlePreferenceKeyDown}
                    className="max-w-sm"
                    data-testid="new-preference-input"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddPreference}
                    data-testid="add-preference-btn"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Dodaj preferencje
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Notes */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <StickyNote className="h-4 w-4 text-muted-foreground" />
                  <Label htmlFor="client-notes" className="text-base font-medium">
                    Notatki
                  </Label>
                </div>
                <Textarea
                  id="client-notes"
                  placeholder="Dodatkowe informacje o kliencie..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  rows={3}
                  data-testid="client-notes-input"
                />
              </div>
            </CardContent>
          </Card>

          {/* Client meta info */}
          <Card data-testid="client-meta-card">
            <CardContent className="pt-6">
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>
                  Dodano:{" "}
                  {new Date(client.createdAt).toLocaleDateString("pl-PL", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                <span>
                  Ostatnia aktualizacja:{" "}
                  {new Date(client.updatedAt).toLocaleDateString("pl-PL", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Visit History Tab */}
        <TabsContent value="history">
          <Card data-testid="visit-history-card">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg">Historia wizyt</CardTitle>
                </div>
                <Badge variant="secondary" data-testid="visit-count-badge">
                  {visitHistory.length} {visitHistory.length === 1 ? "wizyta" : visitHistory.length >= 2 && visitHistory.length <= 4 ? "wizyty" : "wizyt"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {loadingHistory ? (
                <div className="flex justify-center items-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : visitHistory.length === 0 ? (
                <div className="text-center py-12" data-testid="no-visits-message">
                  <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p className="text-muted-foreground text-lg font-medium">Brak historii wizyt</p>
                  <p className="text-muted-foreground text-sm mt-1">
                    Ten klient nie ma jeszcze zadnych wizyt
                  </p>
                </div>
              ) : (
                <div className="space-y-3" data-testid="visit-history-list">
                  {visitHistory.map((appointment) => {
                    const isExpanded = expandedAppointmentId === appointment.id;
                    const startDate = new Date(appointment.startTime);
                    const endDate = new Date(appointment.endTime);
                    const durationMs = endDate.getTime() - startDate.getTime();
                    const durationMin = Math.round(durationMs / 60000);

                    return (
                      <div
                        key={appointment.id}
                        className="border rounded-lg overflow-hidden transition-all"
                        data-testid={`appointment-item-${appointment.id}`}
                      >
                        {/* Appointment summary row - clickable */}
                        <button
                          type="button"
                          className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors text-left"
                          onClick={() => toggleAppointmentExpanded(appointment.id)}
                          data-testid={`appointment-toggle-${appointment.id}`}
                        >
                          {/* Date column */}
                          <div className="flex flex-col items-center min-w-[60px]">
                            <span className="text-2xl font-bold text-primary">
                              {startDate.getDate()}
                            </span>
                            <span className="text-xs text-muted-foreground uppercase">
                              {startDate.toLocaleDateString("pl-PL", { month: "short" })}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {startDate.getFullYear()}
                            </span>
                          </div>

                          <Separator orientation="vertical" className="h-12" />

                          {/* Main info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {appointment.service ? (
                                <span className="font-medium truncate" data-testid="appointment-service-name">
                                  {appointment.service.name}
                                </span>
                              ) : (
                                <span className="font-medium text-muted-foreground italic">
                                  Brak uslugi
                                </span>
                              )}
                              <Badge
                                variant={getStatusVariant(appointment.status)}
                                className="text-xs shrink-0"
                                data-testid="appointment-status-badge"
                              >
                                {getStatusLabel(appointment.status)}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5" />
                                {startDate.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
                                {" - "}
                                {endDate.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                              {appointment.employee && (
                                <span className="flex items-center gap-1" data-testid="appointment-employee-name">
                                  <User className="h-3.5 w-3.5" />
                                  {appointment.employee.firstName} {appointment.employee.lastName}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Expand/collapse icon */}
                          <div className="shrink-0">
                            {isExpanded ? (
                              <ChevronUp className="h-5 w-5 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                        </button>

                        {/* Expanded details */}
                        {isExpanded && (
                          <div
                            className="border-t bg-muted/30 p-4 space-y-3"
                            data-testid={`appointment-details-${appointment.id}`}
                          >
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {/* Date and time */}
                              <div>
                                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Data i godzina</p>
                                <p className="text-sm flex items-center gap-1.5">
                                  <Calendar className="h-4 w-4 text-primary" />
                                  {startDate.toLocaleDateString("pl-PL", {
                                    weekday: "long",
                                    day: "numeric",
                                    month: "long",
                                    year: "numeric",
                                  })}
                                </p>
                                <p className="text-sm flex items-center gap-1.5 mt-1">
                                  <Clock className="h-4 w-4 text-primary" />
                                  {startDate.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
                                  {" - "}
                                  {endDate.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
                                  {" "}
                                  <span className="text-muted-foreground">({formatDuration(durationMin)})</span>
                                </p>
                              </div>

                              {/* Service */}
                              <div>
                                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Usluga</p>
                                {appointment.service ? (
                                  <div>
                                    <p className="text-sm flex items-center gap-1.5">
                                      <Scissors className="h-4 w-4 text-primary" />
                                      {appointment.service.name}
                                    </p>
                                    <p className="text-sm text-muted-foreground mt-1">
                                      Cena bazowa: {parseFloat(appointment.service.basePrice).toFixed(2)} PLN
                                      {" | "}
                                      Czas: {formatDuration(appointment.service.baseDuration)}
                                    </p>
                                  </div>
                                ) : (
                                  <p className="text-sm text-muted-foreground italic">Brak przypisanej uslugi</p>
                                )}
                              </div>

                              {/* Employee */}
                              <div>
                                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Pracownik</p>
                                {appointment.employee ? (
                                  <p className="text-sm flex items-center gap-1.5">
                                    <User className="h-4 w-4 text-primary" />
                                    {appointment.employee.firstName} {appointment.employee.lastName}
                                    {appointment.employee.color && (
                                      <span
                                        className="inline-block w-3 h-3 rounded-full border"
                                        style={{ backgroundColor: appointment.employee.color }}
                                      />
                                    )}
                                  </p>
                                ) : (
                                  <p className="text-sm text-muted-foreground italic">Brak pracownika</p>
                                )}
                              </div>

                              {/* Status */}
                              <div>
                                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Status</p>
                                <Badge
                                  variant={getStatusVariant(appointment.status)}
                                  className="text-xs"
                                >
                                  {getStatusLabel(appointment.status)}
                                </Badge>
                              </div>

                              {/* Deposit */}
                              {appointment.depositAmount && (
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Zadatek</p>
                                  <p className="text-sm">
                                    {parseFloat(appointment.depositAmount).toFixed(2)} PLN
                                    {" - "}
                                    <span className={appointment.depositPaid ? "text-green-600" : "text-orange-600"}>
                                      {appointment.depositPaid ? "Oplacony" : "Nieoplacony"}
                                    </span>
                                  </p>
                                </div>
                              )}

                              {/* Notes */}
                              {appointment.notes && (
                                <div className="sm:col-span-2">
                                  <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Notatki</p>
                                  <p className="text-sm">{appointment.notes}</p>
                                </div>
                              )}
                            </div>

                            {/* Appointment ID */}
                            <div className="pt-2 border-t">
                              <p className="text-xs text-muted-foreground">
                                ID wizyty: {appointment.id}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Utworzono: {new Date(appointment.createdAt).toLocaleString("pl-PL")}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
