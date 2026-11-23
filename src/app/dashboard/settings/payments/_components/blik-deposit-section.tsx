"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Smartphone } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { mutationFetch } from "@/lib/api-client";
import {
  BLIK_CONSENT_LABEL,
  BLIK_CONSENT_SENTENCES,
  BLIK_CONSENT_VERSION,
  BLIK_CONSENT_VERSION_STALE,
  BLIK_PRIVACY_POLICY_HREF,
  BLIK_SETTINGS_NOT_AVAILABLE,
} from "@/lib/blik-consent";

/**
 * Sekcja „Zadatki BLIK” w ustawieniach płatności (tylko właściciel).
 *
 * Numer BLIK to dane osobowe właściciela: komponent nie loguje, nie zapisuje
 * niczego w pamięci przeglądarki, a pola formularza nie mają atrybutu `name`,
 * więc numer nie trafi do adresu strony nawet przy wysłaniu formularza przed
 * uruchomieniem skryptów. Toasty nie zawierają numeru.
 *
 * Reguły poprawności numeru sprawdza wyłącznie serwer — UI pokazuje jego
 * komunikaty z `details` przy polach.
 */

const API_URL = "/api/salon/blik-deposit";

export interface BlikDepositSettings {
  blikPhone: string | null;
  blikConsentAt: string | null;
  blikConsentVersion: string | null;
  consentCurrent: boolean;
}

type LoadState = "loading" | "error" | "not-found" | "ready";

interface FieldErrors {
  blikPhone?: string;
  consent?: string;
  consentVersion?: string;
}

const SAVE_ERROR = "Nie udało się zapisać numeru BLIK. Spróbuj ponownie.";
const DELETE_ERROR = "Nie udało się usunąć numeru BLIK. Spróbuj ponownie.";

function formatConsentDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("pl-PL", { dateStyle: "long", timeStyle: "short" });
}

