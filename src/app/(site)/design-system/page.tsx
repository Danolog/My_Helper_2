import { redirect } from "next/navigation";
import {
  Star,
  ChevronDown,
  ArrowRight,
  Check,
  Palette,
  Type,
  MousePointerClick,
  LayoutGrid,
  PenTool,
  HelpCircle,
  Layers,
  Sparkles,
  Shield,
  Calendar,
  Clock,
  Mail,
  Heart,
  Settings,
  MessageCircle,
  Crown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Design System",
};

// ---------------------------------------------------------------------------
// Scoped CSS custom properties -- applied via style on the page wrapper div.
// This makes Tailwind semantic classes (bg-primary, text-primary, etc.) resolve
// to the terracotta palette WITHOUT touching globals.css.
// ---------------------------------------------------------------------------
const designSystemVars = {
  // Core semantic tokens
  "--background": "#FFFDFB",
  "--foreground": "#2D1F15",
  "--card": "#FDF8F4",
  "--card-foreground": "#352A22",
  "--popover": "#FFFDFB",
  "--popover-foreground": "#2D1F15",
  "--primary": "#C17A4A",
  "--primary-foreground": "#FFFFFF",
  "--secondary": "#F7EDE3",
  "--secondary-foreground": "#352A22",
  "--muted": "#EDE0D4",
  "--muted-foreground": "#6B5B4D",
  "--accent": "#FAE8DC",
  "--accent-foreground": "#8B5035",
  "--destructive": "#DC3545",
  "--border": "#DDD0C2",
  "--input": "#DDD0C2",
  "--ring": "#C17A4A",
  // Extended palette
  "--primary-50": "#FDF5F0",
  "--primary-100": "#FAE8DC",
  "--primary-200": "#F3CDAF",
  "--primary-300": "#E8AC7E",
  "--primary-400": "#D68E56",
  "--primary-500": "#C17A4A",
  "--primary-600": "#A86540",
  "--primary-700": "#8B5035",
  "--primary-800": "#6E3D2A",
  "--primary-900": "#4A2819",
  "--warm-50": "#FFFDFB",
  "--warm-100": "#FDF8F4",
  "--warm-200": "#F7EDE3",
  "--warm-300": "#EDE0D4",
  "--warm-400": "#DDD0C2",
  "--warm-500": "#C4B5A5",
  "--dark-50": "#F5F0EB",
  "--dark-100": "#DDD5CC",
  "--dark-200": "#B5A899",
  "--dark-300": "#8D7E6D",
  "--dark-400": "#6B5B4D",
  "--dark-500": "#4A3D32",
  "--dark-600": "#352A22",
  "--dark-700": "#2D1F15",
  "--dark-800": "#1A0F08",
  "--star-filled": "#E8A838",
  "--star-empty": "#DDD0C2",
  "--success": "#5D8C61",
  "--warning": "#D4A843",
  "--error": "#DC3545",
  "--info": "#5B8DB8",
  // Apply background
  backgroundColor: "#FFFDFB",
  color: "#2D1F15",
} as unknown as React.CSSProperties;

// ---------------------------------------------------------------------------
// Palette data
// ---------------------------------------------------------------------------
const PRIMARY_SWATCHES = [
  { label: "50", hex: "#FDF5F0" },
  { label: "100", hex: "#FAE8DC" },
  { label: "200", hex: "#F3CDAF" },
  { label: "300", hex: "#E8AC7E" },
  { label: "400", hex: "#D68E56" },
  { label: "500", hex: "#C17A4A" },
  { label: "600", hex: "#A86540" },
  { label: "700", hex: "#8B5035" },
  { label: "800", hex: "#6E3D2A" },
  { label: "900", hex: "#4A2819" },
];

const WARM_SWATCHES = [
  { label: "50", hex: "#FFFDFB" },
  { label: "100", hex: "#FDF8F4" },
  { label: "200", hex: "#F7EDE3" },
  { label: "300", hex: "#EDE0D4" },
  { label: "400", hex: "#DDD0C2" },
  { label: "500", hex: "#C4B5A5" },
];

const DARK_SWATCHES = [
  { label: "50", hex: "#F5F0EB" },
  { label: "100", hex: "#DDD5CC" },
  { label: "200", hex: "#B5A899" },
  { label: "300", hex: "#8D7E6D" },
  { label: "400", hex: "#6B5B4D" },
  { label: "500", hex: "#4A3D32" },
  { label: "600", hex: "#352A22" },
  { label: "700", hex: "#2D1F15" },
  { label: "800", hex: "#1A0F08" },
];

