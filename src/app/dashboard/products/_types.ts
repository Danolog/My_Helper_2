export interface Product {
  id: string;
  salonId: string;
  name: string;
  category: string | null;
  quantity: string | null;
  minQuantity: string | null;
  unit: string | null;
  pricePerUnit: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductCategory {
  id: string;
  salonId: string;
  name: string;
  sortOrder: number | null;
  createdAt: string;
  productCount: number;
}

export interface LowStockNotification {
  id: string;
  message: string;
  sentAt: string;
  createdAt: string;
}

/** Sentinel value used in the category Select to represent "no category" */
export const NO_CATEGORY = "__none__";

export const UNITS = ["ml", "g", "szt.", "opak.", "l", "kg"] as const;
