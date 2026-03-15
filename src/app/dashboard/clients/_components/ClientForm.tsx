"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { FormRecoveryBanner } from "@/components/form-recovery-banner";

interface ClientFormProps {
  dialogOpen: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;

  // Form fields
  formFirstName: string;
  onFirstNameChange: (v: string) => void;
  formLastName: string;
  onLastNameChange: (v: string) => void;
  formPhone: string;
  onPhoneChange: (v: string) => void;
  formEmail: string;
  onEmailChange: (v: string) => void;
  formNotes: string;
  onNotesChange: (v: string) => void;
  formErrors: Record<string, string>;
  clearFieldError: (field: string) => void;

  // Form recovery
  clientWasRecovered: boolean;
  onRestore: () => void;
  onDismissRecovery: () => void;

  // Actions
  onSave: () => void;
  onCancel: () => void;
}

export function ClientForm({
  dialogOpen,
  onOpenChange,
  saving,
  formFirstName,
  onFirstNameChange,
  formLastName,
  onLastNameChange,
  formPhone,
  onPhoneChange,
  formEmail,
  onEmailChange,
  formNotes,
  onNotesChange,
  formErrors,
  clearFieldError,
  clientWasRecovered,
  onRestore,
  onDismissRecovery,
  onSave,
  onCancel,
}: ClientFormProps) {
  return (
    <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button data-testid="add-client-btn">
          <Plus className="h-4 w-4 mr-2" />
          Dodaj klienta
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Dodaj nowego klienta</DialogTitle>
          <DialogDescription>
            Wypelnij formularz, aby dodac nowego klienta do bazy salonu.
          </DialogDescription>
        </DialogHeader>
        {clientWasRecovered && (
          <FormRecoveryBanner
            onRestore={onRestore}
            onDismiss={onDismissRecovery}
          />
        )}
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="client-first-name">Imie *</Label>
              <Input
                id="client-first-name"
                placeholder="np. Jan"
                value={formFirstName}
                onChange={(e) => {
                  onFirstNameChange(e.target.value);
                  if (e.target.value.trim()) clearFieldError("firstName");
                }}
                required
                aria-invalid={!!formErrors.firstName}
                className={formErrors.firstName ? "border-destructive" : ""}
                data-testid="client-first-name-input"
              />
              {formErrors.firstName && (
                <p className="text-sm text-destructive" data-testid="error-first-name">
                  {formErrors.firstName}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="client-last-name">Nazwisko *</Label>
              <Input
                id="client-last-name"
                placeholder="np. Kowalski"
                value={formLastName}
                onChange={(e) => {
                  onLastNameChange(e.target.value);
                  if (e.target.value.trim()) clearFieldError("lastName");
                }}
                required
                aria-invalid={!!formErrors.lastName}
                className={formErrors.lastName ? "border-destructive" : ""}
                data-testid="client-last-name-input"
              />
              {formErrors.lastName && (
                <p className="text-sm text-destructive" data-testid="error-last-name">
                  {formErrors.lastName}
                </p>
              )}
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="client-phone">Numer telefonu</Label>
            <Input
              id="client-phone"
              type="tel"
              placeholder="np. +48 600 123 456"
              value={formPhone}
              onChange={(e) => {
                onPhoneChange(e.target.value);
                clearFieldError("phone");
              }}
              aria-invalid={!!formErrors.phone}
              className={formErrors.phone ? "border-destructive" : ""}
              data-testid="client-phone-input"
            />
            {formErrors.phone && (
              <p className="text-sm text-destructive" data-testid="error-phone">
                {formErrors.phone}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="client-email">Adres email</Label>
            <Input
              id="client-email"
              type="email"
              placeholder="np. jan.kowalski@example.com"
              value={formEmail}
              onChange={(e) => {
                onEmailChange(e.target.value);
                clearFieldError("email");
              }}
              aria-invalid={!!formErrors.email}
              data-testid="client-email-input"
            />
            {formErrors.email && (
              <p className="text-sm text-destructive">{formErrors.email}</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="client-notes">Notatki</Label>
            <Textarea
              id="client-notes"
              placeholder="Dodatkowe informacje o kliencie..."
              value={formNotes}
              onChange={(e) => onNotesChange(e.target.value)}
              rows={3}
              data-testid="client-notes-input"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Anuluj
          </Button>
          <Button
            onClick={onSave}
            disabled={saving}
            data-testid="save-client-btn"
          >
            {saving ? "Zapisywanie..." : "Zapisz klienta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