const SEMANTIC_COLORS = [
  { label: "Success", hex: "#5D8C61" },
  { label: "Warning", hex: "#D4A843" },
  { label: "Error", hex: "#DC3545" },
  { label: "Info", hex: "#5B8DB8" },
  { label: "Star Filled", hex: "#E8A838" },
  { label: "Star Empty", hex: "#DDD0C2" },
];

// ---------------------------------------------------------------------------
// Quick-nav items
// ---------------------------------------------------------------------------
const NAV_PILLS = [
  { label: "Colors", href: "#colors", icon: Palette },
  { label: "Typography", href: "#typography", icon: Type },
  { label: "Buttons", href: "#buttons", icon: MousePointerClick },
  { label: "Cards", href: "#cards", icon: LayoutGrid },
  { label: "Forms", href: "#forms", icon: PenTool },
  { label: "FAQ", href: "#faq", icon: HelpCircle },
  { label: "Spacing", href: "#spacing", icon: Layers },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render filled/empty stars for a given rating out of 5 */
function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className="h-5 w-5"
          style={{
            fill: i < rating ? "#E8A838" : "#DDD0C2",
            color: i < rating ? "#E8A838" : "#DDD0C2",
          }}
        />
      ))}
    </div>
  );
}

/** Section label in uppercase tracking-widest terracotta */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-xs font-semibold uppercase tracking-widest mb-3"
      style={{ color: "#C17A4A" }}
    >
      {children}
    </p>
  );
}

/** Large section heading in Cormorant */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-[family-name:var(--font-playfair)] text-3xl md:text-4xl font-semibold tracking-tight mb-6">
      {children}
    </h2>
  );
}

// ---------------------------------------------------------------------------
// FAQ data
// ---------------------------------------------------------------------------
const FAQ_ITEMS = [
  {
    q: "How do I set up my salon profile?",
    a: 'After registering, navigate to Settings and select "Salon Profile." Fill in your salon name, address, working hours, and upload your logo. You can also add team members, configure services and pricing, and set up your online booking page -- all from the same dashboard.',
  },
  {
    q: "Can clients book appointments online?",
    a: "Absolutely. Once your salon profile is published, clients can discover you through the MyHelper directory, browse your services, choose a preferred employee, and book an available time slot. They will receive an email and optional SMS confirmation immediately.",
  },
  {
    q: "What AI features are included in the Pro plan?",
    a: "The Pro plan includes a voice assistant for hands-free scheduling, an AI business advisor that analyzes trends and suggests optimizations, and a content marketing generator for social media posts, promotions, and client communications -- all powered by Claude Sonnet.",
  },
];

// ---------------------------------------------------------------------------
// Shadow scale data
// ---------------------------------------------------------------------------
const SHADOW_SCALE = [
  { label: "xs", value: "0 1px 2px rgba(109,61,42,0.05)" },
  { label: "sm", value: "0 1px 3px rgba(109,61,42,0.08), 0 1px 2px rgba(109,61,42,0.04)" },
  { label: "md", value: "0 4px 6px rgba(109,61,42,0.07), 0 2px 4px rgba(109,61,42,0.04)" },
  { label: "lg", value: "0 10px 15px rgba(109,61,42,0.08), 0 4px 6px rgba(109,61,42,0.04)" },
  { label: "xl", value: "0 20px 25px rgba(109,61,42,0.1), 0 8px 10px rgba(109,61,42,0.04)" },
  { label: "2xl", value: "0 25px 50px rgba(109,61,42,0.15)" },
];

// ---------------------------------------------------------------------------
// Spacing scale data
// ---------------------------------------------------------------------------
const SPACING_SCALE = [
  { label: "4px", size: 4 },
  { label: "8px", size: 8 },
  { label: "12px", size: 12 },
  { label: "16px", size: 16 },
  { label: "24px", size: 24 },
  { label: "32px", size: 32 },
  { label: "48px", size: 48 },
  { label: "64px", size: 64 },
];

