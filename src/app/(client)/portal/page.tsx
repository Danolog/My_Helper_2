import Link from "next/link"
import { redirect } from "next/navigation"
import { Scissors, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { hasActiveSession } from "@/lib/session"

export default async function ClientPortalPage() {
  const isLoggedIn = await hasActiveSession()

  if (isLoggedIn) {
    redirect("/salons")
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md border-border/60">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
            <Scissors className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="font-[family-name:var(--font-playfair)] text-2xl">
            Portal klienta
          </CardTitle>
          <CardDescription>
            Rezerwuj wizyty, przegladaj uslugi i zarzadzaj swoimi wizytami online.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button asChild className="w-full rounded-full" size="lg">
            <Link href="/portal/register">
              Zaloz konto
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full rounded-full" size="lg">
            <Link href="/login">Zaloguj sie</Link>
          </Button>
          <div className="text-center text-sm text-muted-foreground pt-2">
            Prowadzisz salon?{" "}
            <Link href="/register" className="text-primary hover:underline">
              Zarejestruj salon
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
