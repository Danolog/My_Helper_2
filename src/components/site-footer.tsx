import Link from "next/link";
import { Scissors } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="border-t bg-[oklch(0.22_0.03_55)]" role="contentinfo">
      <div className="container mx-auto px-4 py-8 md:py-12">
        {/* Mobile: compact single-column, Desktop: 4-column grid */}
        <div className="hidden md:grid md:grid-cols-4 gap-8">
          <div>
            <Link href="/" className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Scissors className="h-4 w-4 text-primary" />
              </div>
              <span className="font-[family-name:var(--font-playfair)] text-xl font-bold text-gradient-rose">
                MyHelper
              </span>
            </Link>
            <p className="text-sm text-[oklch(0.60_0.03_55)] leading-relaxed">
              Przystepna cenowo alternatywa dla Booksy z asystentem AI dla salonow uslugowych.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-sm mb-3 text-[oklch(0.95_0.01_70)]">Dla salonow</h3>
            <ul className="space-y-2 text-sm text-[oklch(0.60_0.03_55)]">
              <li><Link href="/register" className="hover:text-[oklch(0.95_0.01_70)] transition-colors">Zarejestruj salon</Link></li>
              <li><Link href="/pricing" className="hover:text-[oklch(0.95_0.01_70)] transition-colors">Cennik</Link></li>
              <li><Link href="/login" className="hover:text-[oklch(0.95_0.01_70)] transition-colors">Logowanie</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-sm mb-3 text-[oklch(0.95_0.01_70)]">Dla klientow</h3>
            <ul className="space-y-2 text-sm text-[oklch(0.60_0.03_55)]">
              <li><Link href="/salons" className="hover:text-[oklch(0.95_0.01_70)] transition-colors">Przegladaj salony</Link></li>
              <li><Link href="/dla-klientow" className="hover:text-[oklch(0.95_0.01_70)] transition-colors">Portal klienta</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-sm mb-3 text-[oklch(0.95_0.01_70)]">Informacje</h3>
            <ul className="space-y-2 text-sm text-[oklch(0.60_0.03_55)]">
              <li><Link href="/privacy" className="hover:text-[oklch(0.95_0.01_70)] transition-colors">Polityka prywatnosci</Link></li>
              <li><Link href="/terms" className="hover:text-[oklch(0.95_0.01_70)] transition-colors">Regulamin</Link></li>
              <li><Link href="/contact" className="hover:text-[oklch(0.95_0.01_70)] transition-colors">Kontakt</Link></li>
            </ul>
          </div>
        </div>

        {/* Mobile: minimal footer */}
        <div className="flex flex-col items-center gap-3 md:hidden">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Scissors className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="font-[family-name:var(--font-playfair)] text-lg font-bold text-gradient-rose">
              MyHelper
            </span>
          </Link>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-[oklch(0.60_0.03_55)]">
            <Link href="/salons" className="hover:text-[oklch(0.95_0.01_70)] transition-colors">Salony</Link>
            <Link href="/pricing" className="hover:text-[oklch(0.95_0.01_70)] transition-colors">Cennik</Link>
            <Link href="/privacy" className="hover:text-[oklch(0.95_0.01_70)] transition-colors">Prywatnosc</Link>
            <Link href="/terms" className="hover:text-[oklch(0.95_0.01_70)] transition-colors">Regulamin</Link>
          </div>
        </div>

        <div className="border-t border-white/8 mt-6 md:mt-8 pt-4 md:pt-6 text-center text-xs md:text-sm text-[oklch(0.50_0.03_55)]">
          <p>&copy; {new Date().getFullYear()} MyHelper. Wszelkie prawa zastrzezone.</p>
        </div>
      </div>
    </footer>
  );
}
