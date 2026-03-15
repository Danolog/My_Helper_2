export interface ServiceVariant {
  id: string;
  serviceId: string;
  name: string;
  priceModifier: string | null;
  durationModifier: number | null;
}

export interface ServiceItem {
  id: string;
  name: string;
  basePrice: string;
  baseDuration: number;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  variants: ServiceVariant[];
}

export interface ServiceCategory {
  id: string;
  name: string;
  sortOrder: number | null;
}

export interface EmployeeProfile {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  photoUrl: string | null;
  color: string | null;
  specialties: string[];
  averageRating: number | null;
  reviewCount: number;
  galleryCount: number;
}

export interface SalonDetail {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  industryType: string | null;
  services: ServiceItem[];
  categories: ServiceCategory[];
  employees: EmployeeProfile[];
  averageRating: number | null;
}

export interface CategorizedServiceGroup {
  categoryId: string | null;
  categoryName: string;
  services: ServiceItem[];
}
