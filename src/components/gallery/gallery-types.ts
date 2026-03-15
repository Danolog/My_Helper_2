export interface GalleryPhoto {
  id: string;
  salonId: string;
  employeeId: string | null;
  serviceId: string | null;
  beforePhotoUrl: string | null;
  afterPhotoUrl: string | null;
  description: string | null;
  productsUsed: string | null;
  techniques: string | null;
  duration: number | null;
  showProductsToClients: boolean;
  createdAt: string;
  employeeFirstName: string | null;
  employeeLastName: string | null;
  serviceName: string | null;
}

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
}

export interface Service {
  id: string;
  name: string;
}

export interface Album {
  id: string;
  salonId: string;
  name: string;
  category: string | null;
  createdAt: string;
  photoCount: number;
}

export type CaptionPlatform = "instagram" | "facebook" | "tiktok";
