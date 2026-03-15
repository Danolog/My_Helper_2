"use client";

import Link from "next/link";
import { ArrowLeft, Mail, BookOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type NewsletterHeaderProps = {
  templateName: string | undefined;
  onClearTemplate: () => void;
};

export function NewsletterHeader({
  templateName,
  onClearTemplate,
}: NewsletterHeaderProps) {
  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/content-generator">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="h-6 w-6 text-primary" />
            Newslettery
          </h1>
          <p className="text-muted-foreground">
            Tworzenie newsletterow promocyjnych i informacyjnych z pomoca AI
          </p>
        </div>
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
