"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormRecovery } from "@/hooks/use-form-recovery";
import { mutationFetch } from "@/lib/api-client";
import { signUp } from "@/lib/auth-client";
import { sanitizeAuthError } from "@/lib/error-messages";
import {
  LEGAL_ACCEPTANCE_REQUIRED_CODE,
  LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
  isLegalAcceptanceComplete,
  legalAcceptanceForm,
  legalAcceptanceRequestFields,
  type LegalAcceptanceChecks,
  type LegalAcceptanceForm,
} from "@/lib/legal/documents";
import { PLANS_ON_SALE, isPlanOnSale, planOnSaleOr } from "@/lib/plan-catalog";

export type Plan = {
  id: string;
  name: string;
  slug: string;
  priceMonthly: string;
  features: string[];
  isActive: boolean;
};

// Form has data when name or email is filled, or — only when PLANS_ON_SALE
// does not hold exactly one plan — a plan is selected.
function hasFormData(
  state: { selectedPlan: string | null; name: string; email: string },
  singlePlanOnSale: boolean
): boolean {
  return !!state.name || !!state.email || (!singlePlanOnSale && !!state.selectedPlan);
}

const SALON_SETUP_FALLBACK_ERROR =
  "Nie udało się założyć salonu. Po zalogowaniu załóż go w panelu.";

/**
 * Komunikat dla użytkownika po odpowiedzi trasy zakładającej salon; `null`, gdy
 * nie ma czego pokazywać:
 * - 2xx: salon założony;
 * - 401: konto czeka na potwierdzenie e-maila, salon powstanie w panelu;
 * - 409: konto ma już salon z subskrypcją.
 * Każdy inny wynik (w tym 400 przy braku akceptacji dokumentów) jest widoczny.
 */
async function salonSetupErrorMessage(res: Response): Promise<string | null> {
  if (res.ok || res.status === 401 || res.status === 409) return null;
  const body: unknown = await res.json().catch(() => null);
  if (
    typeof body === "object" &&
    body !== null &&
    (body as { code?: unknown }).code === LEGAL_ACCEPTANCE_REQUIRED_CODE
  ) {
    return LEGAL_ACCEPTANCE_REQUIRED_MESSAGE;
  }
  return SALON_SETUP_FALLBACK_ERROR;
}

/**
 * @param legalForm pola akceptacji regulaminu i DPA; domyślnie stan z rejestru
 * dokumentów (przed publikacją `null`: bez pól i bez dodatkowych danych w żądaniu).
 * Parametr istnieje, żeby test sprawdzał oba stany bez atrapy modułu.
 */
