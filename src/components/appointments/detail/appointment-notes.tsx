"use client";

import { useState } from "react";
import { FileText, Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { AppointmentDetail } from "./types";

interface AppointmentNotesProps {
  appointment: AppointmentDetail;
  /** Called after notes are saved so the parent can refetch appointment data. */
  onNotesSaved: () => void;
}

export function AppointmentNotes({
  appointment,
  onNotesSaved,
}: AppointmentNotesProps) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

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
      const res = await fetch(`/api/appointments/${appointment.id}`, {
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
            <FileText className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Notatki wewnetrzne</CardTitle>
          </div>
          {!editingNotes && appointment.status !== "cancelled" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleStartEditingNotes}
              data-testid="edit-notes-btn"
            >
              <Pencil className="h-4 w-4 mr-1" />
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
            <div className="flex items-center gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelEditingNotes}
                disabled={savingNotes}
                data-testid="cancel-notes-btn"
              >
                <X className="h-4 w-4 mr-1" />
                Anuluj
              </Button>
              <Button
                size="sm"
                onClick={handleSaveNotes}
                disabled={savingNotes}
                data-testid="save-notes-btn"
              >
                <Save className="h-4 w-4 mr-1" />
                {savingNotes ? "Zapisywanie..." : "Zapisz notatki"}
              </Button>
            </div>
          </div>
        ) : appointment.notes ? (
          <p className="text-sm whitespace-pre-wrap" data-testid="notes-content">
            {appointment.notes}
          </p>
        ) : (
          <div className="text-center py-6" data-testid="no-notes">
            <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-muted-foreground">Brak notatek wewnetrznych</p>
            <p className="text-sm text-muted-foreground mt-1">
              Dodaj notatki widoczne dla calego personelu
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
