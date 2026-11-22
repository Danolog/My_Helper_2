import { Playfair_Display, DM_Sans } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { OfflineBanner } from "@/components/offline-banner";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { SwRegister } from "@/components/pwa/sw-register";
import { SwUpdateToast } from "@/components/pwa/sw-update-toast";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { PLANS } from "@/lib/constants";
import { planPriceText } from "@/lib/plan-price";
import type { Metadata } from "next";

// Opis trafia do wyników wyszukiwania i podglądów linków, więc cena idzie
// z tej samej funkcji co cennik, żeby oba miejsca nie rozjechały się.
const SITE_DESCRIPTION = `MyHelper — system rezerwacji online dla salonów usługowych. Jeden plan, ${planPriceText(PLANS.basic.priceMonthly)} miesięcznie.`;

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "MyHelper",
    template: "%s | MyHelper",
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "system rezerwacji",
    "salon",
    "kalendarz wizyt",
    "alternatywa Booksy",
  ],
  authors: [{ name: "MyHelper Team" }],
  creator: "MyHelper Team",
  openGraph: {
    type: "website",
    locale: "pl_PL",
    siteName: "MyHelper",
    title: "MyHelper",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "MyHelper",
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
  applicationName: "MyHelper",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "MyHelper",
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "MyHelper",
  description: "MyHelper — aplikacja do zarządzania salonem usługowym",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Any",
  author: {
    "@type": "Person",
    name: "MyHelper Team",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? "";

  return (
    <html lang="pl" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#C4704B" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png" />
        <script
          nonce={nonce}
          type="application/ld+json"
          // Przegladarka ukrywa nonce w atrybucie DOM (zwraca ""), wiec React
          // przy hydracji zawsze widzi roznice — to jedyny sposob jej wyciszenia
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${playfair.variable} ${dmSans.variable} font-[family-name:var(--font-dm-sans)] antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          nonce={nonce}
        >
          <OfflineBanner />
          {children}
          <Toaster richColors position="top-right" />
        </ThemeProvider>
        <SwRegister />
        <InstallPrompt />
        <SwUpdateToast />
      </body>
    </html>
  );
}