export function useRegistration(
  preselectedPlan: string | null,
  legalForm: LegalAcceptanceForm | null = legalAcceptanceForm()
) {
  const router = useRouter();

  // Step management: 1 = plan selection, 2 = account details
  const singlePlanOnSale = PLANS_ON_SALE.length === 1;
  const [step, setStep] = useState(singlePlanOnSale || preselectedPlan ? 2 : 1);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(
    singlePlanOnSale || preselectedPlan ? planOnSaleOr(preselectedPlan) : null
  );

  // Plans data
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);

  // Account form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isPending, setIsPending] = useState(false);
  const [showVerificationMessage, setShowVerificationMessage] = useState(false);
  const [legalChecks, setLegalChecks] = useState<LegalAcceptanceChecks>({
    terms: false,
    dpa: false,
  });
  // Konto powstało, ale salonu nie udało się założyć: pokazywane na ekranie potwierdzenia.
  const [salonSetupError, setSalonSetupError] = useState("");
  const legalAcceptanceComplete = isLegalAcceptanceComplete(legalForm, legalChecks);

  // Form recovery after page refresh
  const {
    wasRecovered,
    getRecoveredState,
    saveFormState,
    clearSavedForm,
    setDirty,
  } = useFormRecovery<{
    step: number;
    selectedPlan: string | null;
    name: string;
    email: string;
  }>({
    storageKey: "registration-form",
    warnOnUnload: true,
  });

  // Recovery banner only when the saved state contains form data
  const recoveredState = wasRecovered ? getRecoveredState() : null;
  const recoveredWithData =
    recoveredState !== null && hasFormData(recoveredState, singlePlanOnSale);

  // Recovery handler: restores form fields from localStorage
  const handleRestoreForm = () => {
    const saved = getRecoveredState();
    if (saved) {
      if (saved.name) setName(saved.name);
      if (saved.email) setEmail(saved.email);
      if (saved.selectedPlan) setSelectedPlan(planOnSaleOr(saved.selectedPlan));
      if (saved.step) setStep(saved.step);
    }
  };

  // Save form state on every change (debounced inside hook)
  useEffect(() => {
    const hasData = hasFormData({ selectedPlan, name, email }, singlePlanOnSale);
    saveFormState({ step, selectedPlan, name, email });
    setDirty(hasData);
  }, [step, selectedPlan, name, email, singlePlanOnSale, saveFormState, setDirty]);

  // Fetch subscription plans
  useEffect(() => {
    async function fetchPlans() {
      try {
        const res = await fetch("/api/subscription-plans");
        if (!res.ok) throw new Error("Failed to fetch plans");
        const data = await res.json();
        if (data.success) {
          setPlans(data.data);
        }
      } catch {
        // Plans will show empty - user can still register
      } finally {
        setPlansLoading(false);
      }
    }
    fetchPlans();
  }, []);

  const basicPlan = plans.find((p) => p.slug === "basic");
  const proPlan = isPlanOnSale("pro")
    ? plans.find((p) => p.slug === "pro")
    : undefined;
  const selectedPlanData = plans.find((p) => p.slug === selectedPlan);

  const handleSelectPlan = (slug: string) => {
    setSelectedPlan(slug);
  };

  const handleContinueToAccount = () => {
    if (selectedPlan) {
      setStep(2);
    }
  };

  const handleBackToPlanSelection = () => {
    setStep(1);
  };

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validateFields = (): boolean => {
    const errors: Record<string, string> = {};

    if (!name.trim()) {
      errors.name = "Wpisz swoje imie i nazwisko, np. Jan Kowalski";
    }
    if (!email.trim()) {
      errors.email = "Podaj adres email, np. jan@example.com";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = "Nieprawidlowy format email. Wpisz adres w formacie: nazwa@domena.pl";
    }
    if (!password) {
      errors.password = "Podaj haslo (minimum 8 znakow)";
    } else if (password.length < 8) {
      errors.password = "Haslo jest za krotkie. Wpisz co najmniej 8 znakow";
    }
    if (!confirmPassword) {
      errors.confirmPassword = "Wpisz haslo ponownie w celu potwierdzenia";
    } else if (password !== confirmPassword) {
      errors.confirmPassword = "Hasla nie sa identyczne. Upewnij sie, ze oba pola zawieraja to samo haslo";
    }
    if (!legalAcceptanceComplete) {
      errors.legalAcceptance =
        "Zaznacz akceptację regulaminu i umowy powierzenia przetwarzania danych";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!validateFields()) {
      return;
    }

    setIsPending(true);

    try {
      const result = await signUp.email({
        name,
        email,
        password,
        callbackURL: "/dashboard",
      });

      if (result.error) {
        setError(sanitizeAuthError(result.error.message, "Nie udalo sie utworzyc konta"));
      } else {
        // Przy włączonym potwierdzaniu e-maila better-auth zwraca token: null, także
        // przy zajętym adresie (celowo ta sama odpowiedź). Bez sesji trasa salonu
        // odpowiedziałaby 401, więc jej nie wołamy i nie wysyłamy akceptacji
        // dokumentów; ekran potwierdzenia jest ten sam w obu przypadkach.
        const hasSession = typeof result.data?.token === "string";

        // Po rejestracji z sesją zakładamy salon z planem planOnSaleOr(selectedPlan).
        // Konto już istnieje, więc błąd salonu nie cofa rejestracji: przechodzimy
        // do potwierdzenia i tam go pokazujemy (salon można założyć w panelu).
        if (hasSession && selectedPlan) {
          setSalonSetupError("");
          try {
            const res = await mutationFetch("/api/register-subscription", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                planSlug: planOnSaleOr(selectedPlan),
                email,
                ...legalAcceptanceRequestFields(legalForm, legalChecks, "registration"),
              }),
            });
            const message = await salonSetupErrorMessage(res);
            if (message) setSalonSetupError(message);
          } catch {
            setSalonSetupError(SALON_SETUP_FALLBACK_ERROR);
          }
        }

        clearSavedForm();
        setShowVerificationMessage(true);
      }
    } catch {
      setError("Wystapil nieoczekiwany blad");
    } finally {
      setIsPending(false);
    }
  };

  return {
    // Step state
    step,
    selectedPlan,
    selectedPlanData,

    // Plans data
    plans,
    plansLoading,
    basicPlan,
    proPlan,

    // Form state
    name,
    setName,
    email,
    setEmail,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    error,
    setError,
    fieldErrors,
    isPending,
    showVerificationMessage,
    salonSetupError,

    // Akceptacja regulaminu i DPA (przed publikacją dokumentów legalForm = null)
    legalForm,
    legalChecks,
    setLegalChecks,
    legalAcceptanceComplete,

    // Form recovery
    wasRecovered: recoveredWithData,
    clearSavedForm,

    // Actions
    handleSelectPlan,
    handleContinueToAccount,
    handleBackToPlanSelection,
    clearFieldError,
    handleSubmit,
    handleRestoreForm,
    router,
  };
}
