import { Geist, Geist_Mono } from "next/font/google";
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

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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

// JSON-LD structured data for SEO
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "MyHelper",
  description:
    "MyHelper - aplikacja do zarzadzania salonem uslugowym z asystentem AI",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Any",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "PLN",
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
        <meta name="theme-color" content="#000000" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
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
      </body>
    </html>
  );
}
