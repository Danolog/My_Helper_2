"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, FileText, Printer, Mail, Send, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface InvoiceItem {
  name: string;
  quantity: number;
  unitPrice: string;
  netPrice: string;
  total: string;
  vatRate: string;
}

interface InvoiceDataJson {
  seller?: {
    name: string;
    address?: string;
    nip?: string;
  };
  buyer?: {
    name?: string;
    address?: string;
    nip?: string;
  };
  invoiceNumber: string;
  issueDate: string;
  items: InvoiceItem[];
  summary: {
    netAmount: string;
    vatRate: string;
    vatAmount: string;
    totalAmount: string;
  };
  paymentMethod: string;
  employee?: string;
  appointmentDate?: string;
  appointmentTime?: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  type: string;
  amount: string;
  vatRate: string | null;
  vatAmount: string | null;
  netAmount: string | null;
  clientName: string | null;
  clientAddress: string | null;
  companyName: string | null;
  companyNip: string | null;
  description: string | null;
  paymentMethod: string | null;
  invoiceDataJson: InvoiceDataJson | null;
  issuedAt: string;
  createdAt: string;
  emailSentAt: string | null;
  emailSentTo: string | null;
  appointmentId: string | null;
  clientId: string | null;
  clientFirstName: string | null;
  clientLastName: string | null;
  clientEmail: string | null;
  employeeFirstName: string | null;
  employeeLastName: string | null;
  serviceName: string | null;
  appointmentStartTime: string | null;
}

