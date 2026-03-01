import { redirect } from "next/navigation"
import Link from "next/link"
import { SignInButton } from "@/components/auth/sign-in-button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { hasActiveSession } from "@/lib/session"

/**
 * Validate returnTo URL to prevent open redirects.
 * Only allows relative paths that start with "/" but not "//".
 */
function isSafeReturnTo(url: string | null | undefined): string {
  if (!url) return "/dashboard"
  if (url.startsWith("/") && !url.startsWith("//")) return url
  return "/dashboard"
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; returnTo?: string }>
}) {
  const isLoggedIn = await hasActiveSession()

  const { reset, returnTo } = await searchParams

  if (isLoggedIn) {
    redirect(isSafeReturnTo(returnTo))
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Panel salonu</CardTitle>
          <CardDescription>Zaloguj sie do panelu zarzadzania salonem</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center">
          {reset === "success" && (
            <p className="mb-4 text-sm text-green-600 dark:text-green-400">
              Haslo zostalo zresetowane. Zaloguj sie nowym haslem.
            </p>
          )}
          <SignInButton returnTo={returnTo} defaultRedirect="/dashboard" registerHref="/register" />
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Jestes klientem?{" "}
            <Link href="/portal/login" className="text-primary hover:underline">
              Zaloguj sie tutaj
            </Link>
          </p>
          <div className="mt-3 flex flex-col items-center gap-1 text-sm text-muted-foreground">
            <Link href="/salons" className="text-primary hover:underline">
              Przegladaj salony bez logowania
            </Link>
            <Link href="/" className="hover:underline">
              Powrot do strony glownej
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
