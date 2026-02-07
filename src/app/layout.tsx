import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
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
    locale: "en_US",
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
};

// JSON-LD structured data for SEO
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "MyHelper",
  description:
    "Complete agentic coding boilerplate with authentication, database, AI integration, and modern tooling",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Any",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
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
    <html lang="en" suppressHydrationWarning>
      <head>
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
          <SiteHeader />
          <main id="main-content">{children}</main>
          <SiteFooter />
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
