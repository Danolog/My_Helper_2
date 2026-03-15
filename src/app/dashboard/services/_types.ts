export interface ServiceCategory {
  id: string;
  salonId: string;
  name: string;
  sortOrder: number | null;
  createdAt: string;
}

export interface Service {
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
}

/** Grouped services by category, used in the services tab view */
export interface ServiceGroup {
  category: ServiceCategory | null;
  services: Service[];
}

/** Sentinel value used in the category Select to represent "no category" */
export const NO_CATEGORY = "__none";
