"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  User,
  AlertTriangle,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClientData } from "./types";

interface ClientProfileHeaderProps {
  client: ClientData;
  clientId: string;
  /** Display name from form state (may differ from client.firstName while editing). */
  displayFirstName: string;
  /** Display name from form state (may differ from client.lastName while editing). */
  displayLastName: string;
  saving: boolean;
  onSave: () => void;
}

/**
 * Header section of the client profile page.
 * Includes back button, client name display, save/delete action buttons,
 * and the password-protected delete confirmation dialog.
 */
export function ClientProfileHeader({
  client,
  clientId,
  displayFirstName,
  displayLastName,
  saving,
  onSave,
}: ClientProfileHeaderProps) {
  const router = useRouter();

  // Delete confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleDeleteClient = async () => {
    if (!deletePassword.trim()) {
      setDeleteError("Wpisz haslo, aby potwierdzic usuniecie");
      return;
    }

    setDeleting(true);
    setDeleteError("");

    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(
          `Klient "${client.firstName} ${client.lastName}" zostal usuniety`
        );
        setDeleteDialogOpen(false);
        router.replace("/dashboard/clients");
      } else {
        if (res.status === 403) {
          setDeleteError("Nieprawidlowe haslo. Sprobuj ponownie.");
        } else {
          setDeleteError(data.error || "Nie udalo sie usunac klienta");
        }
      }
    } catch {
      setDeleteError("Blad podczas usuwania klienta");
    } finally {
      setDeleting(false);
    }
  };

  const openDeleteDialog = () => {
    setDeletePassword("");
    setDeleteError("");
    setDeleteDialogOpen(true);
  };

  return (
    <>
      {/* Header with back button */}
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push("/dashboard/clients")}
          data-testid="back-to-clients-btn"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3 flex-1">
          <User className="w-8 h-8 text-primary" />
          <div>
            <h1
              className="text-2xl font-bold"
              data-testid="client-profile-name"
            >
              {displayFirstName || client.firstName} {displayLastName || client.lastName}
            </h1>
            <p className="text-muted-foreground text-sm">Profil klienta</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="destructive"
            onClick={openDeleteDialog}
            data-testid="delete-client-btn"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Usun klienta
          </Button>
          <Button
            onClick={onSave}
            disabled={saving}
            data-testid="save-client-btn"
          >
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Zapisywanie..." : "Zapisz zmiany"}
          </Button>
        </div>
      </div>

      {/* Delete confirmation dialog with password */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Usuwanie klienta
            </DialogTitle>
            <DialogDescription>
              Czy na pewno chcesz usunac klienta{" "}
              <strong>
                {client.firstName} {client.lastName}
              </strong>
              ? Ta operacja jest nieodwracalna. Wpisz swoje haslo, aby
              potwierdzic.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="delete-password">Twoje haslo</Label>
              <Input
                id="delete-password"
                type="password"
                placeholder="Wpisz swoje haslo..."
                value={deletePassword}
                onChange={(e) => {
                  setDeletePassword(e.target.value);
                  if (deleteError) setDeleteError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !deleting) {
                    e.preventDefault();
                    handleDeleteClient();
                  }
                }}
                data-testid="delete-password-input"
                autoFocus
              />
              {deleteError && (
                <p
                  className="text-sm text-destructive"
                  data-testid="delete-error-message"
                >
                  {deleteError}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
              data-testid="cancel-delete-btn"
            >
              Anuluj
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteClient}
              disabled={deleting}
              data-testid="confirm-delete-btn"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {deleting ? "Usuwanie..." : "Usun klienta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