// ---------------------------------------------------------------------------
// Border radius data
// ---------------------------------------------------------------------------
const RADIUS_SCALE = [
  { label: "sm", value: "0.375rem" },
  { label: "md", value: "0.5rem" },
  { label: "lg", value: "0.625rem" },
  { label: "xl", value: "1rem" },
  { label: "full", value: "9999px" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") {
    redirect("/");
  }

  return (
    <div style={designSystemVars} className="min-h-screen">
      {/* ================================================================ */}
      {/* 1. HERO SECTION                                                  */}
      {/* ================================================================ */}
      <section
        className="relative overflow-hidden py-20 md:py-28"
        style={{ backgroundColor: "#F7EDE3" }}
      >
        {/* Decorative blurred circles */}
        <div
          className="absolute top-10 left-[10%] w-72 h-72 rounded-full blur-3xl"
          style={{ backgroundColor: "rgba(193,122,74,0.12)" }}
        />
        <div
          className="absolute bottom-10 right-[15%] w-96 h-96 rounded-full blur-3xl"
          style={{ backgroundColor: "rgba(214,142,86,0.10)" }}
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-3xl"
          style={{ backgroundColor: "rgba(168,101,64,0.06)" }}
        />

        <div className="relative container mx-auto px-4 text-center">
          <Badge
            variant="secondary"
            className="mb-8 px-4 py-1.5 text-sm"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            v1.0 Design System
          </Badge>

          <h1 className="font-[family-name:var(--font-playfair)] text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight leading-[0.95] mb-6">
            <span style={{ color: "#2D1F15" }}>MyHelper</span>
            <br />
            <span
              className="italic"
              style={{
                background: "linear-gradient(135deg, #C17A4A, #D68E56)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Design System
            </span>
          </h1>

          <p className="text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed font-[family-name:var(--font-dm-sans)]" style={{ color: "#6B5B4D" }}>
            A comprehensive visual language crafted for premium salon
            management. Every color, typeface, and component is designed to
            convey warmth, trust, and sophistication.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-14">
            <Button
              size="lg"
              className="h-12 px-8 text-base rounded-full shadow-lg"
              style={{
                backgroundColor: "#C17A4A",
                color: "#FFFFFF",
                boxShadow: "0 8px 20px rgba(193,122,74,0.25)",
              }}
              asChild
            >
              <a href="#colors">
                Explore Components
                <ArrowRight className="h-4 w-4 ml-2" />
              </a>
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-12 px-8 text-base rounded-full"
            >
              View on GitHub
            </Button>
          </div>

          {/* Quick-nav pills */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {NAV_PILLS.map((pill) => {
              const Icon = pill.icon;
              return (
                <a
                  key={pill.label}
                  href={pill.href}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.7)",
                    color: "#6B5B4D",
                    border: "1px solid #DDD0C2",
                  }}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {pill.label}
                </a>
              );
            })}
          </div>
        </div>
      </section>

      <hr className="border-border" />

      {/* ================================================================ */}
      {/* 2. COLOR PALETTE                                                 */}
      {/* ================================================================ */}
      <section id="colors" className="container mx-auto px-4 py-16 md:py-24">
        <SectionLabel>Visual Foundation</SectionLabel>
        <SectionHeading>Color Palette</SectionHeading>

        {/* Primary Terracotta */}
        <div className="mb-12">
          <h3 className="font-[family-name:var(--font-playfair)] text-xl font-semibold mb-4">
            Primary Terracotta
          </h3>
          <div className="flex flex-wrap gap-3">
            {PRIMARY_SWATCHES.map((s) => (
              <div key={s.label} className="flex flex-col items-center gap-2">
                <div
                  className={`rounded-xl transition-transform hover:scale-105 ${
                    s.label === "500" ? "w-20 h-20 ring-2 ring-offset-2" : "w-16 h-16"
                  }`}
                  style={{
                    backgroundColor: s.hex,
                    border:
                      s.label === "50" || s.label === "100"
                        ? "1px solid #DDD0C2"
                        : undefined,
                    ...(s.label === "500"
                      ? {
                          ringColor: "#C17A4A",
                          boxShadow: "0 0 0 2px #FFFDFB, 0 0 0 4px #C17A4A",
                        }
                      : {}),
                  }}
                />
                <span className="text-xs font-medium" style={{ color: "#6B5B4D" }}>
                  {s.label}
                </span>
                <span className="text-[10px] font-mono" style={{ color: "#8D7E6D" }}>
                  {s.hex}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Warm Neutrals */}
        <div className="mb-12">
          <h3 className="font-[family-name:var(--font-playfair)] text-xl font-semibold mb-4">
            Warm Neutrals
          </h3>
          <div className="flex flex-wrap gap-3">
            {WARM_SWATCHES.map((s) => (
              <div key={s.label} className="flex flex-col items-center gap-2">
                <div
                  className="w-16 h-16 rounded-xl transition-transform hover:scale-105"
                  style={{
                    backgroundColor: s.hex,
                    border: "1px solid #DDD0C2",
                  }}
                />
                <span className="text-xs font-medium" style={{ color: "#6B5B4D" }}>
                  {s.label}
                </span>
                <span className="text-[10px] font-mono" style={{ color: "#8D7E6D" }}>
                  {s.hex}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Dark Neutrals */}
        <div className="mb-12">
          <h3 className="font-[family-name:var(--font-playfair)] text-xl font-semibold mb-4">
            Dark Neutrals
          </h3>
          <div className="flex flex-wrap gap-3">
            {DARK_SWATCHES.map((s) => (
              <div key={s.label} className="flex flex-col items-center gap-2">
                <div
                  className="w-16 h-16 rounded-xl transition-transform hover:scale-105"
                  style={{ backgroundColor: s.hex }}
                />
                <span className="text-xs font-medium" style={{ color: "#6B5B4D" }}>
                  {s.label}
                </span>
                <span className="text-[10px] font-mono" style={{ color: "#8D7E6D" }}>
                  {s.hex}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Semantic Colors */}
        <div>
          <h3 className="font-[family-name:var(--font-playfair)] text-xl font-semibold mb-4">
            Semantic Colors
          </h3>
          <div className="flex flex-wrap gap-3">
            {SEMANTIC_COLORS.map((s) => (
              <div key={s.label} className="flex flex-col items-center gap-2">
                <div
                  className="w-16 h-16 rounded-xl transition-transform hover:scale-105"
                  style={{ backgroundColor: s.hex }}
                />
                <span className="text-xs font-medium" style={{ color: "#6B5B4D" }}>
                  {s.label}
                </span>
                <span className="text-[10px] font-mono" style={{ color: "#8D7E6D" }}>
                  {s.hex}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <hr className="border-border" />

      {/* ================================================================ */}
      {/* 3. TYPOGRAPHY                                                    */}
      {/* ================================================================ */}
      <section id="typography" className="container mx-auto px-4 py-16 md:py-24">
        <SectionLabel>Type System</SectionLabel>
        <SectionHeading>Typography</SectionHeading>

        {/* Font showcase cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-14">
          {/* Cormorant card */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-4">
              <p
                className="font-[family-name:var(--font-playfair)] text-8xl font-light leading-none mb-4"
                style={{ color: "#C17A4A" }}
              >
                Aa
              </p>
              <CardTitle className="font-[family-name:var(--font-playfair)] text-2xl">
                Cormorant
              </CardTitle>
              <CardDescription>
                An elegant serif typeface used for headings and display text.
                Its refined letterforms evoke luxury and sophistication.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Light 300</Badge>
                <Badge variant="outline">Regular 400</Badge>
                <Badge variant="outline">Semibold 600</Badge>
              </div>
            </CardContent>
          </Card>

          {/* DM Sans card */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-4">
              <p
                className="font-[family-name:var(--font-dm-sans)] text-8xl font-light leading-none mb-4"
                style={{ color: "#C17A4A" }}
              >
                Aa
              </p>
              <CardTitle className="font-[family-name:var(--font-playfair)] text-2xl">
                DM Sans
              </CardTitle>
              <CardDescription>
                A clean, geometric sans-serif for body copy, UI elements, and
                labels. Highly legible at all sizes with a modern feel.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Regular 400</Badge>
                <Badge variant="outline">Medium 500</Badge>
                <Badge variant="outline">Semibold 600</Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Type scale */}
        <h3 className="font-[family-name:var(--font-playfair)] text-xl font-semibold mb-6">
          Type Scale
        </h3>
        <div className="space-y-8">
          {/* Hero Heading */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-xs font-medium" style={{ color: "#6B5B4D" }}>
                Hero Heading
              </span>
              <Badge variant="outline" className="text-[10px] px-2 py-0">
                Cormorant 600
              </Badge>
            </div>
            <p className="font-[family-name:var(--font-playfair)] text-4xl md:text-5xl font-semibold tracking-tight">
              Elevate Your Beauty
            </p>
          </div>

          {/* Section Heading */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-xs font-medium" style={{ color: "#6B5B4D" }}>
                Section Heading
              </span>
              <Badge variant="outline" className="text-[10px] px-2 py-0">
                Cormorant 600
              </Badge>
            </div>
            <p className="font-[family-name:var(--font-playfair)] text-3xl md:text-4xl font-semibold tracking-tight">
              Our Premium Services
            </p>
          </div>

          {/* Card Title */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-xs font-medium" style={{ color: "#6B5B4D" }}>
                Card Title
              </span>
              <Badge variant="outline" className="text-[10px] px-2 py-0">
                Cormorant 600
              </Badge>
            </div>
            <p className="font-[family-name:var(--font-playfair)] text-xl font-semibold">
              Signature Facial Treatment
            </p>
          </div>

          {/* Section Label */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-xs font-medium" style={{ color: "#6B5B4D" }}>
                Section Label
              </span>
              <Badge variant="outline" className="text-[10px] px-2 py-0">
                DM Sans 600
              </Badge>
            </div>
            <p
              className="font-[family-name:var(--font-dm-sans)] text-xs font-semibold uppercase tracking-widest"
              style={{ color: "#C17A4A" }}
            >
              Curated Collection
            </p>
          </div>

          {/* Body Large */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-xs font-medium" style={{ color: "#6B5B4D" }}>
                Body Large
              </span>
              <Badge variant="outline" className="text-[10px] px-2 py-0">
                DM Sans 400
              </Badge>
            </div>
            <p className="font-[family-name:var(--font-dm-sans)] text-lg leading-relaxed max-w-2xl">
              Experience the art of beauty with our carefully curated treatments.
              Each service is designed to rejuvenate your skin, lift your spirits,
              and leave you feeling absolutely radiant.
            </p>
          </div>

          {/* Body */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-xs font-medium" style={{ color: "#6B5B4D" }}>
                Body
              </span>
              <Badge variant="outline" className="text-[10px] px-2 py-0">
                DM Sans 400
              </Badge>
            </div>
            <p className="font-[family-name:var(--font-dm-sans)] text-base leading-relaxed max-w-2xl">
              Our team of certified professionals uses only the finest organic
              products to deliver results that exceed expectations. Book your
              appointment today and discover the difference.
            </p>
          </div>

          {/* Caption */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-xs font-medium" style={{ color: "#6B5B4D" }}>
                Caption
              </span>
              <Badge variant="outline" className="text-[10px] px-2 py-0">
                DM Sans 400
              </Badge>
            </div>
            <p className="font-[family-name:var(--font-dm-sans)] text-sm" style={{ color: "#6B5B4D" }}>
              Available Mon-Sat &middot; 9:00 AM - 7:00 PM
            </p>
          </div>
        </div>
      </section>

      <hr className="border-border" />

      {/* ================================================================ */}
      {/* 4. BUTTONS                                                       */}
      {/* ================================================================ */}
      <section id="buttons" className="container mx-auto px-4 py-16 md:py-24">
        <SectionLabel>Interactive Elements</SectionLabel>
        <SectionHeading>Buttons</SectionHeading>

        {/* Variants */}
        <h3 className="font-[family-name:var(--font-playfair)] text-lg font-semibold mb-4">
          Variants
        </h3>
        <div className="flex flex-wrap items-center gap-3 mb-10">
          <Button className="rounded-full">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">
            Link
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
          <Button variant="destructive">Destructive</Button>
        </div>

        {/* Sizes */}
        <h3 className="font-[family-name:var(--font-playfair)] text-lg font-semibold mb-4">
          Sizes
        </h3>
        <div className="flex flex-wrap items-end gap-3 mb-10">
          <div className="flex flex-col items-center gap-2">
            <Button size="sm" className="rounded-full">
              Small
            </Button>
            <span className="text-[10px]" style={{ color: "#8D7E6D" }}>sm</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Button className="rounded-full">Default</Button>
            <span className="text-[10px]" style={{ color: "#8D7E6D" }}>default</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Button size="lg" className="rounded-full">
              Large
            </Button>
            <span className="text-[10px]" style={{ color: "#8D7E6D" }}>lg</span>
          </div>
        </div>

        {/* States */}
        <h3 className="font-[family-name:var(--font-playfair)] text-lg font-semibold mb-4">
          States
        </h3>
        <div className="flex flex-wrap items-center gap-3 mb-10">
          <div className="flex flex-col items-center gap-2">
            <Button className="rounded-full">Default</Button>
            <span className="text-[10px]" style={{ color: "#8D7E6D" }}>default</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Button
              className="rounded-full ring-2 ring-offset-2"
              style={{
                boxShadow: "0 0 0 2px #FFFDFB, 0 0 0 4px #C17A4A",
              }}
            >
              Focused
            </Button>
            <span className="text-[10px]" style={{ color: "#8D7E6D" }}>focused</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Button className="rounded-full" disabled>
              Disabled
            </Button>
            <span className="text-[10px]" style={{ color: "#8D7E6D" }}>disabled</span>
          </div>
        </div>

        {/* Icon Buttons */}
        <h3 className="font-[family-name:var(--font-playfair)] text-lg font-semibold mb-4">
          Icon Buttons
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="icon" className="rounded-full">
            <Heart className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="outline" className="rounded-full">
            <Settings className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="secondary" className="rounded-full">
            <MessageCircle className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="rounded-full">
            <Sparkles className="h-4 w-4" />
          </Button>
        </div>
      </section>

      <hr className="border-border" />

      {/* ================================================================ */}
      {/* 5. CARDS                                                         */}
      {/* ================================================================ */}
      <section id="cards" className="container mx-auto px-4 py-16 md:py-24">
        <SectionLabel>Content Containers</SectionLabel>
        <SectionHeading>Cards</SectionHeading>

        {/* Row 1: Service, Feature, Testimonial */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* Service Card */}
          <Card className="overflow-hidden group">
            <div
              className="h-36 flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, #FAE8DC 0%, #F3CDAF 50%, #E8AC7E 100%)",
              }}
            >
              <Sparkles
                className="h-10 w-10 transition-transform group-hover:scale-110"
                style={{ color: "#8B5035" }}
              />
            </div>
            <CardHeader className="pb-2">
              <CardTitle className="font-[family-name:var(--font-playfair)] text-xl">
                Signature Facial
              </CardTitle>
              <CardDescription>
                A luxurious 90-minute treatment combining deep cleansing,
                exfoliation, and hydrating masks for a radiant complexion.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <span
                  className="font-[family-name:var(--font-playfair)] text-2xl font-bold"
                  style={{ color: "#C17A4A" }}
                >
                  249 zl
                </span>
                <a
                  href="#"
                  className="text-sm font-medium inline-flex items-center gap-1"
                  style={{ color: "#C17A4A" }}
                >
                  Book now
                  <ArrowRight className="h-3.5 w-3.5" />
                </a>
              </div>
            </CardContent>
          </Card>

          {/* Feature Card */}
          <Card className="text-center">
            <CardHeader className="pb-2 items-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-2"
                style={{ backgroundColor: "#FAE8DC" }}
              >
                <Shield className="h-7 w-7" style={{ color: "#C17A4A" }} />
              </div>
              <CardTitle className="font-[family-name:var(--font-playfair)] text-xl">
                Secure Payments
              </CardTitle>
              <CardDescription className="max-w-xs mx-auto">
                Accept deposits and full payments online with Stripe integration.
                Clients can pay via card or Blik for ultimate convenience.
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Testimonial Card */}
          <Card>
            <CardHeader className="pb-3">
              <Stars rating={5} />
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="font-[family-name:var(--font-playfair)] text-lg italic leading-relaxed">
                &ldquo;MyHelper transformed how I manage my salon. The AI
                assistant alone saves me hours every week. My clients love
                the online booking!&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold"
                  style={{
                    backgroundColor: "#FAE8DC",
                    color: "#8B5035",
                  }}
                >
                  MK
                </div>
                <div>
                  <p className="text-sm font-semibold">Marta Kowalska</p>
                  <p className="text-xs" style={{ color: "#6B5B4D" }}>
                    Owner, Studio Urody
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Row 2: Stats, Notification */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Stats Card */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: "#FAE8DC" }}
                >
                  <Calendar className="h-5 w-5" style={{ color: "#C17A4A" }} />
                </div>
                <div>
                  <p className="text-xs font-medium" style={{ color: "#6B5B4D" }}>
                    Monthly Bookings
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="font-[family-name:var(--font-playfair)] text-4xl font-bold">
                1,247
              </p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span style={{ color: "#6B5B4D" }}>Progress</span>
                  <span className="font-medium" style={{ color: "#5D8C61" }}>
                    78%
                  </span>
                </div>
                <div
                  className="h-2 rounded-full overflow-hidden"
                  style={{ backgroundColor: "#EDE0D4" }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: "78%",
                      backgroundColor: "#5D8C61",
                    }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notification Card */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: "#FAE8DC" }}
                >
                  <Clock className="h-5 w-5" style={{ color: "#C17A4A" }} />
                </div>
                <div>
                  <CardTitle className="font-[family-name:var(--font-playfair)] text-lg">
                    Upcoming Appointment
                  </CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm" style={{ color: "#6B5B4D" }}>
                Anna Nowak has a Signature Facial booked for tomorrow at 2:00
                PM with Katarzyna. Please confirm or reschedule.
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" className="rounded-full">
                  <Check className="h-3.5 w-3.5 mr-1" />
                  Confirm
                </Button>
                <Button size="sm" variant="outline" className="rounded-full">
                  Reschedule
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <hr className="border-border" />

      {/* ================================================================ */}
      {/* 6. BADGES & STARS                                                */}
      {/* ================================================================ */}
      <section id="badges" className="container mx-auto px-4 py-16 md:py-24">
        <SectionLabel>Metadata & Rating</SectionLabel>
        <SectionHeading>Badges</SectionHeading>

        {/* Badge variants */}
        <div className="flex flex-wrap items-center gap-3 mb-12">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
          {/* Custom styled badges */}
          <Badge
            className="border-transparent"
            style={{ backgroundColor: "#5D8C61", color: "#FFFFFF" }}
          >
            Active
          </Badge>
          <Badge
            className="border-transparent"
            style={{ backgroundColor: "#D4A843", color: "#FFFFFF" }}
          >
            Pending
          </Badge>
          <Badge
            className="border-transparent"
            style={{ backgroundColor: "#5B8DB8", color: "#FFFFFF" }}
          >
            Info
          </Badge>
          <Badge
            className="border-transparent"
            style={{ backgroundColor: "#C17A4A", color: "#FFFFFF" }}
          >
            <Crown className="h-3 w-3 mr-1" />
            Pro Plan
          </Badge>
        </div>

        {/* Star Ratings */}
        <h3 className="font-[family-name:var(--font-playfair)] text-lg font-semibold mb-4">
          Star Ratings
        </h3>
        <div className="flex flex-wrap items-center gap-8">
          {[5, 4, 3, 1].map((rating) => (
            <div key={rating} className="flex items-center gap-2">
              <Stars rating={rating} />
              <span className="text-sm font-medium">
                {rating}.0
              </span>
            </div>
          ))}
        </div>
      </section>

      <hr className="border-border" />

      {/* ================================================================ */}
      {/* 7. FORM ELEMENTS                                                 */}
      {/* ================================================================ */}
      <section id="forms" className="container mx-auto px-4 py-16 md:py-24">
        <SectionLabel>Data Input</SectionLabel>
        <SectionHeading>Form Elements</SectionHeading>

        <Card className="max-w-xl mx-auto">
          <CardHeader>
            <CardTitle className="font-[family-name:var(--font-playfair)] text-2xl">
              Book an Appointment
            </CardTitle>
            <CardDescription>
              Fill in the details below to schedule your next visit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" action="#">
              {/* Full Name */}
              <div className="space-y-1.5">
                <label
                  htmlFor="ds-name"
                  className="text-sm font-medium"
                >
                  Full Name
                </label>
                <Input
                  id="ds-name"
                  placeholder="e.g. Anna Nowak"
                  className="rounded-lg"
                />
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label
                  htmlFor="ds-email"
                  className="text-sm font-medium"
                >
                  Email Address
                </label>
                <Input
                  id="ds-email"
                  type="email"
                  placeholder="anna@example.com"
                  className="rounded-lg"
                />
              </div>

              {/* Phone */}
              <div className="space-y-1.5">
                <label
                  htmlFor="ds-phone"
                  className="text-sm font-medium"
                >
                  Phone Number
                </label>
                <Input
                  id="ds-phone"
                  type="tel"
                  placeholder="+48 123 456 789"
                  className="rounded-lg"
                />
              </div>

              {/* Service select */}
              <div className="space-y-1.5">
                <label
                  htmlFor="ds-service"
                  className="text-sm font-medium"
                >
                  Service
                </label>
                <select
                  id="ds-service"
                  className="flex h-9 w-full rounded-lg border bg-transparent px-3 py-1 text-base shadow-xs transition-colors outline-none md:text-sm"
                  style={{
                    borderColor: "#DDD0C2",
                    color: "#2D1F15",
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>
                    Select a service...
                  </option>
                  <option value="facial">Signature Facial</option>
                  <option value="massage">Relaxation Massage</option>
                  <option value="hair">Hair Styling</option>
                  <option value="nails">Nail Art</option>
                  <option value="makeup">Bridal Makeup</option>
                </select>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label
                  htmlFor="ds-notes"
                  className="text-sm font-medium"
                >
                  Additional Notes
                </label>
                <textarea
                  id="ds-notes"
                  rows={3}
                  placeholder="Any special requests or preferences..."
                  className="flex w-full rounded-lg border bg-transparent px-3 py-2 text-base shadow-xs transition-colors outline-none md:text-sm placeholder:text-muted-foreground"
                  style={{ borderColor: "#DDD0C2" }}
                />
              </div>

              <Button className="w-full rounded-full" size="lg">
                <Calendar className="h-4 w-4 mr-2" />
                Confirm Booking
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      <hr className="border-border" />

      {/* ================================================================ */}
      {/* 8. FAQ ACCORDION                                                 */}
      {/* ================================================================ */}
      <section id="faq" className="container mx-auto px-4 py-16 md:py-24">
        <SectionLabel>Help Center</SectionLabel>
        <SectionHeading>Frequently Asked Questions</SectionHeading>

        <div className="max-w-2xl mx-auto">
          <Card className="divide-y" style={{ borderColor: "#DDD0C2" }}>
            {FAQ_ITEMS.map((item, idx) => (
              <details
                key={idx}
                className="group"
              >
                <summary className="flex items-center justify-between cursor-pointer px-6 py-5 text-sm font-medium list-none [&::-webkit-details-marker]:hidden">
                  <span className="font-[family-name:var(--font-playfair)] text-lg font-semibold pr-4">
                    {item.q}
                  </span>
                  <ChevronDown className="h-5 w-5 shrink-0 transition-transform duration-200 group-open:rotate-180" style={{ color: "#C17A4A" }} />
                </summary>
                <div className="px-6 pb-5 text-sm leading-relaxed" style={{ color: "#6B5B4D" }}>
                  {item.a}
                </div>
              </details>
            ))}
          </Card>
        </div>
      </section>

      <hr className="border-border" />

      {/* ================================================================ */}
      {/* 9. SHADOWS & SPACING                                             */}
      {/* ================================================================ */}
      <section id="spacing" className="container mx-auto px-4 py-16 md:py-24">
        <SectionLabel>Depth & Rhythm</SectionLabel>
        <SectionHeading>Shadows & Spacing</SectionHeading>

        {/* Shadow Scale */}
        <h3 className="font-[family-name:var(--font-playfair)] text-lg font-semibold mb-6">
          Shadow Scale
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6 mb-14">
          {SHADOW_SCALE.map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-3">
              <div
                className="w-full aspect-square rounded-xl"
                style={{
                  boxShadow: s.value,
                  backgroundColor: "#FFFDFB",
                  border: "1px solid #EDE0D4",
                }}
              />
              <span className="text-xs font-medium" style={{ color: "#6B5B4D" }}>
                shadow-{s.label}
              </span>
            </div>
          ))}
        </div>

        {/* Spacing Scale */}
        <h3 className="font-[family-name:var(--font-playfair)] text-lg font-semibold mb-6">
          Spacing Scale
        </h3>
        <div className="space-y-3 mb-14 max-w-lg">
          {SPACING_SCALE.map((s) => (
            <div key={s.label} className="flex items-center gap-4">
              <span
                className="text-xs font-mono w-10 text-right shrink-0"
                style={{ color: "#6B5B4D" }}
              >
                {s.label}
              </span>
              <div
                className="h-4 rounded-sm"
                style={{
                  width: `${s.size * 4}px`,
                  backgroundColor: "#C17A4A",
                }}
              />
            </div>
          ))}
        </div>

        {/* Border Radius */}
        <h3 className="font-[family-name:var(--font-playfair)] text-lg font-semibold mb-6">
          Border Radius
        </h3>
        <div className="flex flex-wrap items-end gap-6">
          {RADIUS_SCALE.map((r) => (
            <div key={r.label} className="flex flex-col items-center gap-3">
              <div
                className="w-16 h-16"
                style={{
                  borderRadius: r.value,
                  backgroundColor: "#FAE8DC",
                  border: "2px solid #C17A4A",
                }}
              />
              <span className="text-xs font-medium" style={{ color: "#6B5B4D" }}>
                {r.label}
              </span>
            </div>
          ))}
        </div>
      </section>

      <hr className="border-border" />

      {/* ================================================================ */}
      {/* 10. FOOTER CTA                                                   */}
      {/* ================================================================ */}
      <section
        className="relative overflow-hidden py-20 md:py-28"
        style={{ backgroundColor: "#F7EDE3" }}
      >
        {/* Decorative blurred circles */}
        <div
          className="absolute top-1/4 right-[5%] w-80 h-80 rounded-full blur-3xl"
          style={{ backgroundColor: "rgba(193,122,74,0.10)" }}
        />
        <div
          className="absolute bottom-1/4 left-[8%] w-64 h-64 rounded-full blur-3xl"
          style={{ backgroundColor: "rgba(214,142,86,0.08)" }}
        />

        <div className="relative container mx-auto px-4 text-center">
          <SectionLabel>Get Started</SectionLabel>

          <h2 className="font-[family-name:var(--font-playfair)] text-3xl md:text-5xl font-bold tracking-tight leading-tight mb-6">
            Ready to elevate your
            <br />
            <span
              className="italic"
              style={{
                background: "linear-gradient(135deg, #C17A4A, #D68E56)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              salon experience
            </span>
            ?
          </h2>

          <p
            className="text-lg max-w-xl mx-auto mb-10 leading-relaxed"
            style={{ color: "#6B5B4D" }}
          >
            Join hundreds of beauty professionals who trust MyHelper to
            streamline their daily operations. Start your free 14-day trial
            today -- no credit card required.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              size="lg"
              className="h-12 px-8 text-base rounded-full shadow-lg"
              style={{
                backgroundColor: "#C17A4A",
                color: "#FFFFFF",
                boxShadow: "0 8px 20px rgba(193,122,74,0.25)",
              }}
            >
              Start Free Trial
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-12 px-8 text-base rounded-full"
            >
              <Mail className="h-4 w-4 mr-2" />
              Contact Sales
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
