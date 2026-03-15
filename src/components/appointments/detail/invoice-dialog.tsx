"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import type { AppointmentDetail, InvoiceData } from "./types";

interface InvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: AppointmentDetail;
  invoice: InvoiceData | null;
  totalMaterialCost: number;
  /** Called after an invoice is generated so the parent can update state. */
  onInvoiceGenerated: (invoice: InvoiceData) => void;
}

export function InvoiceDialog({
  open,
  onOpenChange,
  appointment,
  invoice,
  totalMaterialCost,
  onInvoiceGenerated,
}: InvoiceDialogProps) {
  // Pre-fill client name when opening for generation
  const defaultClientName = appointment.client
    ? `${appointment.client.firstName} ${appointment.client.lastName}`
    : "";

  const [invoiceType, setInvoiceType] = useState<"paragon" | "faktura">("paragon");
  const [invoiceClientName, setInvoiceClientName] = useState(defaultClientName);
  const [invoiceClientAddress, setInvoiceClientAddress] = useState("");
  const [invoiceCompanyName, setInvoiceCompanyName] = useState("");
  const [invoiceCompanyNip, setInvoiceCompanyNip] = useState("");
  const [invoiceCompanyAddress, setInvoiceCompanyAddress] = useState("");
  const [invoicePaymentMethod, setInvoicePaymentMethod] = useState("cash");
  const [generatingInvoice, setGeneratingInvoice] = useState(false);

  const handleGenerateInvoice = async () => {
    if (invoiceType === "paragon" && !invoiceClientName.trim()) {
      toast.error("Podaj imie i nazwisko klienta");
      return;
    }
    if (invoiceType === "faktura") {
      if (!invoiceCompanyName.trim()) {
        toast.error("Podaj nazwe firmy");
        return;
      }
      if (!invoiceCompanyNip.trim()) {
        toast.error("Podaj NIP firmy");
        return;
      }
      // Validate NIP format (10 digits, optionally with dashes)
      const nipClean = invoiceCompanyNip.replace(/[-\s]/g, "");
      if (!/^\d{10}$/.test(nipClean)) {
        toast.error("NIP musi zawierac 10 cyfr");
        return;
      }
    }
    setGeneratingInvoice(true);
    try {
      const res = await fetch(`/api/appointments/${appointment.id}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: invoiceType,
          clientName: invoiceType === "paragon" ? invoiceClientName.trim() : null,
          clientAddress: invoiceType === "paragon" ? (invoiceClientAddress.trim() || null) : null,
          companyName: invoiceType === "faktura" ? invoiceCompanyName.trim() : null,
          companyNip: invoiceType === "faktura" ? invoiceCompanyNip.replace(/[-\s]/g, "").trim() : null,
          companyAddress: invoiceType === "faktura" ? (invoiceCompanyAddress.trim() || null) : null,
          paymentMethod: invoicePaymentMethod,
        }),
      });
      const data = await res.json();
      if (data.success) {
        onInvoiceGenerated(data.data);
        toast.success(data.message || "Faktura zostala wygenerowana");
        onOpenChange(false);
      } else {
        toast.error(data.error || "Nie udalo sie wygenerowac faktury");
      }
    } catch {
      toast.error("Blad podczas generowania faktury");
    } finally {
      setGeneratingInvoice(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="invoice-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {invoice ? "Podglad faktury" : "Generuj fakture"}
          </DialogTitle>
        </DialogHeader>

        {invoice ? (
          /* Invoice Preview */
          <div className="space-y-4">
            <div
              className="bg-white dark:bg-gray-900 border rounded-lg p-4 space-y-3"
              data-testid="invoice-preview"
            >
              {/* Header */}
              <div className="text-center">
                <p className="font-bold text-lg">
                  {invoice.type === "paragon" ? "RACHUNEK" : "FAKTURA VAT"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Nr: {invoice.invoiceNumber}
                </p>
                <p className="text-sm text-muted-foreground">
                  Data wystawienia:{" "}
                  {new Date(invoice.issuedAt).toLocaleDateString("pl-PL", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </div>

              <Separator />

              {/* Seller and Buyer */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                    Sprzedawca
                  </p>
                  {invoice.invoiceDataJson?.seller && (
                    <>
                      <p className="font-medium">{invoice.invoiceDataJson.seller.name}</p>
                      {invoice.invoiceDataJson.seller.address && (
                        <p className="text-muted-foreground">{invoice.invoiceDataJson.seller.address}</p>
                      )}
                      {invoice.invoiceDataJson.seller.nip && (
                        <p className="text-muted-foreground">NIP: {invoice.invoiceDataJson.seller.nip}</p>
                      )}
                    </>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                    Nabywca
                  </p>
                  {invoice.invoiceDataJson?.buyer && (
                    <>
                      <p className="font-medium">{invoice.invoiceDataJson.buyer.name || "\u2014"}</p>
                      {invoice.invoiceDataJson.buyer.address && (
                        <p className="text-muted-foreground">{invoice.invoiceDataJson.buyer.address}</p>
                      )}
                      {invoice.invoiceDataJson.buyer.nip && (
                        <p className="text-muted-foreground">NIP: {invoice.invoiceDataJson.buyer.nip}</p>
                      )}
                    </>
                  )}
                </div>
              </div>

              <Separator />

              {/* Items */}
              <div className="space-y-1 text-sm">
                <div className="flex justify-between font-medium text-xs text-muted-foreground uppercase">
                  <span>Pozycja</span>
                  <span>Kwota brutto</span>
                </div>
                {invoice.invoiceDataJson?.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between">
                    <span>
                      {item.name} x{item.quantity}
                    </span>
                    <span>{item.total} PLN</span>
                  </div>
                ))}
              </div>

              <Separator />

              {/* Summary */}
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Netto:</span>
                  <span>{invoice.invoiceDataJson?.summary.netAmount} PLN</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    VAT ({invoice.invoiceDataJson?.summary.vatRate}):
                  </span>
                  <span>{invoice.invoiceDataJson?.summary.vatAmount} PLN</span>
                </div>
                <div className="flex justify-between font-bold text-base">
                  <span>RAZEM:</span>
                  <span>{invoice.invoiceDataJson?.summary.totalAmount} PLN</span>
                </div>
              </div>

              <Separator />

              {/* Payment and Appointment info */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Platnosc: </span>
                  <span>{invoice.invoiceDataJson?.paymentMethod}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Data wizyty: </span>
                  <span>{invoice.invoiceDataJson?.appointmentDate}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Generate Invoice Form */
          <div className="space-y-4">
            {/* Visit summary */}
            <div className="p-4 rounded-lg border bg-muted/50">
              <h4 className="font-medium mb-2">Podsumowanie wizyty</h4>
              <div className="space-y-1 text-sm">
                {appointment.service && (
                  <div className="flex justify-between">
                    <span>{appointment.service.name}</span>
                    <span>
                      {parseFloat(appointment.service.basePrice).toFixed(2)} PLN
                    </span>
                  </div>
                )}
                {totalMaterialCost > 0 && (
                  <div className="flex justify-between">
                    <span>Materialy</span>
                    <span>{totalMaterialCost.toFixed(2)} PLN</span>
                  </div>
                )}
                <Separator className="my-2" />
                <div className="flex justify-between font-bold">
                  <span>Razem</span>
                  <span>
                    {(
                      parseFloat(appointment.service?.basePrice || "0") +
                      totalMaterialCost
                    ).toFixed(2)}{" "}
                    PLN
                  </span>
                </div>
              </div>
            </div>

            {/* Invoice type selector */}
            <div>
              <Label className="text-sm font-medium">Typ faktury *</Label>
              <Select
                value={invoiceType}
                onValueChange={(val) =>
                  setInvoiceType(val as "paragon" | "faktura")
                }
              >
                <SelectTrigger className="mt-1" data-testid="invoice-type-select">
                  <SelectValue placeholder="Wybierz typ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paragon">
                    Osoba fizyczna (rachunek)
                  </SelectItem>
                  <SelectItem value="faktura">
                    Firma (faktura VAT)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Individual invoice fields */}
            {invoiceType === "paragon" && (
              <>
                <div>
                  <Label className="text-sm font-medium">
                    Imie i nazwisko klienta *
                  </Label>
                  <Input
                    value={invoiceClientName}
                    onChange={(e) => setInvoiceClientName(e.target.value)}
                    placeholder="np. Jan Kowalski"
                    className="mt-1"
                    data-testid="invoice-client-name-input"
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium">
                    Adres klienta (opcjonalnie)
                  </Label>
                  <Input
                    value={invoiceClientAddress}
                    onChange={(e) => setInvoiceClientAddress(e.target.value)}
                    placeholder="np. ul. Kwiatowa 5, 00-001 Warszawa"
                    className="mt-1"
                    data-testid="invoice-client-address-input"
                  />
                </div>
              </>
            )}

            {/* Company invoice fields */}
            {invoiceType === "faktura" && (
              <>
                <div>
                  <Label className="text-sm font-medium">
                    Nazwa firmy *
                  </Label>
                  <Input
                    value={invoiceCompanyName}
                    onChange={(e) => setInvoiceCompanyName(e.target.value)}
                    placeholder="np. Firma XYZ Sp. z o.o."
                    className="mt-1"
                    data-testid="invoice-company-name-input"
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium">
                    NIP *
                  </Label>
                  <Input
                    value={invoiceCompanyNip}
                    onChange={(e) => setInvoiceCompanyNip(e.target.value)}
                    placeholder="np. 1234567890"
                    className="mt-1"
                    data-testid="invoice-company-nip-input"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    10 cyfr, bez kresek
                  </p>
                </div>
                <div>
                  <Label className="text-sm font-medium">
                    Adres firmy (opcjonalnie)
                  </Label>
                  <Input
                    value={invoiceCompanyAddress}
                    onChange={(e) => setInvoiceCompanyAddress(e.target.value)}
                    placeholder="np. ul. Biznesowa 10, 00-100 Warszawa"
                    className="mt-1"
                    data-testid="invoice-company-address-input"
                  />
                </div>
              </>
            )}

            {/* Payment method */}
            <div>
              <Label className="text-sm font-medium">Metoda platnosci</Label>
              <Select
                value={invoicePaymentMethod}
                onValueChange={setInvoicePaymentMethod}
              >
                <SelectTrigger
                  className="mt-1"
                  data-testid="invoice-payment-method-select"
                >
                  <SelectValue placeholder="Wybierz metode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Gotowka</SelectItem>
                  <SelectItem value="card">Karta</SelectItem>
                  <SelectItem value="transfer">Przelew</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {invoice ? "Zamknij" : "Anuluj"}
          </Button>
          {!invoice && (
            <Button
              onClick={handleGenerateInvoice}
              disabled={generatingInvoice}
              data-testid="confirm-generate-invoice-btn"
            >
              <FileText className="h-4 w-4 mr-2" />
              {generatingInvoice ? "Generowanie..." : "Generuj fakture"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
