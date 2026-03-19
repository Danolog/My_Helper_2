"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Lock,
  User,
  StickyNote,
  AlertTriangle,
  History,
  Award,
  Brain,
} from "lucide-react";
import { toast } from "sonner";
import { ClientHistoryTab } from "@/components/clients/client-history-tab";
import { ClientInsightsTab } from "@/components/clients/client-insights-tab";
import { ClientLoyaltyTab } from "@/components/clients/client-loyalty-tab";
import { ClientProfileHeader } from "@/components/clients/client-profile-header";
import { ClientProfileTab } from "@/components/clients/client-profile-tab";
import type { ClientData, Employee } from "@/components/clients/types";
import {
  parseCommaSeparated,
  serializeCommaSeparated,
} from "@/components/clients/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSalonId } from "@/hooks/use-salon-id";
import { useSession } from "@/lib/auth-client";
import { validatePhone } from "@/lib/validations";
import { mutationFetch } from "@/lib/api-client";

export default function ClientProfilePage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.id as string;
  const { data: session, isPending } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();

  const [client, setClient] = useState<ClientData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form validation errors
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Editable contact fields
  const [formFirstName, setFormFirstName] = useState("");
  const [formLastName, setFormLastName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formEmail, setFormEmail] = useState("");

  // Editable form fields
  const [formNotes, setFormNotes] = useState("");
  const [allergiesList, setAllergiesList] = useState<string[]>([]);
  const [preferencesList, setPreferencesList] = useState<string[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedFavoriteEmployeeId, setSelectedFavoriteEmployeeId] = useState<string>("");

  // Birthday state
  const [formBirthday, setFormBirthday] = useState("");

  // Deposit settings state
  const [formRequireDeposit, setFormRequireDeposit] = useState(false);
  const [formDepositType, setFormDepositType] = useState<string>("percentage");
  const [formDepositValue, setFormDepositValue] = useState<string>("");

  // Track which tabs have been activated to enable lazy rendering
  const [activatedTabs, setActivatedTabs] = useState<Set<string>>(new Set(["profile"]));

  const fetchClient = useCallback(async (signal: AbortSignal | null = null) => {
    try {
      const res = await fetch(`/api/clients/${clientId}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        const clientData = data.data as ClientData;
        setClient(clientData);
        setFormFirstName(clientData.firstName);
        setFormLastName(clientData.lastName);
        setFormPhone(clientData.phone || "");
        setFormEmail(clientData.email || "");
        setFormNotes(clientData.notes || "");
        setAllergiesList(parseCommaSeparated(clientData.allergies));
        setPreferencesList(parseCommaSeparated(clientData.preferences));
        setSelectedFavoriteEmployeeId(clientData.favoriteEmployeeId || "");
        setFormBirthday(clientData.birthday || "");
        setFormRequireDeposit(clientData.requireDeposit ?? false);
        setFormDepositType(clientData.depositType || "percentage");
        setFormDepositValue(clientData.depositValue || "");
      } else {
        toast.error("Nie znaleziono klienta");
        router.replace("/dashboard/clients");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      toast.error("Blad podczas ladowania danych klienta");
    } finally {
      setLoading(false);
    }
  }, [clientId, router]);

  useEffect(() => {
    const controller = new AbortController();
    fetchClient(controller.signal);
    return () => controller.abort();
  }, [fetchClient]);

  useEffect(() => {
    if (!salonId) return;
    const controller = new AbortController();
    async function fetchEmployees() {
      try {
        const res = await fetch(`/api/employees?salonId=${salonId}&activeOnly=true`, { signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) {
          setEmployees(data.data);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }
    fetchEmployees();
    return () => controller.abort();
  }, [salonId]);

  const handleTabChange = (value: string) => {
    setActivatedTabs((prev) => {
      if (prev.has(value)) return prev;
      const next = new Set(prev);
      next.add(value);
      return next;
    });
  };

  const clearFieldError = (field: string) => {
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleSave = async () => {
    if (!client) return;

    // Validate required fields with inline errors
    const errors: Record<string, string> = {};
    if (!formFirstName.trim()) {
      errors.firstName = "Wpisz imie klienta, np. Anna";
    }
    if (!formLastName.trim()) {
      errors.lastName = "Wpisz nazwisko klienta, np. Kowalska";
    }
    if (formEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail.trim())) {
      errors.email = "Nieprawidlowy format email. Wpisz adres w formacie: nazwa@domena.pl";
    }
    if (formPhone.trim()) {
      const phoneError = validatePhone(formPhone);
      if (phoneError) {
        errors.phone = phoneError;
      }
    }
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("Wypelnij wszystkie wymagane pola");
      return;
    }

    setSaving(true);
    try {
      const res = await mutationFetch(`/api/clients/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: formFirstName.trim(),
          lastName: formLastName.trim(),
          phone: formPhone.trim() || null,
          email: formEmail.trim() || null,
          notes: formNotes.trim() || null,
          preferences: serializeCommaSeparated(preferencesList),
          allergies: serializeCommaSeparated(allergiesList),
          favoriteEmployeeId: selectedFavoriteEmployeeId || null,
          birthday: formBirthday || null,
          requireDeposit: formRequireDeposit,
          depositType: formDepositType,
          depositValue: formRequireDeposit && formDepositValue ? formDepositValue : null,
        }),
      });

      const data = await res.json();

      if (data.success) {
        const updatedClient = data.data as ClientData;
        setClient(updatedClient);
        // Sync form fields with updated data
        setFormFirstName(updatedClient.firstName);
        setFormLastName(updatedClient.lastName);
        setFormPhone(updatedClient.phone || "");
        setFormEmail(updatedClient.email || "");
        setFormBirthday(updatedClient.birthday || "");
        setFormRequireDeposit(updatedClient.requireDeposit ?? false);
        setFormDepositType(updatedClient.depositType || "percentage");
        setFormDepositValue(updatedClient.depositValue || "");
        toast.success("Dane klienta zostaly zapisane");
      } else {
        toast.error(data.error || "Nie udalo sie zapisac danych klienta");
      }
    } catch {
      toast.error("Blad podczas zapisywania danych klienta");
    } finally {
      setSaving(false);
    }
  };

  if (isPending || salonLoading || loading) {
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
      <ClientProfileHeader
        client={client}
        clientId={clientId}
        displayFirstName={formFirstName}
        displayLastName={formLastName}
        saving={saving}
        onSave={handleSave}
      />

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

      {/* Tabs: Profile, Visit History, and Loyalty */}
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
          <TabsTrigger value="loyalty" data-testid="tab-loyalty">
            <Award className="h-4 w-4 mr-1" />
            Punkty lojalnosciowe
          </TabsTrigger>
          <TabsTrigger value="ai-insights" data-testid="tab-ai-insights">
            <Brain className="h-4 w-4 mr-1" />
            AI Insights
          </TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile">
          <ClientProfileTab
            client={client}
            clientId={clientId}
            formFirstName={formFirstName}
            formLastName={formLastName}
            formPhone={formPhone}
            formEmail={formEmail}
            formBirthday={formBirthday}
            formErrors={formErrors}
            formNotes={formNotes}
            allergiesList={allergiesList}
            preferencesList={preferencesList}
            employees={employees}
            selectedFavoriteEmployeeId={selectedFavoriteEmployeeId}
            formRequireDeposit={formRequireDeposit}
            formDepositType={formDepositType}
            formDepositValue={formDepositValue}
            onFirstNameChange={setFormFirstName}
            onLastNameChange={setFormLastName}
            onPhoneChange={setFormPhone}
            onEmailChange={setFormEmail}
            onBirthdayChange={setFormBirthday}
            onClearFieldError={clearFieldError}
            onNotesChange={setFormNotes}
            onAllergiesChange={setAllergiesList}
            onPreferencesChange={setPreferencesList}
            onFavoriteEmployeeChange={setSelectedFavoriteEmployeeId}
            onRequireDepositChange={setFormRequireDeposit}
            onDepositTypeChange={setFormDepositType}
            onDepositValueChange={setFormDepositValue}
          />
        </TabsContent>

        {/* Visit History Tab */}
        <TabsContent value="history">
          {activatedTabs.has("history") && (
            <ClientHistoryTab clientId={clientId} />
          )}
        </TabsContent>

        {/* Loyalty Points Tab */}
        <TabsContent value="loyalty">
          {activatedTabs.has("loyalty") && salonId && (
            <ClientLoyaltyTab clientId={clientId} salonId={salonId} />
          )}
        </TabsContent>

        {/* AI Insights Tab */}
        <TabsContent value="ai-insights">
          {activatedTabs.has("ai-insights") && (
            <ClientInsightsTab clientId={clientId} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
