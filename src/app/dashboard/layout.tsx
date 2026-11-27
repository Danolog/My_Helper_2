import Link from "next/link";
import { redirect } from "next/navigation";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { CreateSalonPrompt } from "@/components/dashboard/create-salon-prompt";
import { DashboardBottomNav } from "@/components/dashboard/dashboard-bottom-nav";
import { DashboardBreadcrumbs } from "@/components/dashboard/dashboard-breadcrumbs";
import { DashboardSidebar, DashboardMobileHeader } from "@/components/dashboard/dashboard-sidebar";
import { ModulesProvider } from "@/components/dashboard/modules-provider";
import { RoleProvider } from "@/components/dashboard/role-provider";
import { DEFAULT_MODULES, clientHomePath } from "@/lib/features";
import { getSalonContext } from "@/lib/salon-context";
import { getSalonModules } from "@/lib/server/modules";
import { requireDashboardAccess } from "@/lib/session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Faza 3 — do dashboardu wchodzi wlasciciel ORAZ aktywny pracownik/recepcja
  // z podpietym kontem. Konto bez salonu i bez powiazania widzi wylacznie
  // zakladanie salonu (bez paska bocznego i bez podstrony): po potwierdzeniu
  // e-maila wlasciciel loguje sie bez salonu i tu go zaklada. Przekierowanie
  // na /salons zostawialo go bez drogi do salonu.
  const { session, allowed, role } = await requireDashboardAccess();

  // Ta gałąź nie przerywa odpowiedzi, więc wynik serwerowej podstrony i tak
  // trafia do payloadu RSC: każda podstrona panelu musi być kliencka albo mieć
  // własną bramkę (pilnuje __tests__/app/dashboard-pages-guard.test.ts).
  if (!allowed) {
    const user = session?.user;
    if (!user) redirect("/login");
    // Do komponentu klienckiego tylko imie i e-mail — nie caly obiekt sesji
    // (token sesji trafilby do danych RSC wysylanych do przegladarki).
    return (
      <main>
        <CreateSalonPrompt session={{ user: { name: user.name, email: user.email } }} />
        <p className="pb-8 text-center text-sm text-muted-foreground">
          <Link href={clientHomePath()} className="underline underline-offset-4 hover:text-foreground">
            Jestem klientem — przejdź do portalu klienta
          </Link>
        </p>
      </main>
    );
  }

  // Feature flags salonu (Faza 2) — rozwiązane raz na request, dostępne
  // w komponentach klienckich przez useModules(). salonId z getSalonContext
  // (nie getUserSalonId): pracownik/recepcja nie jest wlascicielem, a ma
  // widziec moduly SWOJEGO salonu. Brak salonu = domyślny chudy interfejs.
  const ctx = await getSalonContext();
  const modules = ctx ? await getSalonModules(ctx.salonId) : DEFAULT_MODULES;

  return (
    <RoleProvider role={role ?? "owner"}>
      <ModulesProvider modules={modules}>
        <div className="flex min-h-screen">
          <DashboardSidebar />
          <div className="flex-1 flex flex-col overflow-auto pb-20 md:pb-0">
            <DashboardMobileHeader />
            <DashboardBreadcrumbs />
            {children}
          </div>
          <DashboardBottomNav />
          <CommandPalette />
        </div>
      </ModulesProvider>
    </RoleProvider>
  );
}
