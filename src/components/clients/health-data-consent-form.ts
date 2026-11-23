/**
 * Zgoda na zapis informacji o zdrowiu w formularzu kartoteki klienta.
 *
 * Reguła wysyłki (nieaktualna karta przeglądarki nie może nadać zgody na nowo
 * ani przywrócić alergii):
 *   - `healthDataConsent: true` tylko wtedy, gdy zgoda w danych wczytanych do
 *     formularza była pusta, a personel sam zaznaczył pole w tej sesji edycji;
 *   - `healthDataConsent: false` tylko wtedy, gdy zgoda była zapisana, a personel
 *     ją odznaczył (serwer zeruje wtedy alergie, więc `allergies` nie wysyłamy);
 *   - `allergies` tylko wtedy, gdy lista różni się od wczytanej;
 *   - bez zmian w zgodzie i alergiach żadnego z tych pól w żądaniu nie ma.
 */

import type { Employee } from "./types";

export interface HealthDataFormState {
  /** Czy zgoda była zapisana w danych wczytanych do formularza. */
  storedConsent: boolean;
  /** Stan pola zgody w formularzu. */
  consentChecked: boolean;
  /** Alergie wczytane do formularza (po serializacji listy, `null` = brak). */
  storedAllergies: string | null;
  /** Alergie w formularzu (po serializacji listy, `null` = brak). */
  allergies: string | null;
}

export interface HealthDataPatch {
  healthDataConsent?: boolean;
  allergies?: string | null;
}

/** Pola zgody i alergii do dołączenia do PUT — wyłącznie te zmienione. */
export function buildHealthDataPatch(state: HealthDataFormState): HealthDataPatch {
  const { storedConsent, consentChecked, storedAllergies, allergies } = state;

  if (storedConsent && !consentChecked) {
    // Cofnięcie zgody: serwer w tym samym UPDATE zeruje alergie.
    return { healthDataConsent: false };
  }

  const patch: HealthDataPatch = {};
  if (!storedConsent && consentChecked) {
    patch.healthDataConsent = true;
  }
  if (allergies !== storedAllergies) {
    patch.allergies = allergies;
  }
  return patch;
}

/**
 * Kto zapisał zgodę: „Ty” dla bieżącego konta, imię i nazwisko pracownika
 * z powiązanym kontem albo ogólny opis (np. konto właściciela bez karty
 * pracownika, konto już usunięte).
 */
export function describeConsentAuthor(
  consentBy: string | null,
  currentUserId: string | null | undefined,
  employees: Employee[]
): string {
  if (!consentBy) return "nieznane konto";
  if (currentUserId && consentBy === currentUserId) return "Ty";
  const employee = employees.find((e) => e.userId === consentBy);
  if (employee) return `${employee.firstName} ${employee.lastName}`;
  return "inne konto personelu salonu";
}

/** Data i godzina zapisu zgody w formacie polskim. */
export function formatConsentDate(consentAt: string): string {
  return new Date(consentAt).toLocaleString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
