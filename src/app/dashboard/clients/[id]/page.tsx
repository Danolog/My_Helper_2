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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  FlaskConical,
  Wrench,
  FileText,
  Edit3,
  Check,
  Package,
  Trash2,
  Banknote,
  Cake,
  Award,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Gift,
  Percent,
  ShoppingBag,
  Shield,
  MessageSquare,
  Loader2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { validatePhone } from "@/lib/validations";

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
  birthday: string | null;
  requireDeposit: boolean | null;
  depositType: string | null;
  depositValue: string | null;
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

interface TreatmentData {
  id: string;
  recipe: string | null;
  techniques: string | null;
  materialsJson: unknown[];
  notes: string | null;
  createdAt: string;
}

interface MaterialProduct {
  id: string;
  name: string;
  category: string | null;
  quantity: string | null;
  unit: string | null;
  pricePerUnit: string | null;
}

interface MaterialData {
  id: string;
  appointmentId: string;
  productId: string;
  quantityUsed: string;
  notes: string | null;
  createdAt: string;
  product: MaterialProduct | null;
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
  treatment: TreatmentData | null;
  materials: MaterialData[];
}

interface LoyaltyTransaction {
  id: string;
  pointsChange: number;
  reason: string | null;
  appointmentId: string | null;
  createdAt: string;
}

interface LoyaltyData {
  clientId: string;
  salonId: string;
  points: number;
  loyaltyId: string | null;
  transactions: LoyaltyTransaction[];
  lastUpdated: string | null;
}

interface RewardItem {
  id: string;
  name: string;
  pointsRequired: number;
  rewardType: "discount" | "free_service" | "product";
  rewardValue: number;
  description: string;
  canRedeem: boolean;
  pointsNeeded: number;
}

interface RewardsData {
  enabled: boolean;
  points: number;
  availableRewards: RewardItem[];
  allRewards: RewardItem[];
}

interface ConsentStatus {
  type: "email" | "sms" | "phone";
  granted: boolean;
  grantedAt: string | null;
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

  // Treatment form state
  const [editingTreatmentId, setEditingTreatmentId] = useState<string | null>(null);
  const [treatmentRecipe, setTreatmentRecipe] = useState("");
  const [treatmentTechniques, setTreatmentTechniques] = useState("");
  const [treatmentNotes, setTreatmentNotes] = useState("");
  const [savingTreatment, setSavingTreatment] = useState(false);