function isSettings(value: unknown): value is BlikDepositSettings {
  return (
    !!value &&
    typeof value === "object" &&
    "blikPhone" in value &&
    "consentCurrent" in value
  );
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await res.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function BlikDepositSection() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [settings, setSettings] = useState<BlikDepositSettings | null>(null);
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [stale, setStale] = useState(false);
  const [closedByServer, setClosedByServer] = useState(false);

  /** Stan po odpowiedzi serwera: zgoda zawsze wraca do odznaczonej. */
  const applySettings = useCallback((data: BlikDepositSettings) => {
    setSettings(data);
    setPhone(data.blikPhone ?? "");
    setConsent(false);
    setFieldErrors({});
    setEditing(false);
  }, []);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const res = await fetch(API_URL);
      if (res.status === 404) {
        setLoadState("not-found");
        return;
      }
      const body = await readJson(res);
      if (!res.ok || !body || body.success !== true || !isSettings(body.data)) {
        setLoadState("error");
        return;
      }
      applySettings(body.data);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [applySettings]);

  useEffect(() => {
    load();
  }, [load]);

  /** Wspólna obsługa odpowiedzi PUT (zapis i usunięcie). Zwraca true przy 200. */
  const handlePutResponse = async (res: Response, fallbackError: string) => {
    const body = await readJson(res);

    if (res.ok && body?.success === true && isSettings(body.data)) {
      applySettings(body.data);
      return true;
    }

    if (res.status === 409) {
      if (body?.code === BLIK_CONSENT_VERSION_STALE) {
        setStale(true);
        setConsent(false);
        return false;
      }
      if (body?.code === BLIK_SETTINGS_NOT_AVAILABLE) {
        setClosedByServer(true);
        setConsent(false);
        setEditing(false);
        return false;
      }
    }

    if (res.status === 400) {
      const details =
        body?.details && typeof body.details === "object"
          ? (body.details as Record<string, unknown>)
          : {};
      const errors: FieldErrors = {};
      for (const key of ["blikPhone", "consent", "consentVersion"] as const) {
        if (typeof details[key] === "string") errors[key] = details[key] as string;
      }
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        return false;
      }
    }

    if (res.status === 401) {
      toast.error("Sesja wygasła. Zaloguj się ponownie.");
    } else if (res.status === 403) {
      toast.error("Brak uprawnień do zmiany numeru BLIK.");
    } else if (res.status === 404) {
      toast.error("Nie znaleziono salonu.");
    } else {
      toast.error(fallbackError);
    }
    return false;
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!consent || phone.trim() === "" || saving) return;
    setSaving(true);
    setFieldErrors({});
    try {
      const res = await mutationFetch(API_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blikPhone: phone,
          consent: true,
          consentVersion: BLIK_CONSENT_VERSION,
        }),
      });
      if (await handlePutResponse(res, SAVE_ERROR)) {
        toast.success("Numer BLIK zapisany.");
      }
    } catch {
      toast.error(SAVE_ERROR);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await mutationFetch(API_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blikPhone: null }),
      });
      if (await handlePutResponse(res, DELETE_ERROR)) {
        toast.success("Numer BLIK usunięty.");
      }
    } catch {
      toast.error(DELETE_ERROR);
    } finally {
      setDeleting(false);
    }
  };

  const startEditing = () => {
    setPhone(settings?.blikPhone ?? "");
    setConsent(false);
    setFieldErrors({});
    setEditing(true);
  };

  const cancelEditing = () => {
    setPhone(settings?.blikPhone ?? "");
    setConsent(false);
    setFieldErrors({});
    setEditing(false);
  };

  return (
    <Card className="mb-6" data-testid="blik-deposit-section">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Smartphone className="h-6 w-6 text-primary" aria-hidden="true" />
          <div>
            <CardTitle className="text-xl">Zadatki BLIK</CardTitle>
            <CardDescription>
              Numer telefonu, na który klienci wpłacają zadatek przelewem BLIK
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>{renderBody()}</CardContent>
    </Card>
  );

  function renderBody() {
    if (loadState === "loading") {
      return <p className="py-6 text-center text-muted-foreground">Ładowanie ustawień…</p>;
    }

    if (loadState === "not-found") {
      return <p className="py-6 text-center text-muted-foreground">Nie znaleziono salonu.</p>;
    }

    if (loadState === "error" || !settings) {
      return (
        <div className="py-6 text-center">
          <p className="mb-4 text-muted-foreground">
            Nie udało się załadować ustawień zadatku BLIK.
          </p>
          <Button onClick={load}>Spróbuj ponownie</Button>
        </div>
      );
    }

    const hasPhone = settings.blikPhone !== null;
    const saveClosed = BLIK_PRIVACY_POLICY_HREF === null || closedByServer;
    const consentDate = formatConsentDate(settings.blikConsentAt);

    return (
      <div className="space-y-6">
        {stale && (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <span>Treść potwierdzenia została zaktualizowana. Odśwież stronę.</span>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              Odśwież stronę
            </Button>
          </div>
        )}

        {hasPhone && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div>
              <p className="text-sm text-muted-foreground">Zapisany numer</p>
              <p className="text-lg font-semibold" data-testid="blik-saved-phone">
                {settings.blikPhone}
              </p>
              {consentDate && settings.consentCurrent && (
                <p className="text-sm text-muted-foreground">Potwierdzono: {consentDate}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {!saveClosed && settings.consentCurrent && !editing && (
                <Button variant="outline" onClick={startEditing}>
                  Zmień numer
                </Button>
              )}
              {renderDeleteButton()}
            </div>
          </div>
        )}

        {saveClosed ? renderClosedNotice() : renderFormIfNeeded(hasPhone)}
      </div>
    );
  }

  function renderDeleteButton() {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" disabled={deleting}>
            Usuń numer
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć numer BLIK?</AlertDialogTitle>
            <AlertDialogDescription>
              Numer nie trafi do nowych rezerwacji z zadatkiem BLIK.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Usuń numer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  function renderConsentText() {
    return (
      <div className="space-y-2 text-sm" data-testid="blik-consent-sentences">
        {BLIK_CONSENT_SENTENCES.map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
        {BLIK_PRIVACY_POLICY_HREF !== null && (
          <p>
            <a href={BLIK_PRIVACY_POLICY_HREF} className="text-primary underline">
              Polityka prywatności
            </a>
          </p>
        )}
      </div>
    );
  }

  function renderClosedNotice() {
    return (
      <div className="space-y-4">
        <div
          className="rounded-lg border border-border bg-muted/50 p-4 text-sm"
          data-testid="blik-save-closed"
        >
          Numer BLIK będzie można zapisać po opublikowaniu polityki prywatności. Do tego
          czasu zadatków BLIK nie da się włączyć w tym miejscu.
        </div>
        {renderConsentText()}
      </div>
    );
  }

  function renderFormIfNeeded(hasPhone: boolean) {
    const needsNewConsent = hasPhone && !settings?.consentCurrent;
    if (hasPhone && !needsNewConsent && !editing) return null;

    const saveDisabled = saving || !consent || phone.trim() === "";

    return (
      <form onSubmit={handleSave} noValidate className="space-y-4">
        {needsNewConsent && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Treść potwierdzenia się zmieniła. Przeczytaj ją i zaznacz pole ponownie.</span>
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="blik-phone" className="text-sm font-medium">
            Numer telefonu BLIK
          </label>
          <Input
            id="blik-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            aria-invalid={fieldErrors.blikPhone ? true : undefined}
            aria-describedby={fieldErrors.blikPhone ? "blik-phone-error" : undefined}
          />
          {fieldErrors.blikPhone && (
            <p id="blik-phone-error" className="text-sm text-destructive">
              {fieldErrors.blikPhone}
            </p>
          )}
        </div>

        {renderConsentText()}

        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <Checkbox
              id="blik-consent"
              checked={consent}
              onCheckedChange={setConsent}
              className="mt-0.5"
              aria-invalid={fieldErrors.consent ? true : undefined}
              aria-describedby={fieldErrors.consent ? "blik-consent-error" : undefined}
            />
            <label htmlFor="blik-consent" className="text-sm">
              {BLIK_CONSENT_LABEL}
            </label>
          </div>
          {fieldErrors.consent && (
            <p id="blik-consent-error" className="text-sm text-destructive">
              {fieldErrors.consent}
            </p>
          )}
          {fieldErrors.consentVersion && (
            <p className="text-sm text-destructive">{fieldErrors.consentVersion}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saveDisabled}>
            {saving ? "Zapisywanie…" : "Zapisz numer"}
          </Button>
          {editing && (
            <Button type="button" variant="ghost" onClick={cancelEditing}>
              Anuluj
            </Button>
          )}
        </div>
      </form>
    );
  }
}
