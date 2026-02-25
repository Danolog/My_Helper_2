import Link from "next/link";
import { Scissors } from "lucide-react";
import { UserProfile } from "@/components/auth/user-profile";
import { HeaderNavLinks } from "@/components/header-nav-links";
import { ModeToggle } from "./ui/mode-toggle";

export function SiteHeader() {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:border focus:rounded-md"
      >
        Skip to main content
      </a>
      <header className="glass border-b border-border/50 sticky top-0 z-40" role="banner">
        <nav
          className="container mx-auto px-4 py-3.5 flex justify-between items-center"
          aria-label="Main navigation"
        >
          <h1 className="text-2xl font-bold">
            <Link
              href="/"
              className="flex items-center gap-2.5 text-foreground hover:text-primary transition-colors"
              aria-label="MyHelper - Go to homepage"
            >
              <div
                className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"
                aria-hidden="true"
              >
                <Scissors className="h-4.5 w-4.5 text-primary" />
              </div>
              <span className="font-[family-name:var(--font-playfair)] text-2xl font-bold tracking-tight text-gradient-rose">
                MyHelper
              </span>
            </Link>
          </h1>
          <div className="flex items-center gap-6" role="group" aria-label="User actions">
            <HeaderNavLinks />
            <div className="flex items-center gap-3">
              <UserProfile />
              <ModeToggle />
            </div>
          </div>
        </nav>
      </header>
    </>
  );
}
