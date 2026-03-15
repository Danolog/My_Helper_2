"use client";

import Link from "next/link";
import {
  FileText,
  Search,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Receipt,
  Building2,
  User,
  Calendar,
  CreditCard,
  Hash,
  Eye,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import type { Invoice } from "../_hooks/use-invoices-data";

interface InvoicesTableProps {
  invoicesList: Invoice[];
  loading: boolean;
  expandedId: string | null;
  hasFilters: boolean;
  onToggleExpand: (id: string) => void;
  onNavigateToInvoice: (id: string) => void;
  getPaymentMethodLabel: (method: string | null) => string;
}

export function InvoicesTable({
  invoicesList,
  loading,
  expandedId,
  hasFilters,
  onToggleExpand,
  onNavigateToInvoice,
  getPaymentMethodLabel,
}: InvoicesTableProps) {
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (invoicesList.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          {hasFilters ? (
            <>
              <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">Nie znaleziono faktur</p>
              <p className="text-sm">
                Zmien kryteria wyszukiwania lub wyczysc filtry
              </p>
            </>
          ) : (
            <>
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">Brak faktur</p>
              <p className="text-sm">
                Faktury pojawia sie po ich wygenerowaniu z zakonczonych wizyt.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3" data-testid="invoices-list">
      {invoicesList.map((invoice) => (
        <Card
          key={invoice.id}
          className="overflow-hidden"
          data-testid={`invoice-card-${invoice.id}`}
        >
          {/* Invoice Row - Clickable */}
          <div
            className="flex items-center gap-4 p-4 cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => onToggleExpand(invoice.id)}
            data-testid={`invoice-row-${invoice.id}`}
          >
            {/* Type icon */}
            <div className="flex-shrink-0">
              {invoice.type === "faktura" ? (
                <Building2 className="h-5 w-5 text-blue-600" />
              ) : (
                <Receipt className="h-5 w-5 text-green-600" />
              )}
            </div>

            {/* Invoice number */}
            <div className="min-w-0 flex-1">
              <p
                className="font-mono text-sm font-medium truncate"
                data-testid={`invoice-number-${invoice.id}`}
              >
                {invoice.invoiceNumber}
              </p>
              <p className="text-xs text-muted-foreground">
                {invoice.type === "faktura"
                  ? invoice.companyName || "Firma"
                  : invoice.clientName || "Klient"}
              </p>
            </div>

            {/* Type badge */}
            <Badge
              variant={invoice.type === "faktura" ? "default" : "secondary"}
              className="flex-shrink-0"
              data-testid={`invoice-type-${invoice.id}`}
            >
              {invoice.type === "faktura" ? "Faktura VAT" : "Rachunek"}
            </Badge>

            {/* Date */}
            <div
              className="text-sm text-muted-foreground flex-shrink-0 hidden sm:block"
              data-testid={`invoice-date-${invoice.id}`}
            >
              {new Date(invoice.issuedAt).toLocaleDateString("pl-PL", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
            </div>

            {/* Amount */}
            <div
              className="text-sm font-semibold flex-shrink-0 min-w-[100px] text-right"
              data-testid={`invoice-amount-${invoice.id}`}
            >
              {parseFloat(invoice.amount).toFixed(2)} PLN
            </div>

            {/* Preview button */}
            <Button
              variant="ghost"
              size="sm"
              className="flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onNavigateToInvoice(invoice.id);
              }}
              data-testid={`invoice-preview-btn-${invoice.id}`}
            >
              <Eye className="h-4 w-4 mr-1" />
              Podglad
            </Button>

            {/* Expand icon */}
            <div className="flex-shrink-0">
              {expandedId === invoice.id ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>

          {/* Expanded Details */}
          {expandedId === invoice.id && (
            <InvoiceExpandedDetails
              invoice={invoice}
              getPaymentMethodLabel={getPaymentMethodLabel}
            />
          )}
        </Card>
      ))}
    </div>
  );
}

// Extracted expanded details to keep the main component readable
function InvoiceExpandedDetails({
  invoice,
  getPaymentMethodLabel,
}: {
  invoice: Invoice;
  getPaymentMethodLabel: (method: string | null) => string;
}) {
  return (
    <div
      className="border-t bg-muted/30 p-4 space-y-4"
      data-testid={`invoice-details-${invoice.id}`}
    >
      {/* Invoice preview from invoiceDataJson */}
      {invoice.invoiceDataJson ? (
        <div className="space-y-4">
          {/* Document header */}
          <div className="text-center border-b pb-3">
            <p className="text-lg font-bold">
              {invoice.type === "paragon"
                ? "RACHUNEK"
                : "FAKTURA VAT"}
            </p>
            <p className="text-sm text-muted-foreground font-mono">
              Nr: {invoice.invoiceNumber}
            </p>
            <p className="text-xs text-muted-foreground">
              Data wystawienia:{" "}
              {new Date(invoice.issuedAt).toLocaleDateString(
                "pl-PL",
                {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                }
              )}
            </p>
          </div>

          {/* Seller / Buyer */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {invoice.invoiceDataJson.seller && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                  Sprzedawca
                </p>
                <p className="font-medium text-sm">
                  {invoice.invoiceDataJson.seller.name}
                </p>
                {invoice.invoiceDataJson.seller.address && (
                  <p className="text-xs text-muted-foreground">
                    {invoice.invoiceDataJson.seller.address}
                  </p>
                )}
                {invoice.invoiceDataJson.seller.nip && (
                  <p className="text-xs text-muted-foreground">
                    NIP: {invoice.invoiceDataJson.seller.nip}
                  </p>
                )}
              </div>
            )}
            {invoice.invoiceDataJson.buyer && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                  Nabywca
                </p>
                <p className="font-medium text-sm">
                  {invoice.invoiceDataJson.buyer.name || "—"}
                </p>
                {invoice.invoiceDataJson.buyer.address && (
                  <p className="text-xs text-muted-foreground">
                    {invoice.invoiceDataJson.buyer.address}
                  </p>
                )}
                {invoice.invoiceDataJson.buyer.nip && (
                  <p className="text-xs text-muted-foreground">
                    NIP: {invoice.invoiceDataJson.buyer.nip}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Items */}
          {invoice.invoiceDataJson.items &&
            invoice.invoiceDataJson.items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left p-2">Pozycja</th>
                      <th className="text-right p-2">Ilosc</th>
                      <th className="text-right p-2">Cena jedn.</th>
                      <th className="text-right p-2">Netto</th>
                      <th className="text-right p-2">VAT</th>
                      <th className="text-right p-2">Brutto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.invoiceDataJson.items.map(
                      (item, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="p-2">{item.name}</td>
                          <td className="p-2 text-right">
                            {item.quantity}
                          </td>
                          <td className="p-2 text-right">
                            {item.unitPrice} PLN
                          </td>
                          <td className="p-2 text-right">
                            {item.netPrice} PLN
                          </td>
                          <td className="p-2 text-right">
                            {item.vatRate}
                          </td>
                          <td className="p-2 text-right font-medium">
                            {item.total} PLN
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}

          {/* Summary */}
          {invoice.invoiceDataJson.summary && (
            <div className="flex justify-end">
              <div className="w-64 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Netto:
                  </span>
                  <span>
                    {invoice.invoiceDataJson.summary.netAmount} PLN
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    VAT ({invoice.invoiceDataJson.summary.vatRate}):
                  </span>
                  <span>
                    {invoice.invoiceDataJson.summary.vatAmount} PLN
                  </span>
                </div>
                <div className="flex justify-between font-bold border-t pt-1">
                  <span>Brutto:</span>
                  <span>
                    {invoice.invoiceDataJson.summary.totalAmount} PLN
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Additional info */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm pt-2 border-t">
            <div className="flex items-center gap-2">
              <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">
                  Platnosc
                </p>
                <p className="font-medium">
                  {invoice.invoiceDataJson.paymentMethod ||
                    getPaymentMethodLabel(invoice.paymentMethod)}
                </p>
              </div>
            </div>
            {invoice.invoiceDataJson.employee && (
              <div className="flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">
                    Pracownik
                  </p>
                  <p className="font-medium">
                    {invoice.invoiceDataJson.employee}
                  </p>
                </div>
              </div>
            )}
            {invoice.invoiceDataJson.appointmentDate && (
              <div className="flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">
                    Data wizyty
                  </p>
                  <p className="font-medium">
                    {invoice.invoiceDataJson.appointmentDate}
                  </p>
                </div>
              </div>
            )}
            {invoice.invoiceDataJson.appointmentTime && (
              <div className="flex items-center gap-2">
                <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">
                    Godzina
                  </p>
                  <p className="font-medium">
                    {invoice.invoiceDataJson.appointmentTime}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Link to appointment */}
          {invoice.appointmentId && (
            <div className="pt-2">
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={`/dashboard/appointments/${invoice.appointmentId}`}
                >
                  Przejdz do wizyty
                </Link>
              </Button>
            </div>
          )}
        </div>
      ) : (
        /* Fallback if no invoiceDataJson */
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Numer faktury</p>
            <p className="font-mono font-medium">
              {invoice.invoiceNumber}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Kwota</p>
            <p className="font-semibold">
              {parseFloat(invoice.amount).toFixed(2)} PLN
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Typ</p>
            <p>
              {invoice.type === "faktura"
                ? "Faktura VAT"
                : "Rachunek"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Platnosc</p>
            <p>{getPaymentMethodLabel(invoice.paymentMethod)}</p>
          </div>
          {invoice.description && (
            <div className="col-span-2">
              <p className="text-muted-foreground">Opis</p>
              <p>{invoice.description}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
