"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, XCircle, ArrowRight } from "lucide-react";
import { mutationFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ConfirmResult = {
  planName: string;
  planSlug: string;
} | null;

/**
 * Inner component that reads searchParams (must be wrapped in Suspense).
 */
function SuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");

  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [result, setResult] = useState<ConfirmResult>(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function confirmSubscription() {
      // If no session_id, we likely came from the dev fallback --
      // the subscription was already created during checkout.
      if (!sessionId) {
        setResult({ planName: "Subskrypcja", planSlug: "unknown" });
        setStatus("success");
        return;
      }

      try {
        const res = await mutationFetch("/api/subscriptions/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          setErrorMessage(
            data.error || "Nie udalo sie potwierdzic subskrypcji",
          );
          setStatus("error");
          return;
        }

        setResult({
          planName: data.plan?.name || "Subskrypcja",
          planSlug: data.plan?.slug || "unknown",
        });
        setStatus("success");
      } catch {
        setErrorMessage("Wystapil blad podczas potwierdzania subskrypcji");
        setStatus("error");
      }
    }

    confirmSubscription();
  }, [sessionId]);

  if (status === "loading") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Potwierdzanie platnosci...</CardTitle>
          <CardDescription>
            Weryfikujemy Twoja platnosc, to moze chwile potrwac.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center py-8">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Blad potwierdzenia</CardTitle>
          <CardDescription>{errorMessage}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center space-y-4">
          <XCircle className="h-12 w-12 text-destructive" />
          <p className="text-sm text-muted-foreground text-center">
            Jesli platnosc zostala pobrana, subskrypcja zostanie aktywowana
            automatycznie. Sprobuj odswiezyc strone lub skontaktuj sie z
            obsluga.
          </p>
          <div className="flex gap-2 w-full">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => window.location.reload()}
            >
              Odswiez
            </Button>
            <Button asChild className="flex-1">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle>Subskrypcja aktywowana!</CardTitle>
        <CardDescription>
          Dziekujemy za wybor planu{" "}
          <span className="font-semibold">{result?.planName}</span>. Twoja
          subskrypcja jest juz aktywna.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center space-y-6">
        <CheckCircle2 className="h-16 w-16 text-green-500" />
        <p className="text-sm text-muted-foreground text-center">
          Mozesz teraz korzystac ze wszystkich funkcji swojego planu. Informacje
          o subskrypcji znajdziesz w panelu zarzadzania.
        </p>
        <div className="flex flex-col gap-2 w-full">
          <Button asChild className="w-full">
            <Link href="/dashboard/subscription">
              Zarzadzaj subskrypcja
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href="/dashboard">Przejdz do dashboardu</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Success page displayed after Stripe Checkout redirect.
 * Confirms the subscription via the /api/subscriptions/confirm endpoint
 * and shows a success or error message.
 */
export default function SubscriptionSuccessPage() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Suspense
        fallback={
          <Card className="w-full max-w-md">
            <CardContent className="flex flex-col items-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        }
      >
        <SuccessContent />
      </Suspense>
    </div>
  );
}
