"use client";

import { useState } from "react";
import { Building2, Crown, Loader2, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mutationFetch } from "@/lib/api-client";
import { PLANS, TRIAL_DAYS } from "@/lib/constants";

interface CreateSalonPromptProps {
  session: { user: { name?: string | null; email: string } };
  onCreated: () => void;
}

export function CreateSalonPrompt({ session, onCreated }: CreateSalonPromptProps) {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  const plans = [
    {
      slug: PLANS.basic.slug,
      name: PLANS.basic.name,
      price: PLANS.basic.priceLabel,
      features: [
        "Zarzadzanie wizytami",
        "Kalendarz pracownikow",
        "Baza klientow",
        "Raporty podstawowe",
      ],
    },
    {
      slug: PLANS.pro.slug,
      name: PLANS.pro.name,
      price: PLANS.pro.priceLabel,
      features: [
        "Wszystko z Basic",
        "Asystent AI",
        "Zaawansowane raporty",
        "Marketing i newsletter",
      ],
    },
  ];

  const handleCreate = async () => {
    if (!selectedPlan) return;
    setIsCreating(true);
    setError("");

    try {
      const res = await mutationFetch("/api/register-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planSlug: selectedPlan,
          email: session.user.email,
        }),
      });

      const data = await res.json();
      if (data.success) {
        onCreated();
      } else {
        setError(data.error || "Nie udalo sie utworzyc salonu");
      }
    } catch {
      setError("Wystapil blad polaczenia");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
      </div>
      <div className="max-w-2xl mx-auto space-y-6">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Building2 className="h-8 w-8 text-muted-foreground" />
            </div>
            <CardTitle>Utworz swoj salon</CardTitle>
            <p className="text-muted-foreground text-sm">
              Wybierz plan i rozpocznij {TRIAL_DAYS}-dniowy okres probny
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {plans.map((plan) => (
                <button
                  key={plan.slug}
                  type="button"
                  onClick={() => setSelectedPlan(plan.slug)}
                  className={`text-left p-4 rounded-lg border-2 transition-colors ${
                    selectedPlan === plan.slug
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold">{plan.name}</span>
                    {plan.slug === "pro" && (
                      <Badge variant="secondary">
                        <Crown className="h-3 w-3 mr-1" />
                        AI
                      </Badge>
                    )}
                  </div>
                  <p className="text-lg font-bold mb-3">{plan.price}</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-center gap-2">
                        <Zap className="h-3 w-3 text-primary shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </button>
              ))}
            </div>
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <Button
              className="w-full"
              disabled={!selectedPlan || isCreating}
              onClick={handleCreate}
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Tworzenie salonu...
                </>
              ) : (
                <>
                  <Building2 className="h-4 w-4 mr-2" />
                  Utworz salon z {TRIAL_DAYS}-dniowym trialem
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