  // Delete confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

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
  const [newAllergyInput, setNewAllergyInput] = useState("");
  const [preferencesList, setPreferencesList] = useState<string[]>([]);
  const [newPreferenceInput, setNewPreferenceInput] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedFavoriteEmployeeId, setSelectedFavoriteEmployeeId] = useState<string>("");

  // Birthday state
  const [formBirthday, setFormBirthday] = useState("");

  // Deposit settings state
  const [formRequireDeposit, setFormRequireDeposit] = useState(false);
  const [formDepositType, setFormDepositType] = useState<string>("percentage");
  const [formDepositValue, setFormDepositValue] = useState<string>("");

  // Loyalty points state
  const [loyaltyData, setLoyaltyData] = useState<LoyaltyData | null>(null);
  const [loadingLoyalty, setLoadingLoyalty] = useState(false);

  // Rewards redemption state
  const [rewardsData, setRewardsData] = useState<RewardsData | null>(null);
  const [loadingRewards, setLoadingRewards] = useState(false);
  const [redeemingReward, setRedeemingReward] = useState(false);
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);
  const [selectedReward, setSelectedReward] = useState<RewardItem | null>(null);

  // Marketing consent state
  const [consents, setConsents] = useState<ConsentStatus[]>([]);
  const [loadingConsents, setLoadingConsents] = useState(false);
  const [savingConsents, setSavingConsents] = useState(false);

  const fetchClient = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}`);
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

  const fetchLoyaltyData = useCallback(async () => {
    setLoadingLoyalty(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/loyalty?salonId=${DEMO_SALON_ID}`);
      const data = await res.json();
      if (data.success) {
        setLoyaltyData(data.data as LoyaltyData);
      } else {
        console.error("Failed to fetch loyalty data:", data.error);
      }
    } catch (error) {
      console.error("Failed to fetch loyalty data:", error);
    } finally {
      setLoadingLoyalty(false);
    }
  }, [clientId]);

  const fetchRewardsData = useCallback(async () => {
    setLoadingRewards(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/loyalty/redeem?salonId=${DEMO_SALON_ID}`);
      const data = await res.json();
      if (data.success) {
        setRewardsData(data.data as RewardsData);
      } else {
        console.error("Failed to fetch rewards data:", data.error);
      }
    } catch (error) {
      console.error("Failed to fetch rewards data:", error);
    } finally {
      setLoadingRewards(false);
    }
  }, [clientId]);

  const handleRedeemReward = async () => {
    if (!selectedReward) return;
    setRedeemingReward(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/loyalty/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rewardTierId: selectedReward.id,
          salonId: DEMO_SALON_ID,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || "Nagroda zrealizowana!");
        // Refresh loyalty data and rewards
        await Promise.all([fetchLoyaltyData(), fetchRewardsData()]);
      } else {
        toast.error(data.error || "Nie udalo sie zrealizowac nagrody");
      }
    } catch (error) {
      console.error("Failed to redeem reward:", error);
      toast.error("Blad podczas realizacji nagrody");
    } finally {
      setRedeemingReward(false);
      setRedeemDialogOpen(false);
      setSelectedReward(null);
    }
  };

  const openRedeemDialog = (reward: RewardItem) => {
    setSelectedReward(reward);
    setRedeemDialogOpen(true);
  };

  const fetchConsents = useCallback(async () => {
    setLoadingConsents(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/consents`);
      const data = await res.json();
      if (!res.ok) {
        console.error("Failed to fetch consents:", data.error);
        return;
      }
      setConsents(data.consents as ConsentStatus[]);
    } catch (error) {
      console.error("Failed to fetch consents:", error);
    } finally {
      setLoadingConsents(false);
    }
  }, [clientId]);

  const handleConsentToggle = async (consentType: "email" | "sms" | "phone", newValue: boolean) => {
    setSavingConsents(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/consents`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consents: { [consentType]: newValue },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setConsents(data.consents as ConsentStatus[]);
        const label = consentType === "email" ? "e-mail" : consentType === "sms" ? "SMS" : "telefon";
        toast.success(
          newValue
            ? `Zgoda na marketing ${label} udzielona`
            : `Zgoda na marketing ${label} wycofana`
        );
      } else {
        toast.error(data.error || "Blad podczas aktualizacji zgody");
      }
    } catch (error) {
      console.error("Failed to update consent:", error);
      toast.error("Blad podczas aktualizacji zgody marketingowej");
    } finally {
      setSavingConsents(false);
    }
  };

  useEffect(() => {
    fetchClient();
    fetchConsents();
  }, [fetchClient, fetchConsents]);

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
    if (value === "loyalty" && !loyaltyData && !loadingLoyalty) {
      fetchLoyaltyData();
    }
    if (value === "loyalty" && !rewardsData && !loadingRewards) {
      fetchRewardsData();
    }
  };

  const toggleAppointmentExpanded = (appointmentId: string) => {
    setExpandedAppointmentId((prev) =>
      prev === appointmentId ? null : appointmentId
    );
  };

  const startEditingTreatment = (appointment: AppointmentData) => {
    setEditingTreatmentId(appointment.id);
    setTreatmentRecipe(appointment.treatment?.recipe || "");
    setTreatmentTechniques(appointment.treatment?.techniques || "");
    setTreatmentNotes(appointment.treatment?.notes || "");
  };

  const cancelEditingTreatment = () => {
    setEditingTreatmentId(null);
    setTreatmentRecipe("");
    setTreatmentTechniques("");
    setTreatmentNotes("");
  };

  const handleSaveTreatment = async (appointmentId: string) => {
    setSavingTreatment(true);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/treatment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipe: treatmentRecipe.trim() || null,
          techniques: treatmentTechniques.trim() || null,
          notes: treatmentNotes.trim() || null,
          materialsJson: [],
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Karta zabiegu zostala zapisana");
        // Update the visit history with the new treatment data
        setVisitHistory((prev) =>
          prev.map((apt) =>
            apt.id === appointmentId
              ? {
                  ...apt,
                  status: apt.status === "scheduled" || apt.status === "confirmed" ? "completed" : apt.status,
                  treatment: {
                    id: data.data.id,
                    recipe: data.data.recipe,
                    techniques: data.data.techniques,
                    materialsJson: data.data.materialsJson || [],
                    notes: data.data.notes,
                    createdAt: data.data.createdAt,
                  },
                }
              : apt
          )
        );
        setEditingTreatmentId(null);
        setTreatmentRecipe("");
        setTreatmentTechniques("");
        setTreatmentNotes("");
      } else {
        toast.error(data.error || "Nie udalo sie zapisac karty zabiegu");
      }
    } catch (error) {
      console.error("Failed to save treatment:", error);
      toast.error("Blad podczas zapisywania karty zabiegu");
    } finally {
      setSavingTreatment(false);
    }
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
      errors.firstName = "Imie jest wymagane";
    }
    if (!formLastName.trim()) {
      errors.lastName = "Nazwisko jest wymagane";
    }
    if (formEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail.trim())) {
      errors.email = "Wprowadz poprawny adres email";
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
      const res = await fetch(`/api/clients/${clientId}`, {
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
    } catch (error) {
      console.error("Failed to save client:", error);
      toast.error("Blad podczas zapisywania danych klienta");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClient = async () => {
    if (!deletePassword.trim()) {
      setDeleteError("Wpisz haslo, aby potwierdzic usuniecie");
      return;
    }

    setDeleting(true);
    setDeleteError("");

    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(
          `Klient "${client?.firstName} ${client?.lastName}" zostal usuniety`
        );
        setDeleteDialogOpen(false);
        router.push("/dashboard/clients");
      } else {
        if (res.status === 403) {
          setDeleteError("Nieprawidlowe haslo. Sprobuj ponownie.");
        } else {
          setDeleteError(data.error || "Nie udalo sie usunac klienta");
        }
      }
    } catch (error) {
      console.error("Failed to delete client:", error);
      setDeleteError("Blad podczas usuwania klienta");
    } finally {
      setDeleting(false);
    }
  };

  const openDeleteDialog = () => {
    setDeletePassword("");
    setDeleteError("");
    setDeleteDialogOpen(true);
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
              {formFirstName || client.firstName} {formLastName || client.lastName}
            </h1>
            <p className="text-muted-foreground text-sm">Profil klienta</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="destructive"
            onClick={openDeleteDialog}
            data-testid="delete-client-btn"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Usun klienta
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            data-testid="save-client-btn"
          >
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Zapisywanie..." : "Zapisz zmiany"}
          </Button>
        </div>
      </div>

      {/* Delete confirmation dialog with password */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Usuwanie klienta
            </DialogTitle>
            <DialogDescription>
              Czy na pewno chcesz usunac klienta{" "}
              <strong>
                {client?.firstName} {client?.lastName}
              </strong>
              ? Ta operacja jest nieodwracalna. Wpisz swoje haslo, aby
              potwierdzic.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="delete-password">Twoje haslo</Label>
              <Input
                id="delete-password"
                type="password"
                placeholder="Wpisz swoje haslo..."
                value={deletePassword}
                onChange={(e) => {
                  setDeletePassword(e.target.value);
                  if (deleteError) setDeleteError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !deleting) {
                    e.preventDefault();
                    handleDeleteClient();
                  }
                }}
                data-testid="delete-password-input"
                autoFocus
              />
              {deleteError && (
                <p
                  className="text-sm text-destructive"
                  data-testid="delete-error-message"
                >
                  {deleteError}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
              data-testid="cancel-delete-btn"
            >
              Anuluj
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteClient}
              disabled={deleting}
              data-testid="confirm-delete-btn"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {deleting ? "Usuwanie..." : "Usun klienta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          <TabsTrigger value="loyalty" data-testid="tab-loyalty">
            <Award className="h-4 w-4 mr-1" />
            Punkty lojalnosciowe
          </TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile">
          {/* Client info card - editable */}
          <Card className="mb-6" data-testid="client-info-card">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Edit3 className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Dane kontaktowe</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="client-firstName" className="text-sm font-medium flex items-center gap-1.5 mb-1.5">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    Imie *
                  </Label>
                  <Input
                    id="client-firstName"
                    placeholder="Imie klienta"
                    value={formFirstName}
                    onChange={(e) => { setFormFirstName(e.target.value); clearFieldError("firstName"); }}
                    aria-invalid={!!formErrors.firstName}
                    className={formErrors.firstName ? "border-destructive" : ""}
                    data-testid="client-firstName-input"
                  />
                  {formErrors.firstName && (
                    <p className="text-sm text-destructive mt-1">{formErrors.firstName}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="client-lastName" className="text-sm font-medium flex items-center gap-1.5 mb-1.5">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    Nazwisko *
                  </Label>
                  <Input
                    id="client-lastName"
                    placeholder="Nazwisko klienta"
                    value={formLastName}
                    onChange={(e) => { setFormLastName(e.target.value); clearFieldError("lastName"); }}
                    aria-invalid={!!formErrors.lastName}
                    className={formErrors.lastName ? "border-destructive" : ""}
                    data-testid="client-lastName-input"
                  />
                  {formErrors.lastName && (
                    <p className="text-sm text-destructive mt-1">{formErrors.lastName}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="client-phone" className="text-sm font-medium flex items-center gap-1.5 mb-1.5">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    Numer telefonu
                  </Label>
                  <Input
                    id="client-phone"
                    type="tel"
                    placeholder="np. +48 123 456 789"
                    value={formPhone}
                    onChange={(e) => {
                      setFormPhone(e.target.value);
                      clearFieldError("phone");
                    }}
                    aria-invalid={!!formErrors.phone}
                    className={formErrors.phone ? "border-destructive" : ""}
                    data-testid="client-phone-input"
                  />
                  {formErrors.phone && (
                    <p className="text-sm text-destructive mt-1">{formErrors.phone}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="client-email" className="text-sm font-medium flex items-center gap-1.5 mb-1.5">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    Email
                  </Label>
                  <Input
                    id="client-email"
                    type="email"
                    placeholder="np. klient@example.com"
                    value={formEmail}
                    onChange={(e) => {
                      setFormEmail(e.target.value);
                      clearFieldError("email");
                    }}
                    aria-invalid={!!formErrors.email}
                    data-testid="client-email-input"
                  />
                  {formErrors.email && (
                    <p className="text-sm text-destructive mt-1">{formErrors.email}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="client-birthday" className="text-sm font-medium flex items-center gap-1.5 mb-1.5">
                    <Cake className="h-3.5 w-3.5 text-muted-foreground" />
                    Data urodzin
                  </Label>
                  <Input
                    id="client-birthday"
                    type="date"
                    placeholder="np. 1990-03-15"
                    value={formBirthday}
                    onChange={(e) => setFormBirthday(e.target.value)}
                    data-testid="client-birthday-input"
                  />
                  {formBirthday && (() => {
                    const today = new Date();
                    const bday = new Date(formBirthday + "T00:00:00");
                    const isBirthdayToday = bday.getMonth() === today.getMonth() && bday.getDate() === today.getDate();
                    if (isBirthdayToday) {
                      return (
                        <p className="text-xs text-green-600 mt-1 flex items-center gap-1" data-testid="birthday-today-badge">
                          <Cake className="h-3 w-3" />
                          Dzisiaj urodziny!
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>
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

          {/* Deposit Settings card */}
          <Card className="mb-6" data-testid="deposit-settings-card">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Banknote className="h-5 w-5 text-green-600" />
                <CardTitle className="text-lg">Ustawienia zadatku</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Wymagaj zadatku</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Wlacz, aby ten klient musial placic zadatek przy rezerwacji
                  </p>
                </div>
                <Select
                  value={formRequireDeposit ? "yes" : "no"}
                  onValueChange={(value) => setFormRequireDeposit(value === "yes")}
                >
                  <SelectTrigger className="w-[120px]" data-testid="require-deposit-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no">Nie</SelectItem>
                    <SelectItem value="yes">Tak</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formRequireDeposit && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm font-medium mb-1.5 block">Typ zadatku</Label>
                      <Select
                        value={formDepositType}
                        onValueChange={setFormDepositType}
                      >
                        <SelectTrigger className="w-full max-w-xs" data-testid="deposit-type-select">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="percentage">Procent ceny uslugi (%)</SelectItem>
                          <SelectItem value="fixed">Stala kwota (PLN)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="deposit-value" className="text-sm font-medium mb-1.5 block">
                        {formDepositType === "percentage" ? "Procent zadatku" : "Kwota zadatku (PLN)"}
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="deposit-value"
                          type="number"
                          min="0"
                          max={formDepositType === "percentage" ? "100" : undefined}
                          step={formDepositType === "percentage" ? "1" : "0.01"}
                          placeholder={formDepositType === "percentage" ? "np. 30" : "np. 50.00"}
                          value={formDepositValue}
                          onChange={(e) => setFormDepositValue(e.target.value)}
                          className="max-w-[180px]"
                          data-testid="deposit-value-input"
                        />
                        <span className="text-sm text-muted-foreground">
                          {formDepositType === "percentage" ? "%" : "PLN"}
                        </span>
                      </div>
                      {formDepositType === "percentage" && formDepositValue && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Przy usludze za 100 PLN, zadatek wyniesie {parseFloat(formDepositValue || "0").toFixed(0)} PLN
                        </p>
                      )}
                    </div>
                  </div>
                </>
              )}

              {formRequireDeposit && (
                <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
                  <p className="text-sm text-green-700 dark:text-green-400">
                    <Banknote className="h-4 w-4 inline mr-1" />
                    {formDepositType === "percentage"
                      ? `Ten klient bedzie musial zaplacic ${formDepositValue || "0"}% ceny uslugi jako zadatek.`
                      : `Ten klient bedzie musial zaplacic ${parseFloat(formDepositValue || "0").toFixed(2)} PLN jako zadatek.`}
                  </p>
                </div>
              )}
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

          {/* Marketing Consent Section */}
          <Card className="mb-6" data-testid="consent-card">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Zgody marketingowe</CardTitle>
              </div>
              <p className="text-sm text-muted-foreground">
                Zarzadzaj zgodami klienta na komunikacje marketingowa (RODO)
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingConsents ? (
                <div className="flex items-center justify-center py-6" data-testid="consents-loading">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Ladowanie zgod...</span>
                </div>
              ) : (
                <>
                  {/* Email consent */}
                  <div className="flex items-center justify-between p-3 rounded-lg border" data-testid="consent-email">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/40">
                        <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">Marketing e-mail</p>
                        <p className="text-xs text-muted-foreground">
                          Newslettery, promocje i oferty specjalne
                        </p>
                        {consents.find(c => c.type === "email")?.grantedAt && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Zgoda od: {new Date(consents.find(c => c.type === "email")!.grantedAt!).toLocaleDateString("pl-PL")}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={consents.find(c => c.type === "email")?.granted ? "default" : "secondary"}
                        className="text-xs"
                        data-testid="consent-email-badge"
                      >
                        {consents.find(c => c.type === "email")?.granted ? "Aktywna" : "Brak"}
                      </Badge>
                      <Switch
                        checked={consents.find(c => c.type === "email")?.granted ?? false}
                        onCheckedChange={(checked) => handleConsentToggle("email", checked)}
                        disabled={savingConsents}
                        data-testid="consent-email-switch"
                      />
                    </div>
                  </div>

                  {/* SMS consent */}
                  <div className="flex items-center justify-between p-3 rounded-lg border" data-testid="consent-sms">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-green-100 dark:bg-green-900/40">
                        <MessageSquare className="h-4 w-4 text-green-600 dark:text-green-400" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">Marketing SMS</p>
                        <p className="text-xs text-muted-foreground">
                          Powiadomienia SMS o promocjach i nowosciach
                        </p>
                        {consents.find(c => c.type === "sms")?.grantedAt && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Zgoda od: {new Date(consents.find(c => c.type === "sms")!.grantedAt!).toLocaleDateString("pl-PL")}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={consents.find(c => c.type === "sms")?.granted ? "default" : "secondary"}
                        className="text-xs"
                        data-testid="consent-sms-badge"
                      >
                        {consents.find(c => c.type === "sms")?.granted ? "Aktywna" : "Brak"}
                      </Badge>
                      <Switch
                        checked={consents.find(c => c.type === "sms")?.granted ?? false}
                        onCheckedChange={(checked) => handleConsentToggle("sms", checked)}
                        disabled={savingConsents}
                        data-testid="consent-sms-switch"
                      />
                    </div>
                  </div>

                  {/* Phone consent */}
                  <div className="flex items-center justify-between p-3 rounded-lg border" data-testid="consent-phone">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-purple-100 dark:bg-purple-900/40">
                        <Phone className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">Marketing telefoniczny</p>
                        <p className="text-xs text-muted-foreground">
                          Kontakt telefoniczny w celach marketingowych
                        </p>
                        {consents.find(c => c.type === "phone")?.grantedAt && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Zgoda od: {new Date(consents.find(c => c.type === "phone")!.grantedAt!).toLocaleDateString("pl-PL")}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={consents.find(c => c.type === "phone")?.granted ? "default" : "secondary"}
                        className="text-xs"
                        data-testid="consent-phone-badge"
                      >
                        {consents.find(c => c.type === "phone")?.granted ? "Aktywna" : "Brak"}
                      </Badge>
                      <Switch
                        checked={consents.find(c => c.type === "phone")?.granted ?? false}
                        onCheckedChange={(checked) => handleConsentToggle("phone", checked)}
                        disabled={savingConsents}
                        data-testid="consent-phone-switch"
                      />
                    </div>
                  </div>

                  {/* GDPR Info */}
                  <div className="mt-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground" data-testid="consent-gdpr-info">
                    <p className="flex items-center gap-1.5">
                      <Shield className="h-3.5 w-3.5" />
                      <strong>RODO:</strong> Zgody sa wymagane przed wyslaniem jakiejkolwiek komunikacji marketingowej.
                      Klient moze w kazdej chwili wycofac swoja zgode.
                    </p>
                  </div>
                </>
              )}
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

                            {/* Treatment History Section */}
                            <Separator />
                            <div data-testid={`treatment-section-${appointment.id}`}>
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <FlaskConical className="h-4 w-4 text-purple-500" />
                                  <p className="text-sm font-semibold">Karta zabiegu</p>
                                </div>
                                {editingTreatmentId !== appointment.id && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => startEditingTreatment(appointment)}
                                    data-testid={`edit-treatment-btn-${appointment.id}`}
                                  >
                                    {appointment.treatment ? (
                                      <>
                                        <Edit3 className="h-3.5 w-3.5 mr-1" />
                                        Edytuj
                                      </>
                                    ) : (
                                      <>
                                        <Plus className="h-3.5 w-3.5 mr-1" />
                                        Dodaj karte zabiegu
                                      </>
                                    )}
                                  </Button>
                                )}
                              </div>

                              {/* Show existing treatment details (read-only) */}
                              {appointment.treatment && editingTreatmentId !== appointment.id && (
                                <div className="space-y-3 bg-purple-50 dark:bg-purple-950/20 rounded-lg p-3 border border-purple-200 dark:border-purple-800" data-testid={`treatment-details-${appointment.id}`}>
                                  {appointment.treatment.recipe && (
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground uppercase mb-1 flex items-center gap-1">
                                        <FlaskConical className="h-3 w-3" />
                                        Receptura / Formula
                                      </p>
                                      <p className="text-sm whitespace-pre-wrap" data-testid={`treatment-recipe-${appointment.id}`}>
                                        {appointment.treatment.recipe}
                                      </p>
                                    </div>
                                  )}
                                  {appointment.treatment.techniques && (
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground uppercase mb-1 flex items-center gap-1">
                                        <Wrench className="h-3 w-3" />
                                        Zastosowane techniki
                                      </p>
                                      <p className="text-sm whitespace-pre-wrap" data-testid={`treatment-techniques-${appointment.id}`}>
                                        {appointment.treatment.techniques}
                                      </p>
                                    </div>
                                  )}
                                  {appointment.treatment.notes && (
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground uppercase mb-1 flex items-center gap-1">
                                        <FileText className="h-3 w-3" />
                                        Notatki zabiegu
                                      </p>
                                      <p className="text-sm whitespace-pre-wrap" data-testid={`treatment-notes-${appointment.id}`}>
                                        {appointment.treatment.notes}
                                      </p>
                                    </div>
                                  )}
                                  {!appointment.treatment.recipe && !appointment.treatment.techniques && !appointment.treatment.notes && (
                                    <p className="text-sm text-muted-foreground italic">Karta zabiegu jest pusta</p>
                                  )}
                                </div>
                              )}

                              {/* No treatment - show placeholder */}
                              {!appointment.treatment && editingTreatmentId !== appointment.id && (
                                <p className="text-sm text-muted-foreground italic" data-testid={`no-treatment-${appointment.id}`}>
                                  Brak karty zabiegu - kliknij &quot;Dodaj karte zabiegu&quot; aby uzupelnic
                                </p>
                              )}

                              {/* Treatment edit form */}
                              {editingTreatmentId === appointment.id && (
                                <div className="space-y-4 bg-purple-50 dark:bg-purple-950/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800" data-testid={`treatment-form-${appointment.id}`}>
                                  <div>
                                    <Label htmlFor={`recipe-${appointment.id}`} className="text-sm font-medium flex items-center gap-1 mb-1.5">
                                      <FlaskConical className="h-3.5 w-3.5 text-purple-500" />
                                      Receptura / Formula
                                    </Label>
                                    <Textarea
                                      id={`recipe-${appointment.id}`}
                                      placeholder="np. Farba Wella Koleston 7/0 + 6% oksydant, proporcja 1:1, 30ml"
                                      value={treatmentRecipe}
                                      onChange={(e) => setTreatmentRecipe(e.target.value)}
                                      rows={3}
                                      data-testid={`treatment-recipe-input-${appointment.id}`}
                                    />
                                  </div>
                                  <div>
                                    <Label htmlFor={`techniques-${appointment.id}`} className="text-sm font-medium flex items-center gap-1 mb-1.5">
                                      <Wrench className="h-3.5 w-3.5 text-purple-500" />
                                      Zastosowane techniki
                                    </Label>
                                    <Textarea
                                      id={`techniques-${appointment.id}`}
                                      placeholder="np. Balayage, ombre, pasemka foliowe, tonowanie"
                                      value={treatmentTechniques}
                                      onChange={(e) => setTreatmentTechniques(e.target.value)}
                                      rows={2}
                                      data-testid={`treatment-techniques-input-${appointment.id}`}
                                    />
                                  </div>
                                  <div>
                                    <Label htmlFor={`treatment-notes-${appointment.id}`} className="text-sm font-medium flex items-center gap-1 mb-1.5">
                                      <FileText className="h-3.5 w-3.5 text-purple-500" />
                                      Notatki zabiegu
                                    </Label>
                                    <Textarea
                                      id={`treatment-notes-${appointment.id}`}
                                      placeholder="Dodatkowe informacje o zabiegu, reakcje klienta, zalecenia..."
                                      value={treatmentNotes}
                                      onChange={(e) => setTreatmentNotes(e.target.value)}
                                      rows={2}
                                      data-testid={`treatment-notes-input-${appointment.id}`}
                                    />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      size="sm"
                                      onClick={() => handleSaveTreatment(appointment.id)}
                                      disabled={savingTreatment}
                                      data-testid={`save-treatment-btn-${appointment.id}`}
                                    >
                                      <Check className="h-3.5 w-3.5 mr-1" />
                                      {savingTreatment ? "Zapisywanie..." : "Zapisz karte zabiegu"}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={cancelEditingTreatment}
                                      disabled={savingTreatment}
                                      data-testid={`cancel-treatment-btn-${appointment.id}`}
                                    >
                                      <X className="h-3.5 w-3.5 mr-1" />
                                      Anuluj
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Materials Used Section */}
                            {appointment.materials && appointment.materials.length > 0 && (
                              <>
                                <Separator />
                                <div data-testid={`materials-section-${appointment.id}`}>
                                  <div className="flex items-center gap-2 mb-3">
                                    <Package className="h-4 w-4 text-green-600" />
                                    <p className="text-sm font-semibold">Uzyte materialy</p>
                                    <Badge variant="secondary" className="text-xs" data-testid={`materials-count-${appointment.id}`}>
                                      {appointment.materials.length}
                                    </Badge>
                                  </div>
                                  <div className="space-y-2 bg-green-50 dark:bg-green-950/20 rounded-lg p-3 border border-green-200 dark:border-green-800">
                                    {appointment.materials.map((material) => {
                                      const cost = material.product?.pricePerUnit
                                        ? (parseFloat(material.quantityUsed) * parseFloat(material.product.pricePerUnit)).toFixed(2)
                                        : null;
                                      return (
                                        <div
                                          key={material.id}
                                          className="text-sm"
                                          data-testid={`material-row-${material.id}`}
                                        >
                                          <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                              <Package className="h-3.5 w-3.5 text-green-600 shrink-0" />
                                              <span className="font-medium truncate" data-testid={`material-name-${material.id}`}>
                                                {material.product?.name || "Nieznany produkt"}
                                              </span>
                                              {material.product?.category && (
                                                <Badge variant="secondary" className="text-xs shrink-0">
                                                  {material.product.category}
                                                </Badge>
                                              )}
                                            </div>
                                            <div className="flex items-center gap-3 text-muted-foreground shrink-0 ml-2">
                                              <span data-testid={`material-qty-${material.id}`}>
                                                {material.quantityUsed} {material.product?.unit || "szt."}
                                              </span>
                                              {cost && (
                                                <span className="font-medium text-foreground">
                                                  {cost} PLN
                                                </span>
                                              )}
                                              <a
                                                href="/dashboard/products"
                                                className="text-primary hover:underline text-xs"
                                                data-testid={`material-product-link-${material.id}`}
                                              >
                                                Magazyn
                                              </a>
                                            </div>
                                          </div>
                                          {material.notes && (
                                            <p className="text-xs text-muted-foreground ml-5.5 mt-0.5">
                                              {material.notes}
                                            </p>
                                          )}
                                        </div>
                                      );
                                    })}
                                    {/* Total material cost */}
                                    {(() => {
                                      const totalCost = appointment.materials.reduce((sum, m) => {
                                        if (m.product?.pricePerUnit) {
                                          return sum + parseFloat(m.quantityUsed) * parseFloat(m.product.pricePerUnit);
                                        }
                                        return sum;
                                      }, 0);
                                      if (totalCost > 0) {
                                        return (
                                          <div className="flex justify-between items-center pt-2 mt-2 border-t border-green-300 dark:border-green-700">
                                            <span className="text-sm font-medium">Laczny koszt materialow:</span>
                                            <span className="text-sm font-bold" data-testid={`materials-total-cost-${appointment.id}`}>
                                              {totalCost.toFixed(2)} PLN
                                            </span>
                                          </div>
                                        );
                                      }
                                      return null;
                                    })()}
                                  </div>
                                </div>
                              </>
                            )}

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

        {/* Loyalty Points Tab */}
        <TabsContent value="loyalty">
          <div className="space-y-6">
            {/* Points Balance Card */}
            <Card data-testid="loyalty-balance-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award className="h-5 w-5 text-amber-500" />
                    <CardTitle className="text-lg">Saldo punktow lojalnosciowych</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loadingLoyalty ? (
                  <div className="flex justify-center items-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </div>
                ) : (
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-full bg-amber-100 dark:bg-amber-950/40">
                        <TrendingUp className="h-8 w-8 text-amber-600 dark:text-amber-400" />
                      </div>
                      <div>
                        <p className="text-4xl font-bold text-amber-600 dark:text-amber-400" data-testid="loyalty-points-balance">
                          {loyaltyData?.points ?? 0}
                        </p>
                        <p className="text-sm text-muted-foreground">punktow</p>
                      </div>
                    </div>
                    {loyaltyData?.lastUpdated && (
                      <div className="text-sm text-muted-foreground">
                        <p>Ostatnia aktualizacja:</p>
                        <p>{new Date(loyaltyData.lastUpdated).toLocaleDateString("pl-PL", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Rewards Redemption Card */}
            <Card data-testid="loyalty-rewards-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Gift className="h-5 w-5 text-purple-500" />
                    <CardTitle className="text-lg">Dostepne nagrody</CardTitle>
                  </div>
                  {rewardsData?.availableRewards && rewardsData.availableRewards.length > 0 && (
                    <Badge variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300" data-testid="available-rewards-count">
                      {rewardsData.availableRewards.length} {rewardsData.availableRewards.length === 1 ? "dostepna" : "dostepnych"}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {loadingRewards ? (
                  <div className="flex justify-center items-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </div>
                ) : !rewardsData?.enabled ? (
                  <div className="text-center py-8" data-testid="loyalty-not-enabled">
                    <Gift className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                    <p className="text-muted-foreground text-lg font-medium">Program lojalnosciowy nieaktywny</p>
                    <p className="text-muted-foreground text-sm mt-1">
                      Aktywuj program w ustawieniach salonu, aby klienci mogli zbierac i wymieniac punkty
                    </p>
                  </div>
                ) : !rewardsData?.allRewards || rewardsData.allRewards.length === 0 ? (
                  <div className="text-center py-8" data-testid="no-rewards-configured">
                    <Gift className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                    <p className="text-muted-foreground text-lg font-medium">Brak skonfigurowanych nagrod</p>
                    <p className="text-muted-foreground text-sm mt-1">
                      Dodaj nagrody w ustawieniach programu lojalnosciowego
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3" data-testid="rewards-list">
                    {rewardsData.allRewards.map((reward) => {
                      const rewardIcon = reward.rewardType === "discount" ? (
                        <Percent className="h-5 w-5 text-purple-500" />
                      ) : reward.rewardType === "free_service" ? (
                        <Scissors className="h-5 w-5 text-purple-500" />
                      ) : (
                        <ShoppingBag className="h-5 w-5 text-purple-500" />
                      );

                      const rewardTypeLabel = reward.rewardType === "discount"
                        ? `Rabat ${reward.rewardValue}%`
                        : reward.rewardType === "free_service"
                          ? `Darmowa usluga do ${reward.rewardValue} PLN`
                          : `Produkt gratis do ${reward.rewardValue} PLN`;

                      return (
                        <div
                          key={reward.id}
                          className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${
                            reward.canRedeem
                              ? "border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20 hover:bg-purple-50 dark:hover:bg-purple-950/30"
                              : "border-border opacity-60"
                          }`}
                          data-testid={`reward-item-${reward.id}`}
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className={`p-2 rounded-full ${reward.canRedeem ? "bg-purple-100 dark:bg-purple-950/40" : "bg-muted"}`}>
                              {rewardIcon}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium truncate" data-testid={`reward-name-${reward.id}`}>
                                {reward.name}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {reward.pointsRequired} pkt &middot; {rewardTypeLabel}
                              </p>
                              {reward.description && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {reward.description}
                                </p>
                              )}
                              {!reward.canRedeem && reward.pointsNeeded > 0 && (
                                <p className="text-xs text-orange-600 dark:text-orange-400 mt-1" data-testid={`reward-points-needed-${reward.id}`}>
                                  Brakuje {reward.pointsNeeded} pkt
                                </p>
                              )}
                            </div>
                          </div>
                          <Button
                            variant={reward.canRedeem ? "default" : "outline"}
                            size="sm"
                            disabled={!reward.canRedeem}
                            onClick={() => openRedeemDialog(reward)}
                            data-testid={`redeem-btn-${reward.id}`}
                          >
                            <Gift className="h-4 w-4 mr-1" />
                            {reward.canRedeem ? "Wymien" : "Niedostepna"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Redeem Confirmation Dialog */}
            <AlertDialog open={redeemDialogOpen} onOpenChange={setRedeemDialogOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <Gift className="h-5 w-5 text-purple-500" />
                    Potwierdzenie realizacji nagrody
                  </AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div>
                      {selectedReward && (
                        <div className="space-y-3 mt-2">
                          <div className="p-4 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800">
                            <p className="font-semibold text-foreground">{selectedReward.name}</p>
                            <p className="text-sm mt-1">
                              {selectedReward.rewardType === "discount"
                                ? `Rabat ${selectedReward.rewardValue}%`
                                : selectedReward.rewardType === "free_service"
                                  ? `Darmowa usluga do ${selectedReward.rewardValue} PLN`
                                  : `Produkt gratis do ${selectedReward.rewardValue} PLN`}
                            </p>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span>Koszt:</span>
                            <span className="font-bold text-red-600 dark:text-red-400">
                              -{selectedReward.pointsRequired} pkt
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span>Aktualne saldo:</span>
                            <span className="font-medium">{loyaltyData?.points ?? 0} pkt</span>
                          </div>
                          <div className="flex justify-between items-center text-sm border-t pt-2">
                            <span>Saldo po realizacji:</span>
                            <span className="font-bold text-amber-600 dark:text-amber-400">
                              {(loyaltyData?.points ?? 0) - selectedReward.pointsRequired} pkt
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={redeemingReward} data-testid="cancel-redeem-btn">
                    Anuluj
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleRedeemReward}
                    disabled={redeemingReward}
                    className="bg-purple-600 hover:bg-purple-700"
                    data-testid="confirm-redeem-btn"
                  >
                    <Gift className="h-4 w-4 mr-1" />
                    {redeemingReward ? "Realizacja..." : "Potwierdz realizacje"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Transactions History Card */}
            <Card data-testid="loyalty-transactions-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">Historia transakcji</CardTitle>
                  </div>
                  {loyaltyData?.transactions && loyaltyData.transactions.length > 0 && (
                    <Badge variant="secondary" data-testid="loyalty-transaction-count">
                      {loyaltyData.transactions.length} {loyaltyData.transactions.length === 1 ? "transakcja" : loyaltyData.transactions.length >= 2 && loyaltyData.transactions.length <= 4 ? "transakcje" : "transakcji"}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {loadingLoyalty ? (
                  <div className="flex justify-center items-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </div>
                ) : !loyaltyData?.transactions || loyaltyData.transactions.length === 0 ? (
                  <div className="text-center py-12" data-testid="no-loyalty-transactions">
                    <Award className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                    <p className="text-muted-foreground text-lg font-medium">Brak transakcji lojalnosciowych</p>
                    <p className="text-muted-foreground text-sm mt-1">
                      Punkty zostan naliczone po zakonczeniu wizyty
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2" data-testid="loyalty-transactions-list">
                    {loyaltyData.transactions.map((transaction) => {
                      const isPositive = transaction.pointsChange > 0;
                      return (
                        <div
                          key={transaction.id}
                          className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                          data-testid={`loyalty-transaction-${transaction.id}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-full ${isPositive ? "bg-green-100 dark:bg-green-950/40" : "bg-red-100 dark:bg-red-950/40"}`}>
                              {isPositive ? (
                                <ArrowUpRight className="h-4 w-4 text-green-600 dark:text-green-400" />
                              ) : (
                                <ArrowDownRight className="h-4 w-4 text-red-600 dark:text-red-400" />
                              )}
                            </div>
                            <div>
                              <p className="text-sm font-medium" data-testid={`transaction-reason-${transaction.id}`}>
                                {transaction.reason || (isPositive ? "Naliczenie punktow" : "Wykorzystanie punktow")}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(transaction.createdAt).toLocaleDateString("pl-PL", {
                                  day: "numeric",
                                  month: "long",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`text-lg font-bold ${isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                            data-testid={`transaction-points-${transaction.id}`}
                          >
                            {isPositive ? "+" : ""}{transaction.pointsChange}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
