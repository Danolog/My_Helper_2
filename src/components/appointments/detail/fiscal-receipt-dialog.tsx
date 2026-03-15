"use client";

import { useState } from "react";
import { Receipt, Printer } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { AppointmentDetail, FiscalReceiptData } from "./types";

interface FiscalReceiptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: AppointmentDetail;
  fiscalReceipt: FiscalReceiptData | null;
  totalMaterialCost: number;
  /** Called after a receipt is printed so the parent can update state. */
  onReceiptPrinted: (receipt: FiscalReceiptData) => void;
}

export function FiscalReceiptDialog({
  open,
  onOpenChange,
  appointment,
  fiscalReceipt,
  totalMaterialCost,
  onReceiptPrinted,
}: FiscalReceiptDialogProps) {
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("cash");
  const [printingReceipt, setPrintingReceipt] = useState(false);

  const handlePrintReceipt = async () => {
    setPrintingReceipt(true);
    try {
      const res = await fetch(`/api/appointments/${appointment.id}/fiscal-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: selectedPaymentMethod }),
      });
      const data = await res.json();
      if (data.success) {
        onReceiptPrinted(data.data);
        toast.success(data.message || "Paragon fiskalny wyslany do drukarki");
        onOpenChange(false);
      } else {
        toast.error(data.error || "Nie udalo sie wydrukowac paragonu");
      }
    } catch {
      toast.error("Blad podczas drukowania paragonu");
    } finally {
      setPrintingReceipt(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="receipt-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            {fiscalReceipt ? "Podglad paragonu fiskalnego" : "Drukuj paragon fiskalny"}
          </DialogTitle>
        </DialogHeader>

        {fiscalReceipt ? (
          /* Receipt Preview */
          <div className="space-y-4">
            {/* Receipt preview styled like a thermal printer receipt */}
            <div
              className="bg-white dark:bg-gray-900 border rounded-lg p-4 font-mono text-xs space-y-2"
              data-testid="receipt-preview"
            >
              {/* Header */}
              <div className="text-center space-y-0.5">
                {fiscalReceipt.receiptDataJson?.header.line1 && (
                  <p className="font-bold text-sm">{fiscalReceipt.receiptDataJson.header.line1}</p>
                )}
                {fiscalReceipt.receiptDataJson?.header.line2 && (
                  <p>{fiscalReceipt.receiptDataJson.header.line2}</p>
                )}
                {fiscalReceipt.receiptDataJson?.header.line3 && (
                  <p>{fiscalReceipt.receiptDataJson.header.line3}</p>
                )}
                {fiscalReceipt.receiptDataJson?.header.nip && (
                  <p>{fiscalReceipt.receiptDataJson.header.nip}</p>
                )}
              </div>
              <Separator />

              {/* Receipt number and date */}
              <div className="flex justify-between">
                <span>{fiscalReceipt.receiptDataJson?.receiptNumber}</span>
                <span>{fiscalReceipt.receiptDataJson?.date} {fiscalReceipt.receiptDataJson?.time}</span>
              </div>
              <Separator />

              {/* Items */}
              <div className="space-y-1">
                {fiscalReceipt.receiptDataJson?.items.map((item, idx) => (
                  <div key={idx}>
                    <p className="font-medium">{item.name}</p>
                    <div className="flex justify-between pl-2">
                      <span>{item.quantity} x {item.unitPrice} PLN</span>
                      <span>{item.total} PLN ({item.vatRate})</span>
                    </div>
                  </div>
                ))}
              </div>
              <Separator />

              {/* Summary */}
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>Netto:</span>
                  <span>{fiscalReceipt.receiptDataJson?.summary.netAmount} PLN</span>
                </div>
                <div className="flex justify-between">
                  <span>VAT ({fiscalReceipt.receiptDataJson?.summary.vatRate}):</span>
                  <span>{fiscalReceipt.receiptDataJson?.summary.vatAmount} PLN</span>
                </div>
                <div className="flex justify-between font-bold text-sm">
                  <span>RAZEM:</span>
                  <span>{fiscalReceipt.receiptDataJson?.summary.totalAmount} PLN</span>
                </div>
              </div>
              <Separator />

              {/* Payment method */}
              <div className="flex justify-between">
                <span>Platnosc:</span>
                <span>{fiscalReceipt.receiptDataJson?.paymentMethod}</span>
              </div>

              {/* Footer */}
              <div className="text-center mt-3 pt-2">
                <p className="text-muted-foreground">{fiscalReceipt.receiptDataJson?.footer}</p>
              </div>
            </div>

            {/* Receipt metadata */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Drukarka: </span>
                <span>{fiscalReceipt.printerModel || "N/A"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Status: </span>
                <Badge variant="default" className="text-xs">
                  {fiscalReceipt.printStatus === "sent" ? "Wyslany do drukarki" : fiscalReceipt.printStatus}
                </Badge>
              </div>
            </div>
          </div>
        ) : (
          /* Print new receipt form */
          <div className="space-y-4">
            <div className="p-4 rounded-lg border bg-muted/50">
              <h4 className="font-medium mb-2">Podsumowanie wizyty</h4>
              <div className="space-y-1 text-sm">
                {appointment.service && (
                  <div className="flex justify-between">
                    <span>{appointment.service.name}</span>
                    <span>{parseFloat(appointment.service.basePrice).toFixed(2)} PLN</span>
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

            <div>
              <Label className="text-sm font-medium">Metoda platnosci</Label>
              <Select
                value={selectedPaymentMethod}
                onValueChange={setSelectedPaymentMethod}
              >
                <SelectTrigger className="mt-1" data-testid="payment-method-select">
                  <SelectValue placeholder="Wybierz metode platnosci" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Gotowka</SelectItem>
                  <SelectItem value="card">Karta</SelectItem>
                  <SelectItem value="transfer">Przelew</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start gap-2 text-sm text-muted-foreground p-3 rounded-lg border bg-muted/30">
              <Printer className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                Paragon zostanie wyslany do skonfigurowanej drukarki fiskalnej.
                Upewnij sie, ze drukarka jest wlaczona i polaczona.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {fiscalReceipt ? "Zamknij" : "Anuluj"}
          </Button>
          {!fiscalReceipt && (
            <Button
              onClick={handlePrintReceipt}
              disabled={printingReceipt}
              data-testid="confirm-print-receipt-btn"
            >
              <Printer className="h-4 w-4 mr-2" />
              {printingReceipt ? "Drukowanie..." : "Drukuj paragon"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
