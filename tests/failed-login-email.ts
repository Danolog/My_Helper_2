import { randomUUID } from 'node:crypto';

/**
 * E-mail do testow NIEUDANEGO logowania — unikalny na przebieg (proces runnera).
 *
 * Dlaczego: aplikacja moze liczyc nieudane proby logowania na konto (takze
 * nieistniejace), w oknie czasowym. Staly adres testowy sumowalby proby
 * z kolejnych przebiegow i zwykly test dostalby 429 zaleznie od historii bazy.
 * Konto o tym adresie nie istnieje w zadnym trybie — wynik logowania sie nie
 * zmienia, zmienia sie tylko klucz licznika.
 *
 * Jedno zrodlo dla wszystkich specow z nieudanym logowaniem.
 */
const RUN_ID = `${Date.now().toString(36)}${randomUUID().slice(0, 8)}`;

export function failedLoginEmail(): string {
  return `wrong+${RUN_ID}@example.com`;
}
