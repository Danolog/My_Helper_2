"use client";

import Link from "next/link";
import { useSalonId } from "@/hooks/use-salon-id";
import { useSession } from "@/lib/auth-client";
import { clientNavLinks, guestNavLinks } from "@/lib/site-nav-links";

export function HeaderNavLinks() {
  const { data: session, isPending } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();

  if (isPending || salonLoading) return null;

  if (session) {
    // Linki panelu tylko dla konta z salonem (salons.ownerId), nie po user.role.
    const isOwner = !!salonId;

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
        {clientNavLinks().map((link) => (
          <Link key={link.href} href={link.href} className="hover:text-primary transition-colors">
            {link.label}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="hidden md:flex items-center gap-5 text-sm font-medium text-muted-foreground">
      {guestNavLinks().map((link) => (
        <Link key={link.href} href={link.href} className="hover:text-primary transition-colors">
          {link.label}
        </Link>
      ))}
    </div>
  );
}
