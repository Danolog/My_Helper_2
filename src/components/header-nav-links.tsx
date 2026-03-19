"use client";

import Link from "next/link";
import { useSalonId } from "@/hooks/use-salon-id";
import { useSession } from "@/lib/auth-client";

export function HeaderNavLinks() {
  const { data: session, isPending } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();

  if (isPending || salonLoading) return null;

  if (session) {
    const role = (session.user as { role?: string }).role;
    const isOwner = role === "admin" || role === "owner" || !!salonId;

    if (isOwner) {
      return (
        <div className="hidden md:flex items-center gap-5 text-sm font-medium text-muted-foreground">
          <Link href="/dashboard" className="hover:text-primary transition-colors">
            Pulpit
          </Link>
          <Link href="/dashboard/calendar" className="hover:text-primary transition-colors">
            Kalendarz
          </Link>
          <Link href="/dashboard/settings/salon" className="hover:text-primary transition-colors">
            Moj salon
          </Link>
        </div>
      );
    }

    return (
      <div className="hidden md:flex items-center gap-5 text-sm font-medium text-muted-foreground">
        <Link href="/salons" className="hover:text-primary transition-colors">
          Salony
        </Link>
        <Link href="/client/appointments" className="hover:text-primary transition-colors">
          Moje wizyty
        </Link>
        <Link href="/client/favorites" className="hover:text-primary transition-colors">
          Ulubione
        </Link>
      </div>
    );
  }

  return (
    <div className="hidden md:flex items-center gap-5 text-sm font-medium text-muted-foreground">
      <Link href="/dla-salonow#features" className="hover:text-primary transition-colors">
        Funkcje
      </Link>
      <Link href="/dla-salonow#pricing" className="hover:text-primary transition-colors">
        Cennik
      </Link>
      <Link href="/dla-klientow" className="hover:text-primary transition-colors">
        Dla klientów
      </Link>
    </div>
  );
}
