"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams, useRouter } from "next/navigation"
import { CheckCircle2, XCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { clientHomePath } from "@/lib/features"

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get("token")
  // Brak tokenu znamy już przy pierwszym renderze — to stan początkowy,
  // nie efekt (react-hooks/set-state-in-effect).
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    token ? "loading" : "error"
  )
  const [errorMessage, setErrorMessage] = useState(
    token ? "" : "No verification token provided"
  )

  useEffect(() => {
    if (!token) {
      return
    }

    const verifyEmail = async () => {
      try {
        const response = await fetch(`/api/auth/verify-email?token=${token}`)
        if (response.ok || response.redirected) {
          setStatus("success")
        } else {
          const data = await response.json().catch(() => null)
          setStatus("error")
          setErrorMessage(data?.message || "Verification failed. The link may have expired.")
        }
      } catch {
        setStatus("error")
        setErrorMessage("An error occurred during verification")
      }
    }

    verifyEmail()
  }, [token])

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Email Verification</CardTitle>
          <CardDescription>
            {status === "loading" && "Verifying your email address..."}
            {status === "success" && "Your email has been verified!"}
            {status === "error" && "Verification failed"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center space-y-4">
          {status === "loading" && (
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
          )}
          {status === "success" && (
            <>
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="text-sm text-muted-foreground text-center">
                Your email address has been successfully verified. You can now access all features.
              </p>
              <Button
                className="w-full"
                onClick={() => {
                  // Portal klienta: konto klienta nie ma salonu, więc kierujemy
                  // do portalu (clientHomePath), nie do panelu salonu.
                  router.replace(clientHomePath())
                  router.refresh()
                }}
              >
                Przejdź do portalu
              </Button>
            </>
          )}
          {status === "error" && (
            <>
              <XCircle className="h-12 w-12 text-destructive" />
              <p className="text-sm text-destructive text-center">{errorMessage}</p>
              <div className="flex gap-2 w-full">
                <Button asChild variant="outline" className="flex-1">
                  <Link href="/login">Sign in</Link>
                </Button>
                <Button asChild className="flex-1">
                  <Link href="/portal/register">Register again</Link>
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  )
}
