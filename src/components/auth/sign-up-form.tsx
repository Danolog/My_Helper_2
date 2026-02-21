"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signUp } from "@/lib/auth-client"
import { validatePhone } from "@/lib/validations"
import { sanitizeAuthError } from "@/lib/error-messages"

interface SignUpFormProps {
  /** Where to redirect after successful signup */
  redirectTo?: string
  /** Show phone field (for client portal registration) */
  showPhone?: boolean
  /** Link for "Already have an account?" */
  loginHref?: string
}

export function SignUpForm({
  redirectTo = "/dashboard",
  showPhone = false,
  loginHref = "/login",
}: SignUpFormProps = {}) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isPending, setIsPending] = useState(false)
  const [showVerificationMessage, setShowVerificationMessage] = useState(false)

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    // Validate required fields
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
    if (showPhone && phone.trim()) {
      const phoneError = validatePhone(phone)
      if (phoneError) {
        errors.phone = phoneError
      }
    }
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      return
    }

    setIsPending(true)

    try {
      const result = await signUp.email({
        name,
        email,
        password,
        callbackURL: redirectTo,
        ...(showPhone && phone ? { phone } : {}),
      })

      if (result.error) {
        setError(sanitizeAuthError(result.error.message, "Nie udalo sie utworzyc konta. Sprobuj ponownie."))
      } else {
        // Show verification message instead of immediately redirecting
        setShowVerificationMessage(true)
      }
    } catch {
      setError("Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej.")
    } finally {
      setIsPending(false)
    }
  }

  if (showVerificationMessage) {
    return (
      <div className="space-y-4 w-full max-w-sm text-center">
        <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950 p-4">
          <h3 className="font-semibold text-green-800 dark:text-green-200 mb-2">
            Konto zostalo utworzone!
          </h3>
          <p className="text-sm text-green-700 dark:text-green-300">
            Wyslalismy email weryfikacyjny na adres <strong>{email}</strong>.
            Sprawdz skrzynke pocztowa i kliknij link, aby aktywowac konto.
          </p>
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            router.replace(redirectTo)
            router.refresh()
          }}
        >
          Przejdz do aplikacji
        </Button>
        <div className="text-center text-sm text-muted-foreground">
          Nie otrzymales emaila?{" "}
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={async () => {
              try {
                const { sendVerificationEmail } = await import("@/lib/auth-client")
                await sendVerificationEmail({ email, callbackURL: redirectTo })
                setError("")
              } catch {
                setError("Nie udalo sie wyslac ponownie emaila weryfikacyjnego. Sprobuj pozniej.")
              }
            }}
          >
            Wyslij ponownie
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4 w-full max-w-sm">
      <div className="space-y-2">
        <Label htmlFor="name">Imie i nazwisko</Label>
        <Input
          id="name"
          type="text"
          placeholder="Twoje imie i nazwisko"
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
          placeholder="you@example.com"
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
      {showPhone && (
        <div className="space-y-2">
          <Label htmlFor="phone">Telefon</Label>
          <Input
            id="phone"
            type="tel"
            placeholder="+48 123 456 789"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value)
              clearFieldError("phone")
            }}
            aria-invalid={!!fieldErrors.phone}
            disabled={isPending}
          />
          {fieldErrors.phone && (
            <p className="text-sm text-destructive">{fieldErrors.phone}</p>
          )}
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="password">Haslo</Label>
        <Input
          id="password"
          type="password"
          placeholder="Utworz haslo"
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
        <Label htmlFor="confirmPassword">Potwierdz haslo</Label>
        <Input
          id="confirmPassword"
          type="password"
          placeholder="Potwierdz haslo"
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
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Tworzenie konta..." : "Utworz konto"}
      </Button>
      <div className="text-center text-sm text-muted-foreground">
        Masz juz konto?{" "}
        <Link href={loginHref} className="text-primary hover:underline">
          Zaloguj sie
        </Link>
      </div>
    </form>
  )
}
