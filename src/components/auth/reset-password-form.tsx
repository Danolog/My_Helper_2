"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { resetPassword } from "@/lib/auth-client"
import { sanitizeAuthError } from "@/lib/error-messages"

/**
 * Usuwa parametr `token` z paska adresu bez nawigacji (bez fetchu RSC).
 * Adres z tokenem nie zostaje w historii przeglądarki (współdzielony komputer
 * w salonie) ani w nagłówku Referer kolejnych żądań.
 *
 * Stan `null`: Next.js przejmuje wtedy wywołanie (zachowuje swój stan historii
 * i przepisuje adres do stanu routera). Przekazanie stanu routera (`__NA`)
 * ominęłoby tę synchronizację, a router przy najbliższej zmianie stanu
 * przywróciłby w pasku adres z tokenem.
 */
function removeTokenFromAddressBar() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has("token")) return
  url.searchParams.delete("token")
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
}

export function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Token czytany RAZ, przy pierwszym renderze. W Next 16 history.replaceState
  // aktualizuje useSearchParams, więc po usunięciu tokenu z adresu
  // searchParams.get("token") dałoby null i formularz pokazałby „Brak tokenu”.
  const [token] = useState(() => searchParams.get("token"))
  const error = searchParams.get("error")

  useEffect(() => {
    removeTokenFromAddressBar()
  }, [])

  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [formError, setFormError] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isPending, setIsPending] = useState(false)

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  if (error === "invalid_token" || !token) {
    return (
      <div className="space-y-4 w-full max-w-sm text-center">
        <p className="text-sm text-destructive">
          {error === "invalid_token"
            ? "Ten link do resetowania hasla jest nieprawidlowy lub wygasl."
            : "Brak tokenu resetowania. Uzyj linku z wiadomosci email."}
        </p>
        <Link href="/forgot-password">
          <Button variant="outline" className="w-full">
            Wyslij nowy link
          </Button>
        </Link>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError("")

    // Validate required fields
    const errors: Record<string, string> = {}
    if (!password) {
      errors.password = "Podaj nowe haslo (minimum 8 znakow)"
    } else if (password.length < 8) {
      errors.password = "Haslo jest za krotkie. Wpisz co najmniej 8 znakow"
    }
    if (!confirmPassword) {
      errors.confirmPassword = "Wpisz haslo ponownie w celu potwierdzenia"
    } else if (password !== confirmPassword) {
      errors.confirmPassword = "Hasla nie sa identyczne. Upewnij sie, ze oba pola zawieraja to samo haslo"
    }
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      return
    }

    setIsPending(true)

    try {
      const result = await resetPassword({
        newPassword: password,
        token,
      })

      if (result.error) {
        setFormError(sanitizeAuthError(result.error.message, "Nie udalo sie zresetowac hasla. Sprobuj ponownie."))
      } else {
        router.replace("/login?reset=success")
      }
    } catch {
      setFormError("Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej.")
    } finally {
      setIsPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4 w-full max-w-sm">
      <div className="space-y-2">
        <Label htmlFor="password">Nowe haslo</Label>
        <Input
          id="password"
          type="password"
          placeholder="Wprowadz nowe haslo"
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
        <Label htmlFor="confirmPassword">Potwierdz nowe haslo</Label>
        <Input
          id="confirmPassword"
          type="password"
          placeholder="Potwierdz nowe haslo"
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
      {formError && (
        <p className="text-sm text-destructive">{formError}</p>
      )}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Resetowanie..." : "Zresetuj haslo"}
      </Button>
    </form>
  )
}
