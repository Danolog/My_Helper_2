"use client";

import Link from "next/link";
import {
  Shield,
  Database,
  Palette,
  Bot,
  Zap,
  Crown,
  Check,
  ArrowRight,
  Star,
} from "lucide-react";
import { SetupChecklist } from "@/components/setup-checklist";
import { StarterPromptModal } from "@/components/starter-prompt-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useDiagnostics } from "@/hooks/use-diagnostics";

/**
 * Static plan data for the homepage pricing preview.
 * These values are hardcoded to avoid an API call on the landing page.
 * The full pricing page at /pricing fetches dynamic data from the API.
 */
const PLANS_PREVIEW = {
  basic: {
    name: "Basic",
    price: 49,
    description:
      "Pelne zarzadzanie salonem bez narzedzi AI. Idealny na start.",
    features: [
      "Kalendarz pracownikow i grafiki",
      "Rezerwacje online i platnosci",
      "Kartoteka klientow",
      "Raporty i statystyki",
      "Powiadomienia SMS i email",
    ],
  },
  pro: {
    name: "Pro",
    price: 149,
    description:
      "Pelna funkcjonalnosc z asystentem AI glosowym, biznesowym i content marketingowym.",
    features: [
      "Wszystko z planu Basic",
      "Asystent glosowy AI",
      "Asystent biznesowy AI",
      "Generowanie tresci marketingowych",
      "Proaktywne sugestie i analizy",
    ],
  },
} as const;

