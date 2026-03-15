"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Shield,
  Mail,
  MessageSquare,
  Phone,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { ConsentStatus } from "./types";

interface ClientConsentsCardProps {
  clientId: string;
}

/**
 * Card for managing GDPR marketing consent settings (email, SMS, phone).
 * Fetches and updates consent status independently from the parent component.
 */
export function ClientConsentsCard({ clientId }: ClientConsentsCardProps) {
  const [consents, setConsents] = useState<ConsentStatus[]>([]);
  const [loadingConsents, setLoadingConsents] = useState(false);
  const [savingConsents, setSavingConsents] = useState(false);

  const fetchConsents = useCallback(async (signal: AbortSignal | null = null) => {
    setLoadingConsents(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/consents`, { signal });
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      setConsents(data.consents as ConsentStatus[]);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    } finally {
      setLoadingConsents(false);
    }
  }, [clientId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchConsents(controller.signal);
    return () => controller.abort();
  }, [fetchConsents]);

  const handleConsentToggle = async (consentType: "email" | "sms" | "phone", newValue: boolean) => {
    setSavingConsents(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/consents`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consents: { [consentType]: newValue },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setConsents(data.consents as ConsentStatus[]);
        const label = consentType === "email" ? "e-mail" : consentType === "sms" ? "SMS" : "telefon";
        toast.success(
          newValue
            ? `Zgoda na marketing ${label} udzielona`
            : `Zgoda na marketing ${label} wycofana`
        );
      } else {
        toast.error(data.error || "Blad podczas aktualizacji zgody");
      }
    } catch {
      toast.error("Blad podczas aktualizacji zgody marketingowej");
    } finally {
      setSavingConsents(false);
    }
  };

  return (
    <Card className="mb-6" data-testid="consent-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Zgody marketingowe</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground">
          Zarzadzaj zgodami klienta na komunikacje marketingowa (RODO)
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadingConsents ? (
          <div className="flex items-center justify-center py-6" data-testid="consents-loading">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Ladowanie zgod...</span>
          </div>
        ) : (
          <>
            {/* Email consent */}
            <div className="flex items-center justify-between p-3 rounded-lg border" data-testid="consent-email">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/40">
                  <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="font-medium text-sm">Marketing e-mail</p>
                  <p className="text-xs text-muted-foreground">
                    Newslettery, promocje i oferty specjalne
                  </p>
                  {consents.find(c => c.type === "email")?.grantedAt && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Zgoda od: {new Date(consents.find(c => c.type === "email")!.grantedAt!).toLocaleDateString("pl-PL")}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={consents.find(c => c.type === "email")?.granted ? "default" : "secondary"}
                  className="text-xs"
                  data-testid="consent-email-badge"
                >
                  {consents.find(c => c.type === "email")?.granted ? "Aktywna" : "Brak"}
                </Badge>
                <Switch
                  checked={consents.find(c => c.type === "email")?.granted ?? false}
                  onCheckedChange={(checked) => handleConsentToggle("email", checked)}
                  disabled={savingConsents}
                  data-testid="consent-email-switch"
                />
              </div>
            </div>

            {/* SMS consent */}
            <div className="flex items-center justify-between p-3 rounded-lg border" data-testid="consent-sms">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-green-100 dark:bg-green-900/40">
                  <MessageSquare className="h-4 w-4 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="font-medium text-sm">Marketing SMS</p>
                  <p className="text-xs text-muted-foreground">
                    Powiadomienia SMS o promocjach i nowosciach
                  </p>
                  {consents.find(c => c.type === "sms")?.grantedAt && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Zgoda od: {new Date(consents.find(c => c.type === "sms")!.grantedAt!).toLocaleDateString("pl-PL")}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={consents.find(c => c.type === "sms")?.granted ? "default" : "secondary"}
                  className="text-xs"
                  data-testid="consent-sms-badge"
                >
                  {consents.find(c => c.type === "sms")?.granted ? "Aktywna" : "Brak"}
                </Badge>
                <Switch
                  checked={consents.find(c => c.type === "sms")?.granted ?? false}
                  onCheckedChange={(checked) => handleConsentToggle("sms", checked)}
                  disabled={savingConsents}
                  data-testid="consent-sms-switch"
                />
              </div>
            </div>

            {/* Phone consent */}
            <div className="flex items-center justify-between p-3 rounded-lg border" data-testid="consent-phone">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-purple-100 dark:bg-purple-900/40">
                  <Phone className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p className="font-medium text-sm">Marketing telefoniczny</p>
                  <p className="text-xs text-muted-foreground">
                    Kontakt telefoniczny w celach marketingowych
                  </p>
                  {consents.find(c => c.type === "phone")?.grantedAt && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Zgoda od: {new Date(consents.find(c => c.type === "phone")!.grantedAt!).toLocaleDateString("pl-PL")}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={consents.find(c => c.type === "phone")?.granted ? "default" : "secondary"}
                  className="text-xs"
                  data-testid="consent-phone-badge"
                >
                  {consents.find(c => c.type === "phone")?.granted ? "Aktywna" : "Brak"}
                </Badge>
                <Switch
                  checked={consents.find(c => c.type === "phone")?.granted ?? false}
                  onCheckedChange={(checked) => handleConsentToggle("phone", checked)}
                  disabled={savingConsents}
                  data-testid="consent-phone-switch"
                />
              </div>
            </div>

            {/* GDPR Info */}
            <div className="mt-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground" data-testid="consent-gdpr-info">
              <p className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5" />
                <strong>RODO:</strong> Zgody sa wymagane przed wyslaniem jakiejkolwiek komunikacji marketingowej.
                Klient moze w kazdej chwili wycofac swoja zgode.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