export default function InvoicePreviewPage() {
  const params = useParams();
  const router = useRouter();
  const invoiceId = params.id as string;
  const { data: session, isPending } = useSession();

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Send email state
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [sending, setSending] = useState(false);

  const fetchInvoice = useCallback(async () => {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`);
      const json = await res.json();
      if (json.success) {
        setInvoice(json.data);
        // Pre-fill email field with client email if available
        if (json.data.clientEmail) {
          setEmailTo(json.data.clientEmail);
        }
      } else {
        setError(json.error || "Nie udalo sie pobrac faktury");
        toast.error(json.error || "Nie udalo sie pobrac faktury");
      }
    } catch {
      setError("Blad polaczenia z serwerem");
      toast.error("Blad polaczenia z serwerem");
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    if (session) {
      fetchInvoice();
    }
  }, [session, fetchInvoice]);

  const handleSendEmail = async () => {
    if (!emailTo.trim()) {
      toast.error("Podaj adres email odbiorcy");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo.trim())) {
      toast.error("Wprowadz poprawny adres email");
      return;
    }

    setSending(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailTo.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message || "Faktura wyslana emailem");
        setShowEmailDialog(false);
        // Refresh invoice data to get updated emailSentAt
        fetchInvoice();
      } else {
        toast.error(json.error || "Nie udalo sie wyslac emaila");
      }
    } catch {
      toast.error("Blad polaczenia z serwerem");
    } finally {
      setSending(false);
    }
  };

  if (isPending || loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto p-6 text-center">
        <p>Musisz byc zalogowany aby zobaczyc fakture.</p>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="container mx-auto p-6 text-center" data-testid="invoice-preview-page">
        <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
        <p className="text-lg font-medium">Faktura nie znaleziona</p>
        <p className="text-sm text-muted-foreground mt-1">
          {error || "Nie udalo sie zaladowac danych faktury."}
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => router.push("/dashboard/invoices")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Powrot do listy faktur
        </Button>
      </div>
    );
  }

  const data = invoice.invoiceDataJson;
  const issuedDate = new Date(invoice.issuedAt).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="container mx-auto p-6" data-testid="invoice-preview-page">
      {/* Header - hidden during print */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push("/dashboard/invoices")}
            data-testid="back-btn"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Podglad faktury</h1>
            <p className="text-muted-foreground text-sm">
              {invoice.invoiceNumber}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Email sent status badge */}
          {invoice.emailSentAt && (
            <Badge variant="outline" className="gap-1 text-green-600 border-green-300" data-testid="email-sent-badge">
              <CheckCircle2 className="h-3 w-3" />
              Wyslano {new Date(invoice.emailSentAt).toLocaleDateString("pl-PL")}
            </Badge>
          )}
          <Button
            variant="outline"
            onClick={() => setShowEmailDialog(true)}
            data-testid="send-email-btn"
          >
            <Mail className="h-4 w-4 mr-2" />
            Wyslij emailem
          </Button>
          <Button
            onClick={() => window.print()}
            data-testid="print-btn"
          >
            <Printer className="h-4 w-4 mr-2" />
            Drukuj / Eksportuj PDF
          </Button>
        </div>
      </div>

      {/* Email sent info banner */}
      {invoice.emailSentAt && invoice.emailSentTo && (
        <div
          className="mb-4 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-3 print:hidden"
          data-testid="email-sent-info"
        >
          <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
          <div className="text-sm">
            <span className="font-medium text-green-800 dark:text-green-200">
              Faktura wyslana emailem
            </span>
            <span className="text-green-600 dark:text-green-400 ml-2">
              do {invoice.emailSentTo} dnia{" "}
              {new Date(invoice.emailSentAt).toLocaleDateString("pl-PL", {
                day: "numeric",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>
      )}

      {/* A4-like invoice preview container */}
      <div
        className="bg-white dark:bg-gray-950 border rounded-lg shadow-lg max-w-[800px] mx-auto p-8 print:shadow-none print:border-none print:p-0 print:max-w-none"
        data-testid="invoice-pdf-preview"
      >
        {/* Document title */}
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold tracking-wide">
            {invoice.type === "paragon" ? "RACHUNEK" : "FAKTURA VAT"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1 font-mono print:text-black">
            Nr: {invoice.invoiceNumber}
          </p>
          <p className="text-sm text-muted-foreground mt-1 print:text-black">
            Data wystawienia: {issuedDate}
          </p>
        </div>

        <Separator className="mb-6" />

        {/* Seller and Buyer */}
        <div className="grid grid-cols-2 gap-8 mb-6">
          {/* Seller */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 print:text-gray-600">
              Sprzedawca
            </p>
            {data?.seller ? (
              <>
                <p className="font-medium">{data.seller.name}</p>
                {data.seller.address && (
                  <p className="text-sm text-muted-foreground print:text-gray-600">
                    {data.seller.address}
                  </p>
                )}
                {data.seller.nip && (
                  <p className="text-sm text-muted-foreground print:text-gray-600">
                    NIP: {data.seller.nip}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">--</p>
            )}
          </div>

          {/* Buyer */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 print:text-gray-600">
              Nabywca
            </p>
            {data?.buyer ? (
              <>
                <p className="font-medium">{data.buyer.name || "--"}</p>
                {data.buyer.address && (
                  <p className="text-sm text-muted-foreground print:text-gray-600">
                    {data.buyer.address}
                  </p>
                )}
                {data.buyer.nip && (
                  <p className="text-sm text-muted-foreground print:text-gray-600">
                    NIP: {data.buyer.nip}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">--</p>
            )}
          </div>
        </div>

        <Separator className="mb-6" />

        {/* Items table */}
        {data?.items && data.items.length > 0 && (
          <div className="mb-6 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-300 dark:border-gray-600">
                  <th className="text-left p-2 text-xs font-semibold text-muted-foreground uppercase print:text-gray-600">
                    Lp.
                  </th>
                  <th className="text-left p-2 text-xs font-semibold text-muted-foreground uppercase print:text-gray-600">
                    Nazwa
                  </th>
                  <th className="text-right p-2 text-xs font-semibold text-muted-foreground uppercase print:text-gray-600">
                    Ilosc
                  </th>
                  <th className="text-right p-2 text-xs font-semibold text-muted-foreground uppercase print:text-gray-600">
                    Cena jedn.
                  </th>
                  <th className="text-right p-2 text-xs font-semibold text-muted-foreground uppercase print:text-gray-600">
                    Netto
                  </th>
                  <th className="text-right p-2 text-xs font-semibold text-muted-foreground uppercase print:text-gray-600">
                    VAT
                  </th>
                  <th className="text-right p-2 text-xs font-semibold text-muted-foreground uppercase print:text-gray-600">
                    Brutto
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item, idx) => (
                  <tr key={idx} className="border-b border-gray-200 dark:border-gray-700">
                    <td className="p-2">{idx + 1}</td>
                    <td className="p-2">{item.name}</td>
                    <td className="p-2 text-right">{item.quantity}</td>
                    <td className="p-2 text-right">{item.unitPrice} PLN</td>
                    <td className="p-2 text-right">{item.netPrice} PLN</td>
                    <td className="p-2 text-right">{item.vatRate}</td>
                    <td className="p-2 text-right font-medium">{item.total} PLN</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Summary */}
        {data?.summary && (
          <div className="flex justify-end mb-6">
            <div className="w-72 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground print:text-gray-600">Netto:</span>
                <span>{data.summary.netAmount} PLN</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground print:text-gray-600">
                  VAT ({data.summary.vatRate}):
                </span>
                <span>{data.summary.vatAmount} PLN</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-base">
                <span>RAZEM:</span>
                <span>{data.summary.totalAmount} PLN</span>
              </div>
            </div>
          </div>
        )}

        <Separator className="mb-6" />

        {/* Payment method, appointment details, and employee */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          {data?.paymentMethod && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1 print:text-gray-600">
                Metoda platnosci
              </p>
              <p className="font-medium">{data.paymentMethod}</p>
            </div>
          )}
          {data?.appointmentDate && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1 print:text-gray-600">
                Data wizyty
              </p>
              <p className="font-medium">{data.appointmentDate}</p>
            </div>
          )}
          {data?.appointmentTime && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1 print:text-gray-600">
                Godzina wizyty
              </p>
              <p className="font-medium">{data.appointmentTime}</p>
            </div>
          )}
          {data?.employee && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1 print:text-gray-600">
                Pracownik
              </p>
              <p className="font-medium">{data.employee}</p>
            </div>
          )}
        </div>
      </div>

      {/* Send Email Dialog */}
      <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
        <DialogContent data-testid="send-email-dialog">
          <DialogHeader>
            <DialogTitle>Wyslij fakture emailem</DialogTitle>
            <DialogDescription>
              Faktura {invoice.invoiceNumber} zostanie wyslana na podany adres email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email-to">Adres email odbiorcy</Label>
              <Input
                id="email-to"
                type="email"
                placeholder="klient@example.com"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                data-testid="email-input"
              />
              {invoice.clientEmail && emailTo !== invoice.clientEmail && (
                <button
                  type="button"
                  className="text-xs text-blue-600 hover:underline"
                  onClick={() => setEmailTo(invoice.clientEmail!)}
                >
                  Uzyj adresu klienta: {invoice.clientEmail}
                </button>
              )}
            </div>
            <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
              <p className="font-medium">Szczegoly wysylki:</p>
              <p className="text-muted-foreground">
                Dokument: {invoice.type === "faktura" ? "Faktura VAT" : "Rachunek"} {invoice.invoiceNumber}
              </p>
              <p className="text-muted-foreground">
                Kwota: {parseFloat(invoice.amount).toFixed(2)} PLN
              </p>
              <p className="text-muted-foreground">
                Odbiorca: {invoice.companyName || invoice.clientName || `${invoice.clientFirstName || ""} ${invoice.clientLastName || ""}`.trim() || "Klient"}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEmailDialog(false)}
              disabled={sending}
            >
              Anuluj
            </Button>
            <Button
              onClick={handleSendEmail}
              disabled={sending || !emailTo.trim()}
              data-testid="confirm-send-email-btn"
            >
              {sending ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Wysylanie...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Wyslij
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print styles - render as a <style> tag in the component */}
      <style jsx global>{`
        @media print {
          /* Hide everything outside the invoice preview */
          body * {
            visibility: hidden;
          }
          [data-testid="invoice-pdf-preview"],
          [data-testid="invoice-pdf-preview"] * {
            visibility: visible;
          }
          [data-testid="invoice-pdf-preview"] {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          /* Ensure text colors are readable on print */
          .text-muted-foreground {
            color: #4b5563 !important;
          }
        }
      `}</style>
    </div>
  );
}
