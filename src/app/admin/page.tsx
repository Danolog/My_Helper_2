import Link from "next/link";
import {
  Shield,
  Users,
  Settings,
  BarChart3,
  Calendar,
  CreditCard,
  ArrowLeft,
  ShieldAlert,
  Home,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/session";

export default async function AdminPage() {
  const { session, isAdmin } = await requireAdmin();

  // Access denied for non-admin users
  if (!isAdmin) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10">
                <ShieldAlert className="h-8 w-8 text-destructive" />
              </div>
            </div>
            <CardTitle className="text-2xl">Brak dostepu</CardTitle>
            <CardDescription className="text-base">
              Nie masz uprawnien do wyswietlenia panelu administracyjnego.
              Ta strona jest dostepna tylko dla wlascicieli salonow.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Zalogowany jako: <span className="font-medium">{session!.user.email}</span>
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <Button asChild>
                <Link href="/dashboard">
                  <Home className="mr-2 h-4 w-4" />
                  Przejdz do panelu
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Strona glowna
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Admin panel for authorized users
  const adminSections = [
    {
      title: "Pracownicy",
      description: "Zarzadzaj pracownikami, uprawnieniami i harmonogramami",
      icon: Users,
      href: "/dashboard/employees",
      badge: null,
    },
    {
      title: "Ustawienia",
      description: "Konfiguracja salonu, integracje i preferencje",
      icon: Settings,
      href: "/dashboard/settings",
      badge: null,
    },
    {
      title: "Raporty",
      description: "Przychody, analizy i statystyki biznesowe",
      icon: BarChart3,
      href: "/dashboard/reports",
      badge: null,
    },
    {
      title: "Kalendarz",
      description: "Widok kalendarza i zarzadzanie wizytami",
      icon: Calendar,
      href: "/dashboard/calendar",
      badge: null,
    },
    {
      title: "Finanse",
      description: "Platnosci, faktury i rozliczenia",
      icon: CreditCard,
      href: "/dashboard/finance",
      badge: null,
    },
    {
      title: "Subskrypcja",
      description: "Zarzadzaj planem i platnoscia",
      icon: Shield,
      href: "/dashboard/subscription",
      badge: "Pro",
    },
  ];

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center gap-4 mb-8">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10">
          <Shield className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Panel administracyjny</h1>
          <p className="text-muted-foreground">
            Zarzadzaj swoim salonem i zespolem
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {adminSections.map((section) => (
          <Link key={section.href} href={section.href}>
            <Card className="h-full hover:shadow-md transition-shadow cursor-pointer hover:border-primary/50">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                      <section.icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-lg">{section.title}</CardTitle>
                  </div>
                  {section.badge && (
                    <Badge variant="secondary">{section.badge}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>{section.description}</CardDescription>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-8 flex gap-3">
        <Button asChild variant="outline">
          <Link href="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Powrot do panelu
          </Link>
        </Button>
      </div>
    </div>
  );
}
