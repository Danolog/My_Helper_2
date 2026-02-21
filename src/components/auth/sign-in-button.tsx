"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signIn, useSession } from "@/lib/auth-client"
import { sanitizeAuthError } from "@/lib/error-messages"

/**
 * Validate returnTo URL to prevent open redirects.
 * Only allows relative paths that start with "/" but not "//".
 */
function isSafeReturnTo(url: string | null | undefined): string {
  if (!url) return "/dashboard"
  if (url.startsWith("/") && !url.startsWith("//")) return url
  return "/dashboard"
}

interface SignInButtonProps {
  returnTo?: string | undefined
}

export function SignInButton({ returnTo }: SignInButtonProps) {
  const { data: session, isPending: sessionPending } = useSession()
  const router = useRouter()
  // Determine the redirect destination after login, with open-redirect protection
  const redirectTo = isSafeReturnTo(returnTo)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isPending, setIsPending] = useState(false)
  const [isGooglePending, setIsGooglePending] = useState(false)

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  if (sessionPending) {
    return <Button disabled>Ladowanie...</Button>
  }

  if (session) {
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    // Validate required fields
    const errors: Record<string, string> = {}
    if (!email.trim()) {
      errors.email = "Wpisz adres email powiazany z kontem, np. jan@example.com"
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = "Nieprawidlowy format email. Wpisz adres w formacie: nazwa@domena.pl"
    }
    if (!password) {
      errors.password = "Wpisz haslo do logowania. Jesli nie pamietasz, uzyj opcji 'Nie pamietam hasla'"
    }
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      return
    }

    setIsPending(true)

    try {
      const result = await signIn.email({
        email,
        password,
        callbackURL: redirectTo,
      })

      if (result.error) {
        setError(sanitizeAuthError(result.error.message, "Nie udalo sie zalogowac. Sprawdz dane i sprobuj ponownie."))
      } else {
        router.replace(redirectTo)
        router.refresh()
      }
    } catch {
      setError("Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej.")
    } finally {
      setIsPending(false)
    }
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
          placeholder="Twoje haslo"
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
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      <Button type="submit" className="w-full" disabled={isPending || isGooglePending}>
        {isPending ? "Logowanie..." : "Zaloguj sie"}
      </Button>
      <div className="relative my-2">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">lub</span>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={isPending || isGooglePending}
        onClick={async () => {
          setIsGooglePending(true)
          try {
            await signIn.social({
              provider: "google",
              callbackURL: redirectTo,
            })
          } catch {
            setError("Nie udalo sie zalogowac przez Google. Sprobuj ponownie.")
          } finally {
            setIsGooglePending(false)
          }
        }}
      >
        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        {isGooglePending ? "Logowanie..." : "Zaloguj sie przez Google"}
      </Button>
      <div className="text-center text-sm text-muted-foreground">
        <Link href="/forgot-password" className="hover:underline">
          Nie pamietam hasla
        </Link>
      </div>
      <div className="text-center text-sm text-muted-foreground">
        Nie masz konta?{" "}
        <Link href="/register" className="text-primary hover:underline">
          Zarejestruj sie
        </Link>
      </div>
    </form>
  )
}
