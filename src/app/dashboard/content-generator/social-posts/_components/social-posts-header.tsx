"use client";

import Link from "next/link";
import { ArrowLeft, Instagram, CalendarClock, BookOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type SocialPostsHeaderProps = {
  templateName: string | undefined;
  onClearTemplate: () => void;
};

export function SocialPostsHeader({
  templateName,
  onClearTemplate,
}: SocialPostsHeaderProps) {
  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/content-generator">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Instagram className="h-6 w-6 text-primary" />
            Posty social media
          </h1>
          <p className="text-muted-foreground">
            Generuj angazujace posty na Instagram, Facebook i TikTok
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard/content-generator/scheduled">
            <CalendarClock className="h-4 w-4 mr-2" />
            Zaplanowane posty
          </Link>
        </Button>
      </div>

      {/* Template banner - shown when a template is active */}
      {templateName && (
        <div className="flex items-center gap-3 mb-6 p-3 rounded-lg border border-primary/30 bg-primary/5">
          <BookOpen className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="text-sm font-medium flex-1">
            Szablon: {templateName}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearTemplate}
            className="h-7 px-2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Wyczysc
          </Button>
        </div>
      )}
    </>
  );
}