export default function Home() {
  const { isAuthReady, isAiReady, loading } = useDiagnostics();
  return (
    <main className="flex-1 container mx-auto px-4 py-12">
      <div className="max-w-4xl mx-auto text-center space-y-8">
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-3 mb-2">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10">
              <Bot className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-5xl font-bold tracking-tight bg-gradient-to-r from-primary via-primary/90 to-primary/70 bg-clip-text text-transparent">
              MyHelper
            </h1>
          </div>
          <h2 className="text-2xl font-semibold text-muted-foreground">
            Twoj asystent dla salonu uslugowego
          </h2>
          <p className="text-xl text-muted-foreground">
            Przystepna cenowo alternatywa dla Booksy z asystentem AI,
            rezerwacjami online i zarzadzaniem salonem
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-12">
          <div className="p-6 border rounded-lg">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Authentication
            </h3>
            <p className="text-sm text-muted-foreground">
              Better Auth with Google OAuth integration
            </p>
          </div>
          <div className="p-6 border rounded-lg">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <Database className="h-4 w-4" />
              Database
            </h3>
            <p className="text-sm text-muted-foreground">
              Drizzle ORM with PostgreSQL setup
            </p>
          </div>
          <div className="p-6 border rounded-lg">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <Bot className="h-4 w-4" />
              AI Ready
            </h3>
            <p className="text-sm text-muted-foreground">
              Vercel AI SDK with OpenRouter integration
            </p>
          </div>
          <div className="p-6 border rounded-lg">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <Palette className="h-4 w-4" />
              UI Components
            </h3>
            <p className="text-sm text-muted-foreground">
              shadcn/ui with Tailwind CSS
            </p>
          </div>
        </div>

        {/* Pricing Preview Section */}
        <section className="mt-16 space-y-8" aria-labelledby="pricing-heading">
          <div className="text-center space-y-3">
            <Badge variant="secondary" className="text-sm px-4 py-1">
              <Star className="h-3.5 w-3.5 mr-1.5" />
              Cennik
            </Badge>
            <h3 id="pricing-heading" className="text-3xl font-bold tracking-tight">
              Wybierz plan dla siebie
            </h3>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Zacznij od 14-dniowego okresu probnego. Bez zobowiazan.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {/* Basic Plan Card */}
            <Card className="relative flex flex-col border-2 hover:shadow-lg transition-shadow">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-950">
                    <Zap className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <CardTitle className="text-xl">
                    {PLANS_PREVIEW.basic.name}
                  </CardTitle>
                </div>
                <CardDescription>
                  {PLANS_PREVIEW.basic.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <div className="mb-4">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold">
                      {PLANS_PREVIEW.basic.price}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      PLN / mies.
                    </span>
                  </div>
                </div>

                <div className="space-y-2.5 flex-1">
                  {PLANS_PREVIEW.basic.features.map((feature) => (
                    <div key={feature} className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-6">
                  <Button
                    asChild
                    className="w-full"
                    variant="outline"
                  >
                    <Link href="/register?plan=basic">
                      Zacznij za darmo
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Pro Plan Card */}
            <Card className="relative flex flex-col border-2 border-primary hover:shadow-lg transition-shadow">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="px-3 py-0.5 text-xs shadow-sm">
                  <Star className="h-3 w-3 mr-1" />
                  Najpopularniejszy
                </Badge>
              </div>
              <CardHeader className="pb-4 pt-8">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
                    <Crown className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-xl">
                    {PLANS_PREVIEW.pro.name}
                  </CardTitle>
                </div>
                <CardDescription>
                  {PLANS_PREVIEW.pro.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <div className="mb-4">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold">
                      {PLANS_PREVIEW.pro.price}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      PLN / mies.
                    </span>
                  </div>
                </div>

                <div className="space-y-2.5 flex-1">
                  {PLANS_PREVIEW.pro.features.map((feature) => (
                    <div key={feature} className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                      <span className="text-sm font-medium">{feature}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-6">
                  <Button asChild className="w-full">
                    <Link href="/register?plan=pro">
                      Wybierz Pro
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="text-center">
            <Button asChild variant="link" className="text-sm">
              <Link href="/pricing">
                Zobacz pelny cennik
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          </div>
        </section>

        <div className="space-y-6 mt-12">
          <SetupChecklist />

          <h3 className="text-2xl font-semibold">Next Steps</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
            <div className="p-4 border rounded-lg">
              <h4 className="font-medium mb-2">
                1. Set up environment variables
              </h4>
              <p className="text-sm text-muted-foreground mb-2">
                Copy <code>.env.example</code> to <code>.env.local</code> and
                configure:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>POSTGRES_URL (PostgreSQL connection string)</li>
                <li>GOOGLE_CLIENT_ID (OAuth credentials)</li>
                <li>GOOGLE_CLIENT_SECRET (OAuth credentials)</li>
                <li>OPENROUTER_API_KEY (for AI functionality)</li>
              </ul>
            </div>
            <div className="p-4 border rounded-lg">
              <h4 className="font-medium mb-2">2. Set up your database</h4>
              <p className="text-sm text-muted-foreground mb-2">
                Run database migrations:
              </p>
              <div className="space-y-2">
                <code className="text-sm bg-muted p-2 rounded block">
                  pnpm run db:generate
                </code>
                <code className="text-sm bg-muted p-2 rounded block">
                  pnpm run db:migrate
                </code>
              </div>
            </div>
            <div className="p-4 border rounded-lg">
              <h4 className="font-medium mb-2">3. Try the features</h4>
              <div className="space-y-2">
                {loading || !isAuthReady ? (
                  <Button size="sm" className="w-full" disabled={true}>
                    View Dashboard
                  </Button>
                ) : (
                  <Button asChild size="sm" className="w-full">
                    <Link href="/dashboard">View Dashboard</Link>
                  </Button>
                )}
                {loading || !isAiReady ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={true}
                  >
                    Try AI Chat
                  </Button>
                ) : (
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    <Link href="/chat">Try AI Chat</Link>
                  </Button>
                )}
              </div>
            </div>
            <div className="p-4 border rounded-lg">
              <h4 className="font-medium mb-2">4. Start building</h4>
              <p className="text-sm text-muted-foreground mb-3">
                Customize the components, add your own pages, and build your
                application on top of this solid foundation.
              </p>
              <StarterPromptModal />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
