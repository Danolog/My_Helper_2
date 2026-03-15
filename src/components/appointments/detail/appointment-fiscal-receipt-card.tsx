"use client";

import { Receipt, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FiscalReceiptData } from "./types";

interface AppointmentFiscalReceiptCardProps {
  fiscalReceipt: FiscalReceiptData;
  onViewDetails: () => void;
}

export function AppointmentFiscalReceiptCard({
  fiscalReceipt,
  onViewDetails,
}: AppointmentFiscalReceiptCardProps) {
  return (
    <Card className="mb-6" data-testid="fiscal-receipt-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Paragon fiskalny</CardTitle>
            <Badge variant="default" data-testid="receipt-status-badge">
              {fiscalReceipt.printStatus === "sent"
                ? "Wyslany"
                : fiscalReceipt.printStatus === "confirmed"
                  ? "Potwierdzony"
                  : "Blad"}
            </Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onViewDetails}
            data-testid="view-receipt-details-btn"
          >
            <FileText className="h-4 w-4 mr-1" />
            Podglad
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
              Numer paragonu
            </p>
            <p className="text-sm font-mono" data-testid="receipt-number">
              {fiscalReceipt.receiptNumber}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
              Kwota brutto
            </p>
            <p className="text-sm font-bold" data-testid="receipt-total">
              {parseFloat(fiscalReceipt.totalAmount).toFixed(2)} PLN
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
              Data wydruku
            </p>
            <p className="text-sm" data-testid="receipt-date">
              {new Date(fiscalReceipt.printedAt).toLocaleDateString("pl-PL", {
                day: "numeric",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
