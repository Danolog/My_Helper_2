"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Facebook, Instagram, Link2, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { RoleGate } from "@/components/dashboard/role-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mutationFetch } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import {
  SALON_SLUG_MAX_CHANGES,
  SALON_SLUG_MAX_LENGTH,
  salonShortUrl,
  salonSlugProblem,
  salonSlugProblemMessage,
} from "@/lib/salon-slug";
import { BookingLinkQr } from "./_components/BookingLinkQr";

interface SalonLinkData {
  id: string;
  slug: string | null;
}

/** Jak długo przycisk pokazuje „Skopiowano” po kliknięciu. */
const COPIED_FEEDBACK_MS = 2000;

/**
 * Instrukcje dla właściciela. Nazwy przycisków w aplikacjach Meta zmieniają się
 * między wersjami, więc kroki opisują drogę, a nie dokładny napis.
 */
const SOCIAL_GUIDES = [
  {
    key: "instagram",
    title: "Dodaj przycisk Zarezerwuj na Instagramie",
    icon: Instagram,
    steps: [
      "Otwórz swój profil na Instagramie i stuknij „Edytuj profil”.",
      "Wybierz „Linki”, potem „Dodaj link zewnętrzny”.",
      "Wklej swój link, w tytule wpisz „Zarezerwuj wizytę” i zapisz.",
    ],
  },
  {
    key: "facebook",
    title: "Dodaj przycisk Zarezerwuj na Facebooku",
    icon: Facebook,
    steps: [
      "Wejdź na stronę swojego salonu na Facebooku i stuknij „Dodaj przycisk” (albo „Edytuj przycisk”).",
      "Wybierz „Zarezerwuj teraz”, a jako sposób rezerwacji wybierz link do strony.",
      "Wklej swój link i zapisz.",
    ],
  },
] as const;

export default function BookingLinkSettingsPage() {
  return (
    <RoleGate allow={["owner"]}>
      <BookingLinkSettingsInner />
    </RoleGate>
  );
}

function BookingLinkSettingsInner() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [salon, setSalon] = useState<SalonLinkData | null>(null);
  const [slugInput, setSlugInput] = useState("");
  const [slugError, setSlugError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    // window jest dostępne dopiero w przeglądarce — adres składamy po montowaniu.
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    const controller = new AbortController();

    async function fetchSalon() {
      try {
        const res = await fetch("/api/salons/mine", { signal: controller.signal });
        const data = await res.json();
        if (data.success && data.salon) {
          setSalon({ id: data.salon.id, slug: data.salon.slug ?? null });
          setSlugInput(data.salon.slug ?? "");
        }
      } catch {
        // Przerwanie przy odmontowaniu to nie błąd dla właściciela.
        if (controller.signal.aborted) return;
        toast.error("Nie można załadować danych salonu");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    fetchSalon();
    return () => controller.abort();
  }, [session]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const shortUrl = salon?.slug && origin ? salonShortUrl(origin, salon.slug) : null;
  const normalizedInput = slugInput.trim().toLowerCase();
  const unchanged = normalizedInput === (salon?.slug ?? "");

  const handleCopy = async () => {
    if (!shortUrl) return;
    try {
      await navigator.clipboard.writeText(shortUrl);
      setCopied(true);
      toast.success("Link skopiowany");
    } catch {
      // Brak uprawnień do schowka (np. stara przeglądarka) — link nadal widać w polu.
      toast.error("Nie udało się skopiować. Zaznacz link i skopiuj go ręcznie.");
    }
  };

  const handleSave = async () => {
    if (!salon) return;
    const problem = salonSlugProblem(normalizedInput);
    if (problem) {
      setSlugError(salonSlugProblemMessage(problem));
      return;
    }

    setSaving(true);
    setSlugError(null);
    try {
      const res = await mutationFetch(`/api/salons/${salon.id}/slug`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: normalizedInput }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSalon({ ...salon, slug: data.data.slug });
        setSlugInput(data.data.slug);
        toast.success("Adres zapisany");
        return;
      }
      // 409 (adres zajęty albo limit zmian) i 400 (walidacja) pokazujemy przy polu, resztę jako toast.
      const fieldMessage = data.details?.slug ?? (res.status === 409 ? data.error : null);
      if (fieldMessage) {
        setSlugError(fieldMessage);
      } else {
        toast.error(data.error || "Nie udało się zapisać adresu");
      }
    } catch {
      toast.error("Nie udało się zapisać adresu");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex justify-center items-center py-12">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
          <span className="text-muted-foreground">Ładowanie...</span>
        </div>
      </div>
    );
  }

  if (!salon) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <Link2 className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground">Nie znaleziono salonu</p>
          <Button variant="outline" size="sm" className="mt-4" asChild>
            <Link href="/dashboard/settings">Powrót do ustawień</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/settings">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Ustawienia
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Link do rezerwacji</h1>
          <p className="text-muted-foreground">
            Wyślij ten link klientom albo dodaj go na Instagramie i Facebooku
          </p>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Link2 className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">Twój link</CardTitle>
              <CardDescription>
                Klient otwiera link, widzi Twój salon i rezerwuje wizytę — bez zakładania konta.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {shortUrl && salon.slug ? (
            <>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={shortUrl}
                  aria-label="Link do rezerwacji"
                  data-testid="booking-link-url"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" variant="outline" onClick={handleCopy} data-testid="booking-link-copy">
                  {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                  {copied ? "Skopiowano" : "Kopiuj"}
                </Button>
              </div>
              <BookingLinkQr url={shortUrl} slug={salon.slug} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Salon nie ma jeszcze adresu. Wpisz go poniżej i zapisz.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="salon-slug">Końcówka adresu</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">{origin}/s/</span>
              <Input
                id="salon-slug"
                value={slugInput}
                onChange={(e) => {
                  setSlugInput(e.target.value);
                  setSlugError(null);
                }}
                placeholder="np. salon-anna"
                maxLength={SALON_SLUG_MAX_LENGTH}
                aria-invalid={slugError ? true : undefined}
                aria-describedby="salon-slug-help"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            {slugError ? (
              <p className="text-sm text-destructive" role="alert" data-testid="booking-link-error">
                {slugError}
              </p>
            ) : null}
            <p id="salon-slug-help" className="text-sm text-muted-foreground">
              Małe litery bez polskich znaków, cyfry i myślniki, od 3 do 50 znaków.
              Po zmianie stary link będzie dalej prowadzić do Twojego salonu.
              Adres możesz zmienić najwyżej {SALON_SLUG_MAX_CHANGES} razy.
            </p>
          </div>

          <Button onClick={handleSave} disabled={saving || unchanged || !normalizedInput}>
            {saving ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Zapisywanie...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Zapisz adres
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {shortUrl
        ? SOCIAL_GUIDES.map((guide) => {
            const Icon = guide.icon;
            return (
              <Card key={guide.key} className="mb-6" data-testid={`booking-link-guide-${guide.key}`}>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Icon className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">{guide.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm">
                    Link do wklejenia: <span className="font-mono break-all">{shortUrl}</span>
                  </p>
                  <ol className="list-decimal pl-5 space-y-1 text-sm">
                    {guide.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            );
          })
        : null}
    </div>
  );
}
