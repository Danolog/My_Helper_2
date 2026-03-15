"use client";

import Link from "next/link";
import { Calendar, Users, Scissors, CalendarPlus, Contact, CreditCard, Receipt, MessageSquare, Image, Star, Clock, Cake, Package, BarChart3, Percent, Ticket, Gift, DollarSign, Printer, FileText, Crown, Bot, Lightbulb, PenTool, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";

interface DashboardNavCardsProps {
  isProPlan: boolean;
}

export function DashboardNavCards({ isProPlan }: DashboardNavCardsProps) {
  const { data: session } = useSession();

  return (
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
        <div className="flex items-center gap-2 mb-2">
          <Bot className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">Asystent AI</h2>
          {!isProPlan && (
            <Badge variant="secondary" className="gap-1 ml-auto">
              <Crown className="h-3 w-3" />
              Pro
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground mb-4">
          Asystent glosowy, analiza biznesowa i chat AI
        </p>
        <Button asChild>
          <Link href="/dashboard/ai-assistant">Asystent AI</Link>
        </Button>
      </div>

      <div className="p-6 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Lightbulb className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">Rekomendacje AI</h2>
          {!isProPlan && (
            <Badge variant="secondary" className="gap-1 ml-auto">
              <Crown className="h-3 w-3" />
              Pro
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground mb-4">
          Inteligentne rekomendacje oparte na danych salonu
        </p>
        <Button asChild>
          <Link href="/dashboard/ai-recommendations">Rekomendacje AI</Link>
        </Button>
      </div>

      <div className="p-6 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <PenTool className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">Generator tresci</h2>
          {!isProPlan && (
            <Badge variant="secondary" className="gap-1 ml-auto">
              <Crown className="h-3 w-3" />
              Pro
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground mb-4">
          Tworzenie postow, opisow uslug i newsletterow z AI
        </p>
        <Button asChild>
          <Link href="/dashboard/content-generator">Generator tresci</Link>
        </Button>
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
          <DollarSign className="w-5 h-5 text-green-600" />
          <h2 className="text-xl font-semibold">Finanse - Prowizje</h2>
        </div>
        <p className="text-muted-foreground mb-4">
          Sledzenie prowizji pracownikow i zarzadzanie stawkami
        </p>
        <Button asChild>
          <Link href="/dashboard/finance">Prowizje pracownikow</Link>
        </Button>
      </div>

      <div className="p-6 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Building2 className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">Dane salonu</h2>
        </div>
        <p className="text-muted-foreground mb-4">
          Nazwa, adres, telefon i typ dzialalnosci salonu
        </p>
        <Button asChild>
          <Link href="/dashboard/settings/salon">Edytuj dane salonu</Link>
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
        <div className="flex items-center gap-2 mb-2">
          <Image className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">Galeria</h2>
        </div>
        <p className="text-muted-foreground mb-4">
          Portfolio zdjec - przed i po zabiegach
        </p>
        <Button asChild>
          <Link href="/dashboard/gallery">Przegladaj galerie</Link>
        </Button>
      </div>

      <div className="p-6 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Star className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">Opinie</h2>
        </div>
        <p className="text-muted-foreground mb-4">
          Moderacja opinii klientow - zatwierdzaj lub odrzucaj
        </p>
        <Button asChild>
          <Link href="/dashboard/reviews">Moderacja opinii</Link>
        </Button>
      </div>

      <div className="p-6 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Clock className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">Lista oczekujacych</h2>
        </div>
        <p className="text-muted-foreground mb-4">
          Zarzadzaj lista klientow oczekujacych na wolne terminy
        </p>
        <Button asChild>
          <Link href="/dashboard/waiting-list">Lista oczekujacych</Link>
        </Button>
      </div>

      <div className="p-6 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Cake className="w-5 h-5 text-pink-500" />
          <h2 className="text-xl font-semibold">Prezenty urodzinowe</h2>
        </div>
        <p className="text-muted-foreground mb-4">
          Konfiguracja rabatow i prezentow urodzinowych dla klientow
        </p>
        <Button asChild>
          <Link href="/dashboard/settings/notifications">Ustawienia urodzinowe</Link>
        </Button>
      </div>

      <div className="p-6 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Package className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">Magazyn</h2>
        </div>
        <p className="text-muted-foreground mb-4">
          Zarzadzaj produktami i stanem magazynowym
        </p>
        <Button asChild>
          <Link href="/dashboard/products">Magazyn produktow</Link>
        </Button>
      </div>

      <div className="p-6 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">Raporty</h2>
        </div>
        <p className="text-muted-foreground mb-4">
          Raporty przychodow, zuzycia materialow i analityka salonu
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/dashboard/reports/revenue">Raport przychodow</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/reports/materials">Raport materialow</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/reports/services-popularity">Popularnosc uslug</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/reports/employee-occupancy">Obciazenie pracownikow</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/reports/promotions">Efektywnosc promocji</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/reports/employee-popularity">Popularnosc pracownikow</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/reports/cancellations">Analiza anulacji</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/reports/service-profitability">Rentownosc uslug</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/reports/materials-profitloss">Zysk/Strata materialow</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/reports/monthly-comparison">Porownanie miesieczne</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/reports/yearly-comparison">Porownanie roczne</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/reports/employee-payroll">Raport wynagrodzen</Link>
          </Button>
        </div>
      </div>

      <div className="p-6 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Percent className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">Promocje</h2>
        </div>
        <p className="text-muted-foreground mb-4">
          Zarzadzaj promocjami i rabatami salonu
        </p>
        <Button asChild>
          <Link href="/dashboard/promotions">Zarzadzaj promocjami</Link>
        </Button>
      </div>

      <div className="p-6 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Ticket className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">Kody promocyjne</h2>
        </div>
        <p className="text-muted-foreground mb-4">
          Generuj i zarzadzaj kodami rabatowymi
        </p>
        <Button asChild>
          <Link href="/dashboard/promo-codes">Kody promocyjne</Link>
        </Button>
      </div>

      <div className="p-6 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Gift className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">Program lojalnosciowy</h2>
        </div>
        <p className="text-muted-foreground mb-4">
          Konfiguracja systemu punktow i nagrod dla klientow
        </p>
        <Button asChild>
          <Link href="/dashboard/settings/loyalty">Ustawienia programu</Link>
        </Button>
      </div>

      <div className="p-6 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Printer className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">Drukarka fiskalna</h2>
        </div>
        <p className="text-muted-foreground mb-4">
          Konfiguracja integracji z drukarka fiskalna i kasa
        </p>
        <Button asChild>
          <Link href="/dashboard/settings/fiscal">Ustawienia fiskalne</Link>
        </Button>
      </div>

      <div className="p-6 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">Faktury</h2>
        </div>
        <p className="text-muted-foreground mb-4">
          Historia wystawionych faktur i rachunkow
        </p>
        <Button asChild>
          <Link href="/dashboard/invoices">Historia faktur</Link>
        </Button>
      </div>

      <div className="p-6 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Crown className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">Subskrypcja</h2>
        </div>
        <p className="text-muted-foreground mb-4">
          Zarzadzaj planem subskrypcji i platnosciami
        </p>
        <Button asChild>
          <Link href="/dashboard/subscription">Zarzadzaj subskrypcja</Link>
        </Button>
      </div>

      <div className="p-6 border border-border rounded-lg">
        <h2 className="text-xl font-semibold mb-2">Profile</h2>
        <p className="text-muted-foreground mb-4">
          Manage your account settings and preferences
        </p>
        <div className="space-y-2">
          <p>
            <strong>Name:</strong> {session?.user.name}
          </p>
          <p>
            <strong>Email:</strong> {session?.user.email}
          </p>
        </div>
      </div>
    </div>
  );
}
