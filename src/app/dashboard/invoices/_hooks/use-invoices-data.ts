"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";

export interface InvoiceItem {
  name: string;
  quantity: number;
  unitPrice: string;
  netPrice: string;
  total: string;
  vatRate: string;
}

export interface InvoiceDataJson {
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

export interface Invoice {
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

export interface InvoiceSummary {
  totalInvoices: number;
  totalAmount: string;
  totalVat: string;
  totalNet: string;
  paragonCount: number;
  fakturaCount: number;
}

interface UseInvoicesDataReturn {
  session: ReturnType<typeof useSession>["data"];
  isPending: boolean;
  invoicesList: Invoice[];
  summary: InvoiceSummary | null;
  loading: boolean;
  expandedId: string | null;
  dateFrom: string;
  dateTo: string;
  typeFilter: string;
  searchQuery: string;
  router: ReturnType<typeof useRouter>;
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  setTypeFilter: (value: string) => void;
  setSearchQuery: (value: string) => void;
  fetchInvoices: () => Promise<void>;
  toggleExpand: (id: string) => void;
  getPaymentMethodLabel: (method: string | null) => string;
}

export function useInvoicesData(): UseInvoicesDataReturn {
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

  return {
    session,
    isPending,
    invoicesList,
    summary,
    loading,
    expandedId,
    dateFrom,
    dateTo,
    typeFilter,
    searchQuery,
    router,
    setDateFrom,
    setDateTo,
    setTypeFilter,
    setSearchQuery,
    fetchInvoices,
    toggleExpand,
    getPaymentMethodLabel,
  };
}
