/**
 * Przestrzenie blokad subskrypcji (pierwszy argument dwuargumentowego
 * `pg_advisory_xact_lock`). Osobny moduł bez importu bazy — używają go też
 * testy (`pg_locks.classid`) i atrapa `tx`. Opis reguł: `subscription-locks.ts`.
 */
export const SUBSCRIPTION_LOCK_NAMESPACE = {
  stripeSub: 730_101,
  salon: 730_102,
} as const;
