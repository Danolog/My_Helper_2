/**
 * Rejestr wyjść systemowych (#193, R-Z1): zamknięta lista funkcji, którymi
 * kod spoza `system/**` sięga do puli systemowej. Każda pozycja to nazwana
 * funkcja async zwracająca dane (Z7 + W2) — bez puli, transakcji i callbacków.
 *
 * Pula (`db-system.ts`) i adapter Better Auth (`auth-adapter.ts`) NIE wychodzą
 * przez rejestr: pierwszą wolno importować tylko w `system/**` (lint), drugą
 * wyłącznie `src/lib/auth.ts` (test skanu importów).
 *
 * Zmiana tej listy = zmiana migawki w __tests__/lib/system-registry.test.ts.
 */
export {
  getActiveTemporaryAccess,
  getUserSalon,
  getUserSalonId,
  hasTemporaryAccess,
  isSalonOwner,
  resolveSalonContext,
  revokeSalonGrantsForUser,
} from "./session";
export type { SalonContext, SalonContextResolution, SalonRole } from "./session";
export { cleanupExpiredTemporaryAccess } from "./cron";
export { checkDatabase, pingDatabase } from "./health";
export { clearSignInFailures, consumeAuthRateLimit, reserveAccountSignInAttempt } from "./auth-throttle";
export { cleanupStaleDepositBookings } from "./deposits-cleanup";
export type { StaleDepositCleanupResult } from "./deposits-cleanup";
export { ensurePlansExist } from "./plans";
export { seedDemoData } from "./seed";
export type { SeedDemoRefusal, SeedDemoResult } from "./seed";
export {
  countPushSubscriptions,
  deleteUndeliverablePushSubscriptions,
  findDueAppointmentReminders,
  findDuePushReminders,
  findDueSmsReminders,
  getPendingCronReminders,
  getPushSubscriptionsForUser,
  getUserIdsWithPushSubscriptions,
  markAppointmentRemindersSent,
  markCronRemindersSent,
} from "./notifications";
export type {
  AppointmentReminderCandidate,
  CronReminderKind,
  PendingCronReminder,
  PushReminderCandidate,
  PushSubscriptionForSend,
  ReminderWindow,
  SmsReminderCandidate,
} from "./notifications";
export { resolveWaitingListToken } from "./waiting-list";
export type { WaitingListTokenTarget } from "./waiting-list";
