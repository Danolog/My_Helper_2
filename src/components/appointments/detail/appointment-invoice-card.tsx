"use client";

import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { InvoiceData } from "./types";

interface AppointmentInvoiceCardProps {
  invoice: InvoiceData;
  onViewDetails: () => void;
}

export function AppointmentInvoiceCard({
  invoice,
  onViewDetails,
}: AppointmentInvoiceCardProps) {
  return (
    <Card className="mb-6" data-testid="invoice-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Faktura</CardTitle>
            <Badge variant="default" data-testid="invoice-type-badge">
              {invoice.type === "paragon" ? "Osoba fizyczna" : "Firma"}
            </Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onViewDetails}
            data-testid="view-invoice-details-btn"
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
              Numer faktury
            </p>
            <p className="text-sm font-mono" data-testid="invoice-number">
              {invoice.invoiceNumber}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
              Kwota brutto
            </p>
            <p className="text-sm font-bold" data-testid="invoice-amount">
              {parseFloat(invoice.amount).toFixed(2)} PLN
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
              Nabywca
            </p>
            <p className="text-sm" data-testid="invoice-buyer">
              {invoice.type === "paragon"
                ? invoice.clientName || "\u2014"
                : invoice.companyName || "\u2014"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
