import { redirect } from "next/navigation"
import { SignUpForm } from "@/components/auth/sign-up-form"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { hasActiveSession } from "@/lib/session"

export default async function ClientRegistrationPage() {
  const isLoggedIn = await hasActiveSession()

  if (isLoggedIn) {
    redirect("/salons")
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Załóż konto klienta</CardTitle>
          <CardDescription>
            Rezerwuj wizyty, przeglądaj salony i zarządzaj swoimi wizytami.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center">
          <SignUpForm
            showPhone={true}
            redirectTo="/salons"
            loginHref="/portal/login"
          />
        </CardContent>
      </Card>
    </div>
  )
}
