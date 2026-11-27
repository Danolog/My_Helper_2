import Link from "next/link"
import { redirect } from "next/navigation"
import { SignInButton } from "@/components/auth/sign-in-button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { clientHomePath, isModuleFrozen } from "@/lib/features"
import { isGoogleAuthConfigured } from "@/lib/google-auth"
import { clientAccountLegalNotice } from "@/lib/legal/documents"
import { getOptionalSession } from "@/lib/session"

/**
 * Validate returnTo URL to prevent open redirects.
 * Only allows relative paths that start with "/" but not "//".
 */
function isSafeReturnTo(url: string | null | undefined): string {
  if (!url) return clientHomePath()
  if (url.startsWith("/") && !url.startsWith("//")) return url
  return clientHomePath()
}

export default async function ClientLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; returnTo?: string }>
}) {
  // Sesja sprawdzona w bazie, nie sama obecność ciasteczka. Ciasteczko z
  // nieważnym podpisem (np. po zmianie sekretu) zostaje w przeglądarce, a strony
  // portalu widzą brak sesji i kierują tutaj — odesłanie na `returnTo` dałoby pętlę.
  const session = await getOptionalSession()

  const { reset, returnTo } = await searchParams

  if (session) {
    redirect(isSafeReturnTo(returnTo))
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Konto klienta</CardTitle>
          <CardDescription>Zaloguj sie, aby zobaczyc swoje wizyty</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center">
          {reset === "success" && (
            <p className="mb-4 text-sm text-green-600 dark:text-green-400">
              Haslo zostalo zresetowane. Zaloguj sie nowym haslem.
            </p>
          )}
          <SignInButton
            returnTo={returnTo}
            defaultRedirect={clientHomePath()}
            registerHref="/portal/register"
            googleEnabled={isGoogleAuthConfigured()}
            googleLegalNotice={clientAccountLegalNotice()}
          />
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Prowadzisz salon?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Zaloguj sie tutaj
            </Link>
          </p>
          <div className="mt-3 flex flex-col items-center gap-1 text-sm text-muted-foreground">
            {/* Katalog salonów zamrożony (`salonCatalog`) — bez linku do listy. */}
            {!isModuleFrozen("salonCatalog") && (
              <Link href="/salons" className="text-primary hover:underline">
                Przegladaj salony bez logowania
              </Link>
            )}
            <Link href="/" className="hover:underline">
              Powrot do strony glownej
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
