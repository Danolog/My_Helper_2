"use client";

import { useState, useEffect } from "react";
import {
  Loader2,
  Send,
  Users,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mutationFetch } from "@/lib/api-client";
import type { SavedNewsletter, RecipientsData } from "../_types";

type SendNewsletterDialogProps = {
  newsletter: SavedNewsletter | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
};

export function SendNewsletterDialog({
  newsletter,
  open,
  onOpenChange,
  onSent,
}: SendNewsletterDialogProps) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [recipientsData, setRecipientsData] = useState<RecipientsData | null>(
    null
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendResult, setSendResult] = useState<{
    sentCount: number;
    failedCount: number;
  } | null>(null);

  // Fetch recipients when dialog opens
  useEffect(() => {
    if (open && newsletter) {
      setLoading(true);
      setSendResult(null);
      setSelectedIds(new Set());
      fetch(`/api/newsletters/${newsletter.id}/recipients`)
        .then((res) => res.json())
        .then((data: RecipientsData) => {
          setRecipientsData(data);
          // Select all by default
          setSelectedIds(new Set(data.recipients.map((r) => r.clientId)));
        })
        .catch(() => {
          toast.error("Blad podczas pobierania odbiorcow");
        })
        .finally(() => setLoading(false));
    }
  }, [open, newsletter]);

  const toggleRecipient = (clientId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (!recipientsData) return;
    if (selectedIds.size === recipientsData.recipients.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(
        new Set(recipientsData.recipients.map((r) => r.clientId))
      );
    }
  };

  const handleSend = async () => {
    if (!newsletter || selectedIds.size === 0) return;
    setSending(true);
    try {
      const response = await mutationFetch(`/api/newsletters/${newsletter.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientIds: Array.from(selectedIds),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Blad podczas wysylania");
        return;
      }

      setSendResult({
        sentCount: data.sentCount,
        failedCount: data.failedCount,
      });
      toast.success(
        `Newsletter wyslany do ${data.sentCount} odbiorcow!`
      );
      onSent();
    } catch {
      toast.error("Blad podczas wysylania newslettera");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Wyslij newsletter
          </DialogTitle>
          <DialogDescription>
            {newsletter?.subject
              ? `"${newsletter.subject}"`
              : "Wybierz odbiorcow i wyslij newsletter"}
          </DialogDescription>
        </DialogHeader>

        {/* Send result view */}
        {sendResult ? (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <h3 className="text-lg font-semibold">Newsletter wyslany!</h3>
              <p className="text-sm text-muted-foreground">
                Wyslano do {sendResult.sentCount} odbiorcow
                {sendResult.failedCount > 0 &&
                  ` (${sendResult.failedCount} bledow)`}
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Zamknij</Button>
            </DialogFooter>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : recipientsData && recipientsData.recipients.length > 0 ? (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>
                {recipientsData.consentedCount} klientow ze zgoda email (z{" "}
                {recipientsData.totalClientsWithEmail} z adresem email)
              </span>
            </div>

            {recipientsData.alreadySent && (
              <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm">
                <AlertCircle className="h-4 w-4 text-yellow-600 flex-shrink-0" />
                <span>
                  Ten newsletter byl juz wczesniej wyslany. Mozesz wyslac go
                  ponownie.
                </span>
              </div>
            )}

            {/* Select all */}
            <div className="flex items-center gap-2 pb-2 border-b">
              <Checkbox
                id="select-all"
                checked={
                  selectedIds.size === recipientsData.recipients.length
                }
                onCheckedChange={toggleAll}
              />
              <label
                htmlFor="select-all"
                className="text-sm font-medium cursor-pointer"
              >
                Zaznacz wszystkich ({recipientsData.recipients.length})
              </label>
            </div>

            {/* Recipients list */}
            <div className="max-h-[300px] overflow-y-auto space-y-1">
              {recipientsData.recipients.map((r) => (
                <div
                  key={r.clientId}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <Checkbox
                    id={`recipient-${r.clientId}`}
                    checked={selectedIds.has(r.clientId)}
                    onCheckedChange={() => toggleRecipient(r.clientId)}
                  />
                  <label
                    htmlFor={`recipient-${r.clientId}`}
                    className="flex-1 cursor-pointer"
                  >
                    <div className="text-sm font-medium">
                      {r.firstName} {r.lastName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.email}
                    </div>
                  </label>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Anuluj
              </Button>
              <Button
                onClick={handleSend}
                disabled={sending || selectedIds.size === 0}
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Wysylanie...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Wyslij do {selectedIds.size} odbiorcow
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
              <Users className="h-12 w-12 opacity-20" />
              <p className="text-sm">
                Brak klientow z aktywna zgoda na email.
              </p>
              <p className="text-xs">
                Dodaj zgody marketingowe (email) w profilu klienta, aby moc
                wysylac newslettery.
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Zamknij
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
