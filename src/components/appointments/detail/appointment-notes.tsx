"use client";

import { useState } from "react";
import { FileText, Pencil, Save, X, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ReadAloudButton } from "@/components/ui/read-aloud-button";
import { mutationFetch } from "@/lib/api-client";
import type { AppointmentDetail } from "./types";

interface AISummary {
  keyPoints: string[];
  productRecommendations: string[];
  followUpTiming: string;
  fullSummary: string;
}

interface AppointmentNotesProps {
  appointment: AppointmentDetail;
  /** Called after notes are saved so the parent can refetch appointment data. */
  onNotesSaved: () => void;
}

export function AppointmentNotes({ appointment, onNotesSaved }: AppointmentNotesProps) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [aiSummary, setAiSummary] = useState<AISummary | null>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);

  const handleGenerateSummary = async () => {
    setGeneratingSummary(true);
    try {
      const res = await mutationFetch("/api/ai/appointments/auto-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId: appointment.id }),
      });
      const data = await res.json();
      if (data.success && data.summary) {
        setAiSummary(data.summary);
      } else if (data.code === "PLAN_UPGRADE_REQUIRED") {
        toast.error("Podsumowanie AI dostepne tylko w Planie Pro");
      } else {
        toast.error(data.error || "Nie udalo sie wygenerowac podsumowania");
      }
    } catch {
      toast.error("Blad podczas generowania podsumowania AI");
    } finally {
      setGeneratingSummary(false);
    }
  };

  const handleStartEditingNotes = () => {
    setNotesValue(appointment.notes || "");
    setEditingNotes(true);
  };

  const handleCancelEditingNotes = () => {
    setEditingNotes(false);
    setNotesValue("");
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      const res = await mutationFetch(`/api/appointments/${appointment.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesValue.trim() || null }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Notatki zostaly zapisane");
        setEditingNotes(false);
        onNotesSaved();
      } else {
        toast.error(data.error || "Nie udalo sie zapisac notatek");
      }
    } catch {
      toast.error("Blad podczas zapisywania notatek");
    } finally {
      setSavingNotes(false);
    }
  };

  return (
    <Card className="mb-6" data-testid="notes-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="text-primary h-5 w-5" />
            <CardTitle className="text-lg">Notatki wewnetrzne</CardTitle>
          </div>
          {!editingNotes && appointment.status !== "cancelled" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleStartEditingNotes}
              data-testid="edit-notes-btn"
            >
              <Pencil className="mr-1 h-4 w-4" />
              {appointment.notes ? "Edytuj" : "Dodaj notatke"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {editingNotes ? (
          <div className="space-y-3">
            <Textarea
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              placeholder="Dodaj notatki wewnetrzne dla personelu (np. preferencje klienta, szczegoly zabiegu, uwagi)..."
              className="min-h-[120px]"
              data-testid="notes-textarea"
              autoFocus
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelEditingNotes}
                disabled={savingNotes}
                data-testid="cancel-notes-btn"
              >
                <X className="mr-1 h-4 w-4" />
                Anuluj
              </Button>
              <Button
                size="sm"
                onClick={handleSaveNotes}
                disabled={savingNotes}
                data-testid="save-notes-btn"
              >
                <Save className="mr-1 h-4 w-4" />
                {savingNotes ? "Zapisywanie..." : "Zapisz notatki"}
              </Button>
            </div>
          </div>
        ) : appointment.notes ? (
          <p className="text-sm whitespace-pre-wrap" data-testid="notes-content">
            {appointment.notes}
          </p>
        ) : (
          <div className="py-6 text-center" data-testid="no-notes">
            <FileText className="text-muted-foreground/50 mx-auto mb-3 h-10 w-10" />
            <p className="text-muted-foreground">Brak notatek wewnetrznych</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Dodaj notatki widoczne dla calego personelu
            </p>
          </div>
        )}

        {/* AI Summary section */}
        {appointment.status === "completed" && (
          <div className="mt-4 border-t pt-4" data-testid="ai-summary-section">
            {aiSummary ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="text-primary h-4 w-4" />
                    <span className="text-sm font-semibold">Podsumowanie AI</span>
                    <Badge variant="secondary" className="text-xs">
                      Pro
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <ReadAloudButton text={aiSummary.fullSummary} />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleGenerateSummary}
                      disabled={generatingSummary}
                    >
                      <Sparkles className="mr-1 h-3 w-3" />
                      Generuj ponownie
                    </Button>
                  </div>
                </div>

                <p className="text-muted-foreground text-sm">{aiSummary.fullSummary}</p>

                {aiSummary.keyPoints.length > 0 && (
                  <div>
                    <p className="text-muted-foreground mb-1 text-xs font-medium">
                      Kluczowe punkty:
                    </p>
                    <ul className="space-y-1 text-sm">
                      {aiSummary.keyPoints.map((point, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-primary mt-0.5 shrink-0">•</span>
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiSummary.productRecommendations.length > 0 && (
                  <div>
                    <p className="text-muted-foreground mb-1 text-xs font-medium">
                      Rekomendacje produktow:
                    </p>
                    <ul className="space-y-1 text-sm">
                      {aiSummary.productRecommendations.map((rec, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-primary mt-0.5 shrink-0">•</span>
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-muted-foreground text-xs">
                  <span className="font-medium">Nastepna wizyta:</span> {aiSummary.followUpTiming}
                </p>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateSummary}
                disabled={generatingSummary}
                className="w-full"
                data-testid="generate-ai-summary-btn"
              >
                {generatingSummary ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generowanie podsumowania...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Generuj podsumowanie AI
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
