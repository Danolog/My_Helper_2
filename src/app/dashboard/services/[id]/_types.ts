export interface ServiceVariant {
  id: string;
  serviceId: string;
  name: string;
  priceModifier: string;
  durationModifier: number;
  createdAt: string;
}

export interface ServiceCategory {
  id: string;
  salonId: string;
  name: string;
  sortOrder: number | null;
  createdAt: string;
}

export interface ServiceDetail {
  id: string;
  salonId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  basePrice: string;
  baseDuration: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  category: ServiceCategory | null;
  variants: ServiceVariant[];
}

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  color: string | null;
}

export interface EmployeePrice {
  id: string;
  employeeId: string;
  serviceId: string;
  variantId: string | null;
  customPrice: string;
  createdAt: string;
  employee: Employee | null;
  variant: ServiceVariant | null;
}

export interface Product {
  id: string;
  name: string;
  category: string | null;
  unit: string | null;
  quantity: string | null;
  minQuantity: string | null;
}

export interface ServiceProductLink {
  id: string;
  serviceId: string;
  productId: string;
  defaultQuantity: string;
  createdAt: string;
  productName: string | null;
  productCategory: string | null;
  productUnit: string | null;
  productQuantity: string | null;
  productMinQuantity: string | null;
}

export interface GalleryPhoto {
  id: string;
  afterPhotoUrl: string | null;
  beforePhotoUrl: string | null;
  description: string | null;
  employeeFirstName: string | null;
  employeeLastName: string | null;
  serviceName: string | null;
  createdAt: string;
}

/** Format a numeric price string to 2 decimal places */
export function formatPrice(price: string): string {
  return parseFloat(price).toFixed(2);
}

/** Format a duration in minutes to a human-readable string */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs}h ${mins}min` : `${hrs}h`;
}

/** Format a modifier value with optional prefix/suffix and +/- sign */
export function formatModifier(
  value: string | number,
  prefix: string = "",
  suffix: string = "",
): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (num === 0) return `${prefix}0${suffix}`;
  return num > 0 ? `${prefix}+${num}${suffix}` : `${prefix}${num}${suffix}`;
}
