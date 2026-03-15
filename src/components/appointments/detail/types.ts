/** Shared type definitions for appointment detail sub-components. */

export interface AppointmentDetail {
  id: string;
  salonId: string;
  clientId: string | null;
  employeeId: string;
  serviceId: string | null;
  startTime: string;
  endTime: string;
  status: string;
  notes: string | null;
  depositAmount: string | null;
  depositPaid: boolean;
  createdAt: string;
  updatedAt: string;
  client: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
    allergies: string | null;
  } | null;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    color: string | null;
  } | null;
  service: {
    id: string;
    name: string;
    basePrice: string;
    baseDuration: number;
  } | null;
}

export interface MaterialRecord {
  id: string;
  appointmentId: string;
  productId: string;
  quantityUsed: string;
  notes: string | null;
  createdAt: string;
  product: {
    id: string;
    name: string;
    category: string | null;
    quantity: string | null;
    unit: string | null;
    pricePerUnit: string | null;
  } | null;
}

export interface Product {
  id: string;
  name: string;
  category: string | null;
  quantity: string | null;
  unit: string | null;
  pricePerUnit: string | null;
}

export interface TreatmentRecord {
  id: string;
  appointmentId: string;
  recipe: string | null;
  techniques: string | null;
  notes: string | null;
  materialsJson: unknown;
}

export interface CommissionRecord {
  id: string;
  employeeId: string;
  appointmentId: string;
  amount: string;
  percentage: string | null;
  paidAt: string | null;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
}

export interface RefundStatus {
  appointmentId: string;
  hasDeposit: boolean;
  depositAmount?: number;
  depositPaid?: boolean;
  paymentMethod?: string;
  paymentStatus?: string;
  refundStatus: string;
  refundAmount: number;
  forfeitedAmount?: number;
  refundedAt?: string;
  stripeRefundId?: string;
  refundReason?: string;
}

export interface InvoiceData {
  id: string;
  invoiceNumber: string;
  type: string;
  clientName: string | null;
  clientAddress: string | null;
  companyName: string | null;
  companyNip: string | null;
  amount: string;
  vatRate: string | null;
  vatAmount: string | null;
  netAmount: string | null;
  paymentMethod: string | null;
  description: string | null;
  issuedAt: string;
  invoiceDataJson: {
    seller: { name: string; address: string; nip: string | null };
    buyer: { name: string | null; address: string | null; nip: string | null };
    invoiceNumber: string;
    issueDate: string;
    items: Array<{
      name: string;
      quantity: number;
      unitPrice: string;
      netPrice: string;
      total: string;
      vatRate: string;
    }>;
    summary: {
      netAmount: string;
      vatRate: string;
      vatAmount: string;
      totalAmount: string;
    };
    paymentMethod: string;
    employee: string | null;
    appointmentDate: string;
    appointmentTime: string;
  } | null;
}

export interface FiscalReceiptData {
  id: string;
  receiptNumber: string;
  nip: string | null;
  clientName: string | null;
  employeeName: string | null;
  serviceName: string | null;
  servicePrice: string;
  materialsCost: string;
  totalAmount: string;
  vatRate: string;
  vatAmount: string;
  netAmount: string;
  paymentMethod: string;
  printerModel: string | null;
  printedAt: string;
  printStatus: string;
  receiptDataJson: {
    header: { line1: string; line2: string; line3: string; nip: string | null };
    receiptNumber: string;
    date: string;
    time: string;
    items: Array<{
      name: string;
      quantity: number;
      unitPrice: string;
      total: string;
      vatRate: string;
    }>;
    summary: {
      netAmount: string;
      vatRate: string;
      vatAmount: string;
      totalAmount: string;
    };
    paymentMethod: string;
    client: string | null;
    employee: string | null;
    appointmentDate: string;
    appointmentTime: string;
    footer: string;
  } | null;
}
