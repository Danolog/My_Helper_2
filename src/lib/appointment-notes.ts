/**
 * Pole `notes` w PUT /api/appointments/[id] z dialogu edycji (#90, Ethan).
 *
 * Dialog wysyła `notes` TYLKO, gdy użytkownik je zmienił. PUT od #90 odrzuca
 * notatki dłuższe niż APPOINTMENT_NOTES_MAX_LENGTH (400), a wizyty sprzed
 * limitu mogą mieć dłuższe — gdyby dialog zawsze dosyłał notatki, sama zmiana
 * godziny takiej wizyty kończyłaby się 400. Brak pola = serwer nie rusza
 * notatek (undefined w schemacie).
 *
 * Porównanie po normalizacji serwera: same spacje / pusty tekst = null, więc
 * dopisanie spacji na końcu albo wyczyszczenie już pustych notatek to nie
 * zmiana.
 */
export function notesChange(
  edited: string,
  original: string | null
): { notes?: string | null } {
  const next = edited.trim() || null;
  const previous = original?.trim() || null;
  return next === previous ? {} : { notes: next };
}
