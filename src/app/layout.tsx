import { Analytics } from "@vercel/analytics/react";
import { Playfair_Display, DM_Sans } from "next/font/google";
import "./globals.css";
import { OfflineBanner } from "@/components/offline-banner";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { SwRegister } from "@/components/pwa/sw-register";
import { SwUpdateToast } from "@/components/pwa/sw-update-toast";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import type { Metadata } from "next";

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
  description:
    "MyHelper - przystepna cenowo alternatywa dla Booksy z asystentem AI dla salonow uslugowych",
  keywords: [
    "Next.js",
    "React",
    "TypeScript",
    "AI",
    "OpenRouter",
    "Booksy alternative",
    "Authentication",
    "PostgreSQL",
  ],
  authors: [{ name: "MyHelper Team" }],
  creator: "MyHelper Team",
  openGraph: {
    type: "website",
    locale: "pl_PL",
    siteName: "MyHelper",
    title: "MyHelper",
    description:
      "MyHelper - przystepna cenowo alternatywa dla Booksy z asystentem AI dla salonow uslugowych",
  },
  twitter: {
    card: "summary_large_image",
    title: "MyHelper",
    description:
      "MyHelper - przystepna cenowo alternatywa dla Booksy z asystentem AI dla salonow uslugowych",
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
  description:
    "MyHelper - aplikacja do zarzadzania salonem uslugowym z asystentem AI",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Any",
  offers: {
    "@type": "AggregateOffer",
    lowPrice: "49",
    highPrice: "149",
    priceCurrency: "PLN",
    offerCount: "2",
  },
  author: {
    "@type": "Person",
    name: "MyHelper Team",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#C4704B" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png" />
        <script
          type="application/ld+json"
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
          disableTransitionOnChange
        >
          <OfflineBanner />
          <SiteHeader />
          <main id="main-content">{children}</main>
          <SiteFooter />
          <Toaster richColors position="top-right" />
        </ThemeProvider>
        <SwRegister />
        <InstallPrompt />
        <SwUpdateToast />
        <Analytics />
      </body>
    </html>
  );
}
