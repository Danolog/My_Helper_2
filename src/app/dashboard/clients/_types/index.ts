export interface Client {
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
  createdAt: string;
  updatedAt: string;
  lastVisit: string | null;
}

export interface ClientFiltersState {
  dateAddedFrom: string;
  dateAddedTo: string;
  lastVisitFrom: string;
  lastVisitTo: string;
  hasAllergies: boolean;
}

export const EMPTY_FILTERS: ClientFiltersState = {
  dateAddedFrom: "",
  dateAddedTo: "",
  lastVisitFrom: "",
  lastVisitTo: "",
  hasAllergies: false,
};
