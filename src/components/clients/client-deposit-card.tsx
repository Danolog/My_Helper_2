"use client";

import { Banknote } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

interface ClientDepositCardProps {
  formRequireDeposit: boolean;
  formDepositType: string;
  formDepositValue: string;
  onRequireDepositChange: (value: boolean) => void;
  onDepositTypeChange: (value: string) => void;
  onDepositValueChange: (value: string) => void;
}

/**
 * Card for configuring client-specific deposit requirements.
 * Allows toggling deposit requirement, choosing deposit type (percentage/fixed),
 * and setting the deposit value.
 */
export function ClientDepositCard({
  formRequireDeposit,
  formDepositType,
  formDepositValue,
  onRequireDepositChange,
  onDepositTypeChange,
  onDepositValueChange,
}: ClientDepositCardProps) {
  return (
    <Card className="mb-6" data-testid="deposit-settings-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Banknote className="h-5 w-5 text-green-600" />
          <CardTitle className="text-lg">Ustawienia zadatku</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Wymagaj zadatku</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Wlacz, aby ten klient musial placic zadatek przy rezerwacji
            </p>
          </div>
          <Select
            value={formRequireDeposit ? "yes" : "no"}
            onValueChange={(value) => onRequireDepositChange(value === "yes")}
          >
            <SelectTrigger className="w-[120px]" data-testid="require-deposit-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="no">Nie</SelectItem>
              <SelectItem value="yes">Tak</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {formRequireDeposit && (
          <>
            <Separator />
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium mb-1.5 block">Typ zadatku</Label>
                <Select
                  value={formDepositType}
                  onValueChange={onDepositTypeChange}
                >
                  <SelectTrigger className="w-full max-w-xs" data-testid="deposit-type-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Procent ceny uslugi (%)</SelectItem>
                    <SelectItem value="fixed">Stala kwota (PLN)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="deposit-value" className="text-sm font-medium mb-1.5 block">
                  {formDepositType === "percentage" ? "Procent zadatku" : "Kwota zadatku (PLN)"}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="deposit-value"
                    type="number"
                    min="0"
                    max={formDepositType === "percentage" ? "100" : undefined}
                    step={formDepositType === "percentage" ? "1" : "0.01"}
                    placeholder={formDepositType === "percentage" ? "np. 30" : "np. 50.00"}
                    value={formDepositValue}
                    onChange={(e) => onDepositValueChange(e.target.value)}
                    className="max-w-[180px]"
                    data-testid="deposit-value-input"
                  />
                  <span className="text-sm text-muted-foreground">
                    {formDepositType === "percentage" ? "%" : "PLN"}
                  </span>
                </div>
                {formDepositType === "percentage" && formDepositValue && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Przy usludze za 100 PLN, zadatek wyniesie {parseFloat(formDepositValue || "0").toFixed(0)} PLN
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        {formRequireDeposit && (
          <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
            <p className="text-sm text-green-700 dark:text-green-400">
              <Banknote className="h-4 w-4 inline mr-1" />
              {formDepositType === "percentage"
                ? `Ten klient bedzie musial zaplacic ${formDepositValue || "0"}% ceny uslugi jako zadatek.`
                : `Ten klient bedzie musial zaplacic ${parseFloat(formDepositValue || "0").toFixed(2)} PLN jako zadatek.`}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
