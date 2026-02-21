"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { requestPasswordReset } from "@/lib/auth-client"
import { sanitizeAuthError } from "@/lib/error-messages"

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState(false)
  const [isPending, setIsPending] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    // Validate required fields
    const errors: Record<string, string> = {}
    if (!email.trim()) {
      errors.email = "Podaj adres email przypisany do konta"
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = "Nieprawidlowy format email. Wpisz adres w formacie: nazwa@domena.pl"
    }
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      return
    }

    setIsPending(true)

    try {
      const result = await requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      })

      if (result.error) {
        setError(sanitizeAuthError(result.error.message, "Nie udalo sie wyslac linku resetowania hasla. Sprobuj ponownie."))
      } else {
        setSuccess(true)
      }
    } catch {
      setError("Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej.")
    } finally {
      setIsPending(false)
    }
  }

  if (success) {
    return (
      <div className="space-y-4 w-full max-w-sm text-center">
        <p className="text-sm text-muted-foreground">
          Jesli konto z tym adresem email istnieje, link do resetowania hasla zostal wyslany.
          Sprawdz skrzynke pocztowa.
        </p>
        <Link href="/login">
          <Button variant="outline" className="w-full">
            Powrot do logowania
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4 w-full max-w-sm">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setFieldErrors({})
          }}
          required
          aria-invalid={!!fieldErrors.email}
          disabled={isPending}
        />
        {fieldErrors.email && (
          <p className="text-sm text-destructive">{fieldErrors.email}</p>
        )}
      </div>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Wysylanie..." : "Wyslij link resetowania"}
      </Button>
      <div className="text-center text-sm text-muted-foreground">
        Pamietasz haslo?{" "}
        <Link href="/login" className="text-primary hover:underline">
          Zaloguj sie
        </Link>
      </div>
    </form>
  )
}
