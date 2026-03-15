"use client";

import {
  Mail,
  Loader2,
  Copy,
  Check,
  RefreshCw,
  Save,
  Pencil,
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GOALS, TONES } from "../_types";
import type { GeneratedNewsletter } from "../_types";

type NewsletterPreviewCardProps = {
  isGenerating: boolean;
  generatedNewsletter: GeneratedNewsletter | null;
  isEditingNewsletter: boolean;
  editedSubject: string;
  onEditedSubjectChange: (value: string) => void;
  editedContent: string;
  onEditedContentChange: (value: string) => void;
  copied: boolean;
  isSaving: boolean;
  onCopy: () => void;
  onToggleEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onRegenerate: () => void;
};

export function NewsletterPreviewCard({
  isGenerating,
  generatedNewsletter,
  isEditingNewsletter,
  editedSubject,
  onEditedSubjectChange,
  editedContent,
  onEditedContentChange,
  copied,
  isSaving,
  onCopy,
  onToggleEdit,
  onSaveEdit,
  onCancelEdit,
  onSave,
  onRegenerate,
}: NewsletterPreviewCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Wygenerowany newsletter
        </CardTitle>
        <CardDescription>
          Podglad wygenerowanej tresci - zapisz lub skopiuj
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isGenerating ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              AI generuje newsletter...
            </p>
          </div>
        ) : generatedNewsletter ? (
          <div className="space-y-4">
            {/* Meta badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary">
                {GOALS.find((g) => g.value === generatedNewsletter.goal)
                  ?.label || generatedNewsletter.goal}
              </Badge>
              <Badge variant="outline">
                {TONES.find((t) => t.value === generatedNewsletter.tone)
                  ?.label || generatedNewsletter.tone}
              </Badge>
              <Badge variant="secondary">
                {generatedNewsletter.wordCount} slow
              </Badge>
              {generatedNewsletter.savedId && (
                <Badge
                  variant="default"
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Check className="h-3 w-3 mr-1" />
                  Zapisany
                </Badge>
              )}
            </div>

            {/* Subject line */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Temat emaila
              </Label>
              {isEditingNewsletter ? (
                <input
                  type="text"
                  value={editedSubject}
                  onChange={(e) => onEditedSubjectChange(e.target.value)}
                  className="w-full bg-primary/5 border border-primary/40 rounded-lg p-3 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  data-testid="edit-newsletter-subject"
                />
              ) : (
                <div
                  className="bg-primary/5 border border-primary/20 rounded-lg p-3 font-medium cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={onToggleEdit}
                >
                  {generatedNewsletter.subject}
                </div>
              )}
            </div>

            {/* Content */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Tresc newslettera
              </Label>
              {isEditingNewsletter ? (
                <div className="space-y-2">
                  <Textarea
                    value={editedContent}
                    onChange={(e) => onEditedContentChange(e.target.value)}
                    rows={12}
                    className="text-sm leading-relaxed resize-y min-h-[200px]"
                    data-testid="edit-newsletter-content"
                  />
                  <div className="flex items-center justify-between">
                    <Badge variant="secondary">
                      {editedContent.split(/\s+/).filter(Boolean).length} slow
                    </Badge>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onCancelEdit}
                      >
                        Anuluj
                      </Button>
                      <Button
                        size="sm"
                        onClick={onSaveEdit}
                      >
                        <Check className="h-3.5 w-3.5 mr-1" />
                        Zapisz zmiany
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className="bg-muted/50 rounded-lg p-4 whitespace-pre-wrap text-sm leading-relaxed border max-h-[400px] overflow-y-auto cursor-pointer hover:border-primary/50 transition-colors group relative"
                  onClick={onToggleEdit}
                  data-testid="newsletter-content-display"
                >
                  {generatedNewsletter.content}
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Badge variant="secondary" className="text-xs">
                      <Pencil className="h-3 w-3 mr-1" />
                      Kliknij aby edytowac
                    </Badge>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="default"
                className="flex-1"
                onClick={onCopy}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Skopiowano!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Kopiuj
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={onToggleEdit}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Edytuj
              </Button>
              {!generatedNewsletter.savedId && (
                <Button
                  variant="secondary"
                  onClick={onSave}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Zapisz
                </Button>
              )}
              <Button
                variant="outline"
                onClick={onRegenerate}
                disabled={isGenerating}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Generuj ponownie
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <Mail className="h-12 w-12 opacity-20" />
            <p className="text-sm text-center">
              Podaj temat i kliknij &quot;Wygeneruj newsletter&quot; aby
              otrzymac tresc gotowa do wyslania
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
