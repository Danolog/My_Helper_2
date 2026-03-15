export { ClientProfileHeader } from "./client-profile-header";
export { ClientProfileTab } from "./client-profile-tab";
export { ClientContactCard } from "./client-contact-card";
export { ClientFavoriteEmployeeCard } from "./client-favorite-employee-card";
export { ClientDepositCard } from "./client-deposit-card";
export { ClientHealthPreferencesCard } from "./client-health-preferences-card";
export { ClientConsentsCard } from "./client-consents-card";
export { ClientHistoryTab } from "./client-history-tab";
export { ClientLoyaltyTab } from "./client-loyalty-tab";
export type {
  ClientData,
  AppointmentData,
  AppointmentEmployee,
  AppointmentService,
  TreatmentData,
  MaterialProduct,
  MaterialData,
  LoyaltyTransaction,
  LoyaltyData,
  RewardItem,
  RewardsData,
  ConsentStatus,
  Employee,
} from "./types";
export {
  parseCommaSeparated,
  serializeCommaSeparated,
  getStatusLabel,
  getStatusVariant,
  formatDuration,
  NO_FAVORITE,
} from "./utils";
