"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { UserProfile } from "@/components/auth/user-profile";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useSalonId } from "@/hooks/use-salon-id";
import { useSession } from "@/lib/auth-client";

export function SiteHeaderMobileMenu() {
  const { data: session, isPending } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();
  const [open, setOpen] = useState(false);

  const role = (session?.user as { role?: string } | undefined)?.role;
  const isOwner = role === "admin" || role === "owner" || !!salonId;

  const ownerLinks = [
    { href: "/dashboard", label: "Pulpit" },
    { href: "/dashboard/calendar", label: "Kalendarz" },
    { href: "/dashboard/settings/salon", label: "Mój salon" },
  ];

  const clientLinks = [
    { href: "/salons", label: "Salony" },
    { href: "/client/appointments", label: "Moje wizyty" },
    { href: "/client/favorites", label: "Ulubione" },
  ];

  const guestLinks = [
    { href: "/dla-salonow#features", label: "Funkcje" },
    { href: "/dla-salonow#pricing", label: "Cennik" },
    { href: "/dla-klientow", label: "Dla klientów" },
  ];

  const navLinks = isPending || salonLoading
    ? []
    : session
      ? isOwner
        ? ownerLinks
        : clientLinks
      : guestLinks;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-72">
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-3 mt-6">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="px-3 py-2 rounded-md text-sm text-foreground hover:bg-muted"
            >
              {link.label}
            </Link>
          ))}
          <div className="border-t pt-3 mt-3">
            {session ? (
              <UserProfile />
            ) : (
              <div className="flex flex-col gap-2">
                <Button variant="outline" asChild onClick={() => setOpen(false)}>
                  <Link href="/login">Zaloguj się</Link>
                </Button>
                <Button asChild onClick={() => setOpen(false)}>
                  <Link href="/register">Zarejestruj się</Link>
                </Button>
              </div>
            )}
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
