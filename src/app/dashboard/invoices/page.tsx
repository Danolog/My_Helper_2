"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  ArrowLeft,
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/lib/auth-client";
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
  appointmentId: string | null;
  clientId: string | null;
  clientFirstName: string | null;
  clientLastName: string | null;
  employeeFirstName: string | null;
  employeeLastName: string | null;
  serviceName: string | null;
  appointmentStartTime: string | null;
}

interface InvoiceSummary {
  totalInvoices: number;
  totalAmount: string;
  totalVat: string;
  totalNet: string;
  paragonCount: number;
  fakturaCount: number;
}

export default function InvoicesPage() {
  const router = useRouter();
  const urlSearchParams = useSearchParams();
  const pathname = usePathname();
  const { data: session, isPending } = useSession();
  const [invoicesList, setInvoicesList] = useState<Invoice[]>([]);
  const [summary, setSummary] = useState<InvoiceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters - initialize from URL params for persistence
  const [dateFrom, setDateFrom] = useState(urlSearchParams.get("dateFrom") || "");
  const [dateTo, setDateTo] = useState(urlSearchParams.get("dateTo") || "");
  const [typeFilter, setTypeFilter] = useState(urlSearchParams.get("type") || "all");
  const [searchQuery, setSearchQuery] = useState(urlSearchParams.get("q") || "");

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (typeFilter && typeFilter !== "all") params.set("type", typeFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const res = await fetch(`/api/invoices?${params}`);
      const json = await res.json();
      if (json.success) {
        setInvoicesList(json.data);
        setSummary(json.summary);
      } else {
        toast.error(json.error || "Nie udalo sie pobrac faktur");
      }
    } catch {
      toast.error("Blad polaczenia z serwerem");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, typeFilter, searchQuery]);

  useEffect(() => {
    if (session) {
      fetchInvoices();
    }
  }, [session, fetchInvoices]);

  // Sync filter state to URL for persistence
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (typeFilter && typeFilter !== "all") params.set("type", typeFilter);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [searchQuery, dateFrom, dateTo, typeFilter, router, pathname]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const getPaymentMethodLabel = (method: string | null) => {
    switch (method) {
      case "cash":
        return "Gotowka";
      case "card":
        return "Karta";
      case "transfer":
        return "Przelew";
      default:
        return method || "—";
    }
  };

  if (isPending) {
    return (
      <div className="flex justify-center items-center h-64">Loading...</div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto p-6 text-center">
        <p>Musisz byc zalogowany aby zobaczyc faktury.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold" data-testid="invoices-title">
            Historia faktur
          </h1>
          <p className="text-muted-foreground">
            Przegladaj wszystkie wystawione faktury i rachunki
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <Label>Od daty</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                data-testid="date-from-input"
              />
            </div>
            <div>
              <Label>Do daty</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                data-testid="date-to-input"
              />
            </div>
            <div>
              <Label>Typ</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[160px]" data-testid="type-filter">
                  <SelectValue placeholder="Wszystkie" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Wszystkie</SelectItem>
                  <SelectItem value="paragon">Rachunek</SelectItem>
                  <SelectItem value="faktura">Faktura VAT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label>Szukaj</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Numer faktury, klient, firma..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  maxLength={200}
                  data-testid="search-input"
                />
              </div>
            </div>
            <Button
              onClick={fetchInvoices}
              variant="outline"
              data-testid="refresh-btn"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Odswiez
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Liczba faktur
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="total-invoices">
                {summary.totalInvoices}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {summary.paragonCount} rachunkow, {summary.fakturaCount} faktur VAT
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Kwota brutto
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="total-amount">
                {parseFloat(summary.totalAmount).toFixed(2)} PLN
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Kwota netto
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="total-net">
                {parseFloat(summary.totalNet).toFixed(2)} PLN
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                VAT
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="total-vat">
                {parseFloat(summary.totalVat).toFixed(2)} PLN
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Invoice List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : invoicesList.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {searchQuery.trim() || dateFrom || dateTo || (typeFilter && typeFilter !== "all") ? (
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
      ) : (
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
                onClick={() => toggleExpand(invoice.id)}
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
                    router.push(`/dashboard/invoices/${invoice.id}`);
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
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
