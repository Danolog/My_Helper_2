"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, Search, Instagram, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";
import {
  contentTemplates,
  type ContentTemplateCategory,
  type ContentTemplate,
} from "@/lib/content-templates";

// ---- Category filter options ----
type FilterOption = "all" | ContentTemplateCategory;

const FILTER_OPTIONS: { value: FilterOption; label: string }[] = [
  { value: "all", label: "Wszystkie" },
  { value: "social", label: "Social media" },
  { value: "newsletter", label: "Newslettery" },
];

// ---- Category badge styling ----
function CategoryBadge({ category }: { category: ContentTemplateCategory }) {
  if (category === "social") {
    return (
      <Badge className="bg-pink-100 text-pink-700 border-pink-200 hover:bg-pink-100 dark:bg-pink-950 dark:text-pink-300 dark:border-pink-800">
        <Instagram className="h-3 w-3 mr-1" />
        Social media
      </Badge>
    );
  }
  return (
    <Badge className="bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
      <Mail className="h-3 w-3 mr-1" />
      Newsletter
    </Badge>
  );
}

// ---- Single template card ----
function TemplateCard({ template }: { template: ContentTemplate }) {
  const router = useRouter();

  const handleUseTemplate = () => {
    if (template.category === "social") {
      router.push(
        `/dashboard/content-generator/social-posts?template=${template.id}`
      );
    } else {
      router.push(
        `/dashboard/content-generator/newsletters?template=${template.id}`
      );
    }
  };

  return (
    <div className="border rounded-lg p-5 space-y-3 hover:border-primary hover:shadow-md transition-all flex flex-col">
      {/* Icon and badge row */}
      <div className="flex items-start justify-between">
        <span className="text-3xl" role="img" aria-label={template.name}>
          {template.icon}
        </span>
        <CategoryBadge category={template.category} />
      </div>

      {/* Name and description */}
      <div className="flex-1 space-y-1">
        <h3 className="font-semibold">{template.name}</h3>
        <p className="text-sm text-muted-foreground">{template.description}</p>
      </div>

      {/* Action button */}
      <Button
        variant="outline"
        size="sm"
        className="w-full mt-auto"
        onClick={handleUseTemplate}
      >
        Uzyj szablonu
      </Button>
    </div>
  );
}

// ---- Main content ----
function TemplatesContent() {
  const [filter, setFilter] = useState<FilterOption>("all");
  const [search, setSearch] = useState("");

  const filteredTemplates = contentTemplates.filter((t) => {
    // Category filter
    if (filter !== "all" && t.category !== filter) return false;
    // Text search (case-insensitive, matches name or description)
    if (search.trim()) {
      const query = search.trim().toLowerCase();
      return (
        t.name.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query)
      );
    }
    return true;
  });

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/content-generator">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            Szablony tresci
          </h1>
          <p className="text-muted-foreground">
            Gotowe szablony do szybkiego tworzenia tresci marketingowych
          </p>
        </div>
      </div>

      {/* Search and filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Szukaj szablonu..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          {FILTER_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={filter === opt.value ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Templates grid */}
      {filteredTemplates.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTemplates.map((template) => (
            <TemplateCard key={template.id} template={template} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <BookOpen className="h-12 w-12 opacity-20" />
          <p className="text-sm text-center">
            Nie znaleziono szablonow pasujacych do wyszukiwania.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setFilter("all");
            }}
          >
            Wyczysc filtry
          </Button>
        </div>
      )}
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <ProPlanGate
      featureName="Szablony tresci"
      featureDescription="Gotowe szablony marketingowe dopasowane do branzy beauty i wellness - szybkie tworzenie postow i newsletterow."
      proBenefits={[
        "12 gotowych szablonow tresci",
        "Szablony postow na Instagram, Facebook i TikTok",
        "Szablony newsletterow promocyjnych i informacyjnych",
        "Wstepnie skonfigurowane ustawienia generatora",
        "Filtrowanie i wyszukiwanie szablonow",
      ]}
    >
      <TemplatesContent />
    </ProPlanGate>
  );
}
