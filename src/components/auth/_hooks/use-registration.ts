"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signUp } from "@/lib/auth-client";
import { sanitizeAuthError } from "@/lib/error-messages";
import { useFormRecovery } from "@/hooks/use-form-recovery";
import { mutationFetch } from "@/lib/api-client";

export type Plan = {
  id: string;
  name: string;
  slug: string;
  priceMonthly: string;
  features: string[];
  isActive: boolean;
};

export function useRegistration(preselectedPlan: string | null) {
  const router = useRouter();

  // Step management: 1 = plan selection, 2 = account details
  const [step, setStep] = useState(preselectedPlan ? 2 : 1);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(
    preselectedPlan
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

  // Recovery handler: restores form fields from localStorage
  const handleRestoreForm = () => {
    const saved = getRecoveredState();
    if (saved) {
      if (saved.name) setName(saved.name);
      if (saved.email) setEmail(saved.email);
      if (saved.selectedPlan) setSelectedPlan(saved.selectedPlan);
      if (saved.step) setStep(saved.step);
    }
  };

  // Save form state on every change (debounced inside hook)
  useEffect(() => {
    const hasData = !!name || !!email || !!selectedPlan;
    saveFormState({ step, selectedPlan, name, email });
    setDirty(hasData);
  }, [step, selectedPlan, name, email, saveFormState, setDirty]);

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
  const proPlan = plans.find((p) => p.slug === "pro");
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
        // After signup, create salon subscription with selected plan
        if (selectedPlan) {
          try {
            await mutationFetch("/api/register-subscription", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                planSlug: selectedPlan,
                email,
              }),
            });
          } catch {
            // Non-critical — subscription can be set up later
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

    // Form recovery
    wasRecovered,
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
