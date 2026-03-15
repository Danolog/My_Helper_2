"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Check,
  Crown,
  Zap,
  ArrowRight,
  ArrowLeft,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signUp, sendVerificationEmail } from "@/lib/auth-client"
import { sanitizeAuthError } from "@/lib/error-messages"
import { useFormRecovery } from "@/hooks/use-form-recovery"
import { FormRecoveryBanner } from "@/components/form-recovery-banner"
import { mutationFetch } from "@/lib/api-client"
import { TRIAL_DAYS } from "@/lib/constants"

type Plan = {
  id: string
  name: string
  slug: string
  priceMonthly: string
  features: string[]
  isActive: boolean
}

interface RegistrationFlowProps {
  preselectedPlan: string | null
}

export function RegistrationFlow({ preselectedPlan }: RegistrationFlowProps) {
  const router = useRouter()

  // Step management: 1 = plan selection, 2 = account details
  const [step, setStep] = useState(preselectedPlan ? 2 : 1)
  const [selectedPlan, setSelectedPlan] = useState<string | null>(
    preselectedPlan
  )

  // Plans data
  const [plans, setPlans] = useState<Plan[]>([])
  const [plansLoading, setPlansLoading] = useState(true)

  // Account form state
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isPending, setIsPending] = useState(false)
  const [showVerificationMessage, setShowVerificationMessage] = useState(false)

  // Form recovery after page refresh
  const {
    wasRecovered,
    getRecoveredState,
    saveFormState,
    clearSavedForm,
    setDirty,
  } = useFormRecovery<{
    step: number
    selectedPlan: string | null
    name: string
    email: string
  }>({
    storageKey: "registration-form",
    warnOnUnload: true,
  })

  // Recovery handler: restores form fields from localStorage
  const handleRestoreForm = () => {
    const saved = getRecoveredState()
    if (saved) {
      if (saved.name) setName(saved.name)
      if (saved.email) setEmail(saved.email)
      if (saved.selectedPlan) setSelectedPlan(saved.selectedPlan)
      if (saved.step) setStep(saved.step)
    }
  }

  // Save form state on every change (debounced inside hook)
  useEffect(() => {
    const hasData = !!name || !!email || !!selectedPlan
    saveFormState({ step, selectedPlan, name, email })
    setDirty(hasData)
  }, [step, selectedPlan, name, email, saveFormState, setDirty])

  // Fetch subscription plans
  useEffect(() => {
    async function fetchPlans() {
      try {
        const res = await fetch("/api/subscription-plans")
        if (!res.ok) throw new Error("Failed to fetch plans")
        const data = await res.json()
        if (data.success) {
          setPlans(data.data)
        }
      } catch {
        // Plans will show empty - user can still register
      } finally {
        setPlansLoading(false)
      }
    }
    fetchPlans()
  }, [])

  const basicPlan = plans.find((p) => p.slug === "basic")
  const proPlan = plans.find((p) => p.slug === "pro")
  const selectedPlanData = plans.find((p) => p.slug === selectedPlan)

  const handleSelectPlan = (slug: string) => {
    setSelectedPlan(slug)
  }

  const handleContinueToAccount = () => {
    if (selectedPlan) {
      setStep(2)
    }
  }

  const handleBackToPlanSelection = () => {
    setStep(1)
  }

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  const validateFields = (): boolean => {
    const errors: Record<string, string> = {}

    if (!name.trim()) {
      errors.name = "Wpisz swoje imie i nazwisko, np. Jan Kowalski"
    }
    if (!email.trim()) {
      errors.email = "Podaj adres email, np. jan@example.com"
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = "Nieprawidlowy format email. Wpisz adres w formacie: nazwa@domena.pl"
    }
    if (!password) {
      errors.password = "Podaj haslo (minimum 8 znakow)"
    } else if (password.length < 8) {
      errors.password = "Haslo jest za krotkie. Wpisz co najmniej 8 znakow"
    }
    if (!confirmPassword) {
      errors.confirmPassword = "Wpisz haslo ponownie w celu potwierdzenia"
    } else if (password !== confirmPassword) {
      errors.confirmPassword = "Hasla nie sa identyczne. Upewnij sie, ze oba pola zawieraja to samo haslo"
    }

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!validateFields()) {
      return
    }

    setIsPending(true)

    try {
      const result = await signUp.email({
        name,
        email,
        password,
        callbackURL: "/dashboard",
      })

      if (result.error) {
        setError(sanitizeAuthError(result.error.message, "Nie udalo sie utworzyc konta"))
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
            })
          } catch {
            // Non-critical — subscription can be set up later
          }
        }

        clearSavedForm()
        setShowVerificationMessage(true)
      }
    } catch {
      setError("Wystapil nieoczekiwany blad")
    } finally {
      setIsPending(false)
    }
  }

  // Verification message after successful signup
  if (showVerificationMessage) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Konto utworzone!</CardTitle>
          <CardDescription>Jeszcze jeden krok...</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950 p-4 text-center">
            <h3 className="font-semibold text-green-800 dark:text-green-200 mb-2">
              Konto zostalo utworzone pomyslnie!
            </h3>
            <p className="text-sm text-green-700 dark:text-green-300">
              Wyslalismy email weryfikacyjny na adres{" "}
              <strong>{email}</strong>. Kliknij link w wiadomosci, aby
              aktywowac konto.
            </p>
          </div>

          {selectedPlanData && (
            <div className="rounded-lg border p-4 text-center">
              <p className="text-sm text-muted-foreground mb-1">
                Wybrany plan
              </p>
              <div className="flex items-center justify-center gap-2">
                {selectedPlan === "pro" ? (
                  <Crown className="h-5 w-5 text-primary" />
                ) : (
                  <Zap className="h-5 w-5 text-blue-600" />
                )}
                <span className="font-semibold text-lg">
                  {selectedPlanData.name}
                </span>
                <span className="text-muted-foreground">
                  - {parseFloat(selectedPlanData.priceMonthly).toFixed(0)}{" "}
                  PLN/mies.
                </span>
              </div>
            </div>
          )}

          <Button
            className="w-full"
            onClick={() => {
              router.replace("/dashboard")
              router.refresh()
            }}
          >
            Przejdz do aplikacji
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>

          <div className="text-center text-sm text-muted-foreground">
            Nie otrzymales emaila?{" "}
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={async () => {
                try {
                  await sendVerificationEmail({
                    email,
                    callbackURL: "/dashboard",
                  })
                  setError("")
                } catch {
                  setError("Nie udalo sie ponownie wyslac emaila")
                }
              }}
            >
              Wyslij ponownie
            </button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Step 1: Plan Selection
  if (step === 1) {
    return (
      <div className="w-full max-w-3xl">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground font-semibold text-sm">
              1
            </div>
            <span className="text-sm font-medium">Wybierz plan</span>
          </div>
          <div className="w-8 h-px bg-border" />
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted text-muted-foreground font-semibold text-sm">
              2
            </div>
            <span className="text-sm text-muted-foreground">Dane konta</span>
          </div>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            Wybierz plan dla siebie
          </h1>
          <p className="text-muted-foreground">
            Zacznij od {TRIAL_DAYS}-dniowego okresu probnego bez zobowiazan
          </p>
        </div>

        {plansLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {/* Basic Plan Card */}
              {basicPlan && (
                <button
                  type="button"
                  onClick={() => handleSelectPlan("basic")}
                  className="text-left"
                >
                  <Card
                    className={`relative flex flex-col h-full transition-all cursor-pointer hover:shadow-lg ${
                      selectedPlan === "basic"
                        ? "border-2 border-blue-600 ring-2 ring-blue-200 dark:ring-blue-900 shadow-lg"
                        : "border-2 border-transparent hover:border-muted-foreground/20"
                    }`}
                  >
                    {selectedPlan === "basic" && (
                      <div className="absolute top-3 right-3">
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white">
                          <Check className="h-4 w-4" />
                        </div>
                      </div>
                    )}
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950">
                          <Zap className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <CardTitle className="text-xl">
                          {basicPlan.name}
                        </CardTitle>
                      </div>
                      <CardDescription>
                        Pelne zarzadzanie salonem bez narzedzi AI
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col">
                      <div className="mb-4">
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-bold">
                            {parseFloat(basicPlan.priceMonthly).toFixed(0)}
                          </span>
                          <span className="text-muted-foreground">
                            PLN / mies.
                          </span>
                        </div>
                      </div>
                      <div className="space-y-2 flex-1">
                        {basicPlan.features.slice(0, 5).map((feature, idx) => (
                          <div key={idx} className="flex items-start gap-2">
                            <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                            <span className="text-sm">{feature}</span>
                          </div>
                        ))}
                        {basicPlan.features.length > 5 && (
                          <p className="text-xs text-muted-foreground pl-6">
                            +{basicPlan.features.length - 5} wiecej funkcji
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </button>
              )}

              {/* Pro Plan Card */}
              {proPlan && (
                <button
                  type="button"
                  onClick={() => handleSelectPlan("pro")}
                  className="text-left"
                >
                  <Card
                    className={`relative flex flex-col h-full transition-all cursor-pointer hover:shadow-lg ${
                      selectedPlan === "pro"
                        ? "border-2 border-primary ring-2 ring-primary/20 shadow-lg"
                        : "border-2 border-transparent hover:border-muted-foreground/20"
                    }`}
                  >
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="px-3 py-0.5 text-xs shadow-sm">
                        Najpopularniejszy
                      </Badge>
                    </div>
                    {selectedPlan === "pro" && (
                      <div className="absolute top-3 right-3">
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground">
                          <Check className="h-4 w-4" />
                        </div>
                      </div>
                    )}
                    <CardHeader className="pb-3 pt-6">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                          <Crown className="h-5 w-5 text-primary" />
                        </div>
                        <CardTitle className="text-xl">
                          {proPlan.name}
                        </CardTitle>
                      </div>
                      <CardDescription>
                        Pelna funkcjonalnosc z asystentem AI
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col">
                      <div className="mb-4">
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-bold">
                            {parseFloat(proPlan.priceMonthly).toFixed(0)}
                          </span>
                          <span className="text-muted-foreground">
                            PLN / mies.
                          </span>
                        </div>
                      </div>
                      <div className="space-y-2 flex-1">
                        {proPlan.features.slice(0, 5).map((feature, idx) => (
                          <div key={idx} className="flex items-start gap-2">
                            <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                            <span className="text-sm font-medium">
                              {feature}
                            </span>
                          </div>
                        ))}
                        {proPlan.features.length > 5 && (
                          <p className="text-xs text-muted-foreground pl-6">
                            +{proPlan.features.length - 5} wiecej funkcji
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </button>
              )}
            </div>

            <div className="flex flex-col items-center gap-4">
              <Button
                size="lg"
                onClick={handleContinueToAccount}
                disabled={!selectedPlan}
                className="min-w-[200px]"
              >
                Dalej
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
              <div className="text-center text-sm text-muted-foreground">
                Masz juz konto?{" "}
                <Link href="/login" className="text-primary hover:underline">
                  Zaloguj sie
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  // Step 2: Account Details
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground font-semibold text-sm">
              <Check className="h-4 w-4" />
            </div>
            <span className="text-sm text-muted-foreground">Plan</span>
          </div>
          <div className="w-8 h-px bg-primary" />
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground font-semibold text-sm">
              2
            </div>
            <span className="text-sm font-medium">Dane konta</span>
          </div>
        </div>

        {/* Selected plan summary */}
        {selectedPlanData && (
          <button
            type="button"
            onClick={handleBackToPlanSelection}
            className="flex items-center justify-center gap-2 mx-auto mb-2 px-3 py-1.5 rounded-full border bg-muted/50 hover:bg-muted transition-colors"
          >
            {selectedPlan === "pro" ? (
              <Crown className="h-4 w-4 text-primary" />
            ) : (
              <Zap className="h-4 w-4 text-blue-600" />
            )}
            <span className="text-sm font-medium">
              Plan {selectedPlanData.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {parseFloat(selectedPlanData.priceMonthly).toFixed(0)} PLN/mies.
            </span>
          </button>
        )}

        <CardTitle>Utwórz konto</CardTitle>
        <CardDescription>Wypelnij dane, aby rozpoczac</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        {wasRecovered && (
          <div className="w-full max-w-sm">
            <FormRecoveryBanner
              onRestore={handleRestoreForm}
              onDismiss={clearSavedForm}
            />
          </div>
        )}
        <form onSubmit={handleSubmit} noValidate className="space-y-4 w-full max-w-sm">
          <div className="space-y-2">
            <Label htmlFor="name">Imie i nazwisko</Label>
            <Input
              id="name"
              type="text"
              placeholder="Jan Kowalski"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                clearFieldError("name")
              }}
              required
              aria-invalid={!!fieldErrors.name}
              disabled={isPending}
            />
            {fieldErrors.name && (
              <p className="text-sm text-destructive">{fieldErrors.name}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="jan@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                clearFieldError("email")
              }}
              required
              aria-invalid={!!fieldErrors.email}
              disabled={isPending}
            />
            {fieldErrors.email && (
              <p className="text-sm text-destructive">{fieldErrors.email}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Haslo</Label>
            <Input
              id="password"
              type="password"
              placeholder="Minimum 8 znakow"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                clearFieldError("password")
              }}
              required
              aria-invalid={!!fieldErrors.password}
              disabled={isPending}
            />
            {fieldErrors.password && (
              <p className="text-sm text-destructive">{fieldErrors.password}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Powtorz haslo</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="Powtorz haslo"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value)
                clearFieldError("confirmPassword")
              }}
              required
              aria-invalid={!!fieldErrors.confirmPassword}
              disabled={isPending}
            />
            {fieldErrors.confirmPassword && (
              <p className="text-sm text-destructive">{fieldErrors.confirmPassword}</p>
            )}
          </div>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleBackToPlanSelection}
              disabled={isPending}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Wstecz
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Tworzenie konta...
                </>
              ) : (
                "Utwórz konto"
              )}
            </Button>
          </div>
          <div className="text-center text-sm text-muted-foreground">
            Masz juz konto?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Zaloguj sie
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
