"use client";

import Link from "next/link";
import {
  Check,
  Crown,
  Zap,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormRecoveryBanner } from "@/components/form-recovery-banner";
import type { Plan } from "../_hooks/use-registration";

interface StepAccountDetailsProps {
  selectedPlan: string | null;
  selectedPlanData: Plan | undefined;
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  error: string;
  fieldErrors: Record<string, string>;
  isPending: boolean;
  wasRecovered: boolean;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onClearFieldError: (field: string) => void;
  onBack: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onRestore: () => void;
  onDismissRecovery: () => void;
}

export function StepAccountDetails({
  selectedPlan,
  selectedPlanData,
  name,
  email,
  password,
  confirmPassword,
  error,
  fieldErrors,
  isPending,
  wasRecovered,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onClearFieldError,
  onBack,
  onSubmit,
  onRestore,
  onDismissRecovery,
}: StepAccountDetailsProps) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground font-semibold text-sm">
              <Check className="h-4 w-4" />
            </div>
            <span className="text-sm text-muted-foreground">Plan</span>
          </div>
          <div className="w-8 h-px bg-primary" />
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground font-semibold text-sm">
              2
            </div>
            <span className="text-sm font-medium">Dane konta</span>
          </div>
        </div>

        {/* Selected plan summary */}
        {selectedPlanData && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center gap-2 mx-auto mb-2 px-3 py-1.5 rounded-full border bg-muted/50 hover:bg-muted transition-colors"
          >
            {selectedPlan === "pro" ? (
              <Crown className="h-4 w-4 text-primary" />
            ) : (
              <Zap className="h-4 w-4 text-blue-600" />
            )}
            <span className="text-sm font-medium">
              Plan {selectedPlanData.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {parseFloat(selectedPlanData.priceMonthly).toFixed(0)} PLN/mies.
            </span>
          </button>
        )}

        <CardTitle>Utwórz konto</CardTitle>
        <CardDescription>Wypelnij dane, aby rozpoczac</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        {wasRecovered && (
          <div className="w-full max-w-sm">
            <FormRecoveryBanner
              onRestore={onRestore}
              onDismiss={onDismissRecovery}
            />
          </div>
        )}
        <form onSubmit={onSubmit} noValidate className="space-y-4 w-full max-w-sm">
          <div className="space-y-2">
            <Label htmlFor="name">Imie i nazwisko</Label>
            <Input
              id="name"
              type="text"
              placeholder="Jan Kowalski"
              value={name}
              onChange={(e) => {
                onNameChange(e.target.value);
                onClearFieldError("name");
              }}
              required
              aria-invalid={!!fieldErrors.name}
              disabled={isPending}
            />
            {fieldErrors.name && (
              <p className="text-sm text-destructive">{fieldErrors.name}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="jan@example.com"
              value={email}
              onChange={(e) => {
                onEmailChange(e.target.value);
                onClearFieldError("email");
              }}
              required
              aria-invalid={!!fieldErrors.email}
              disabled={isPending}
            />
            {fieldErrors.email && (
              <p className="text-sm text-destructive">{fieldErrors.email}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Haslo</Label>
            <Input
              id="password"
              type="password"
              placeholder="Minimum 8 znakow"
              value={password}
              onChange={(e) => {
                onPasswordChange(e.target.value);
                onClearFieldError("password");
              }}
              required
              aria-invalid={!!fieldErrors.password}
              disabled={isPending}
            />
            {fieldErrors.password && (
              <p className="text-sm text-destructive">{fieldErrors.password}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Powtorz haslo</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="Powtorz haslo"
              value={confirmPassword}
              onChange={(e) => {
                onConfirmPasswordChange(e.target.value);
                onClearFieldError("confirmPassword");
              }}
              required
              aria-invalid={!!fieldErrors.confirmPassword}
              disabled={isPending}
            />
            {fieldErrors.confirmPassword && (
              <p className="text-sm text-destructive">{fieldErrors.confirmPassword}</p>
            )}
          </div>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              disabled={isPending}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Wstecz
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Tworzenie konta...
                </>
              ) : (
                "Utwórz konto"
              )}
            </Button>
          </div>
          <div className="text-center text-sm text-muted-foreground">
            Masz juz konto?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Zaloguj sie
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
