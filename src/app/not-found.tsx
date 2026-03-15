import Link from "next/link";
import { FileQuestion, Home, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main>
        <div className="flex items-center justify-center min-h-[60vh] px-4 py-16">
          <div className="max-w-md w-full text-center">
            <div className="flex justify-center mb-6">
              <div className="rounded-full bg-muted p-4">
                <FileQuestion className="h-12 w-12 text-muted-foreground" />
              </div>
            </div>
            <h1 className="text-6xl font-bold text-muted-foreground mb-2">404</h1>
            <h2 className="text-xl font-semibold mb-3">Strona nie znaleziona</h2>
            <p className="text-muted-foreground mb-8">
              Strona, ktorej szukasz, nie istnieje lub zostala przeniesiona.
              Sprawdz adres URL lub skorzystaj z ponizszych opcji nawigacji.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild className="gap-2">
                <Link href="/">
                  <Home className="h-4 w-4" />
                  Strona glowna
                </Link>
              </Button>
              <Button variant="outline" asChild className="gap-2">
                <Link href="/dashboard">
                  <LayoutDashboard className="h-4 w-4" />
                  Panel zarzadzania
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
