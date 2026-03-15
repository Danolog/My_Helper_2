/**
 * Shared TypeScript interfaces for client detail page components.
 * These types represent the data structures returned by the client-related API endpoints.
 */

export interface ClientData {
  id: string;
  salonId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  preferences: string | null;
  allergies: string | null;
  favoriteEmployeeId: string | null;
  birthday: string | null;
  requireDeposit: boolean | null;
  depositType: string | null;
  depositValue: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentEmployee {
  id: string;
  firstName: string;
  lastName: string;
  color: string | null;
}

export interface AppointmentService {
  id: string;
  name: string;
  basePrice: string;
  baseDuration: number;
}

export interface TreatmentData {
  id: string;
  recipe: string | null;
  techniques: string | null;
  materialsJson: unknown[];
  notes: string | null;
  createdAt: string;
}

export interface MaterialProduct {
  id: string;
  name: string;
  category: string | null;
  quantity: string | null;
  unit: string | null;
  pricePerUnit: string | null;
}

export interface MaterialData {
  id: string;
  appointmentId: string;
  productId: string;
  quantityUsed: string;
  notes: string | null;
  createdAt: string;
  product: MaterialProduct | null;
}

export interface AppointmentData {
  id: string;
  salonId: string;
  clientId: string;
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
  employee: AppointmentEmployee | null;
  service: AppointmentService | null;
  treatment: TreatmentData | null;
  materials: MaterialData[];
}

export interface LoyaltyTransaction {
  id: string;
  pointsChange: number;
  reason: string | null;
  appointmentId: string | null;
  createdAt: string;
}

export interface LoyaltyData {
  clientId: string;
  salonId: string;
  points: number;
  loyaltyId: string | null;
  transactions: LoyaltyTransaction[];
  lastUpdated: string | null;
}

export interface RewardItem {
  id: string;
  name: string;
  pointsRequired: number;
  rewardType: "discount" | "free_service" | "product";
  rewardValue: number;
  description: string;
  canRedeem: boolean;
  pointsNeeded: number;
}

export interface RewardsData {
  enabled: boolean;
  points: number;
  availableRewards: RewardItem[];
  allRewards: RewardItem[];
}

export interface ConsentStatus {
  type: "email" | "sms" | "phone";
  granted: boolean;
  grantedAt: string | null;
}

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  color: string | null;
}
