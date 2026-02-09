"use client";

import Link from "next/link";
import { Lock, Calendar, Users, Scissors, CalendarPlus, Contact, CreditCard, Receipt, MessageSquare } from "lucide-react";
import { UserProfile } from "@/components/auth/user-profile";
import { Button } from "@/components/ui/button";
import { useDiagnostics } from "@/hooks/use-diagnostics";
import { useSession } from "@/lib/auth-client";

export default function DashboardPage() {
  const { data: session, isPending } = useSession();
  const { isAiReady, loading: diagnosticsLoading } = useDiagnostics();

  if (isPending) {
    return (
      <div className="flex justify-center items-center h-screen">
        Loading...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <div className="mb-8">
            <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h1 className="text-2xl font-bold mb-2">Protected Page</h1>
            <p className="text-muted-foreground mb-6">
              You need to sign in to access the dashboard
            </p>
          </div>
          <UserProfile />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Kalendarz</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Zarzadzaj wizytami i harmonogramem pracownikow
          </p>
          <Button asChild>
            <Link href="/dashboard/calendar">Otworz kalendarz</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Pracownicy</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Zarzadzaj zespolem i harmonogramem pracy
          </p>
          <Button asChild>
            <Link href="/dashboard/employees">Zarzadzaj pracownikami</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Scissors className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Uslugi</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Zarzadzaj oferta uslug salonu
          </p>
          <Button asChild>
            <Link href="/dashboard/services">Zarzadzaj uslugami</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Contact className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Klienci</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Zarzadzaj baza klientow salonu
          </p>
          <Button asChild>
            <Link href="/dashboard/clients">Zarzadzaj klientami</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <CalendarPlus className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Rezerwacja</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Zarezerwuj wizyte - wybierz usluge i pracownika
          </p>
          <Button asChild>
            <Link href="/dashboard/booking">Zarezerwuj wizyte</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <h2 className="text-xl font-semibold mb-2">AI Chat</h2>
          <p className="text-muted-foreground mb-4">
            Start a conversation with AI using the Vercel AI SDK
          </p>
          {(diagnosticsLoading || !isAiReady) ? (
            <Button disabled={true}>
              Go to Chat
            </Button>
          ) : (
            <Button asChild>
              <Link href="/chat">Go to Chat</Link>
            </Button>
          )}
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Receipt className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Historia platnosci</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Przegladaj wszystkie transakcje i platnosci salonu
          </p>
          <Button asChild>
            <Link href="/dashboard/payments">Historia platnosci</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Platnosci</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Konfiguracja integracji Stripe i ustawienia platnosci
          </p>
          <Button asChild>
            <Link href="/dashboard/settings/payments">Ustawienia platnosci</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Powiadomienia</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Historia wyslanych SMS, email i powiadomien push
          </p>
          <Button asChild>
            <Link href="/dashboard/notifications">Przegladaj powiadomienia</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <h2 className="text-xl font-semibold mb-2">Profile</h2>
          <p className="text-muted-foreground mb-4">
            Manage your account settings and preferences
          </p>
          <div className="space-y-2">
            <p>
              <strong>Name:</strong> {session.user.name}
            </p>
            <p>
              <strong>Email:</strong> {session.user.email}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
