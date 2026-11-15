/**
 * Payload POST /api/deposits/create-session budowany przez portal rezerwacji
 * (useBookingData.handleBookAppointment). Czysta funkcja, żeby test kontraktu
 * (__tests__/api/deposits-create-session-contract.test.ts) wysyłał do trasy
 * DOKŁADNIE to, co wysyła formularz — bez ręcznie przepisanej kopii.
 *
 * Kształt celowo bez zmian względem formularza sprzed wyciągnięcia
 * (clientId: null, variantId: null bez wariantu, guestEmail: null bez e-maila,
 * telefon w formacie wpisanym przez gościa). Tolerancję null i formatu
 * telefonu zapewnia schemat serwera (depositCreateSessionSchema) — także dla
 * starych wersji frontu z pamięci podręcznej PWA.
 */
export interface DepositBodyInput {
  salonId: string;
  employeeId: string;
  serviceId: string;
  /** "" = usługa bez wariantu */
  variantId: string;
  startTime: Date;
  endTime: Date;
  notes: string;
  depositAmount: number;
  paymentMethod: string;
  /** false = gość (bez sesji): dochodzą pola guest* */
  isLoggedIn: boolean;
  guestName: string;
  guestPhone: string;
  guestEmail: string;
}

export function buildDepositBody(input: DepositBodyInput) {
  return {
    salonId: input.salonId,
    clientId: null,
    employeeId: input.employeeId,
    serviceId: input.serviceId,
    variantId: input.variantId || null,
    startTime: input.startTime.toISOString(),
    endTime: input.endTime.toISOString(),
    notes: input.notes,
    depositAmount: input.depositAmount,
    paymentMethod: input.paymentMethod,
    ...(!input.isLoggedIn
      ? {
          guestName: input.guestName.trim(),
          guestPhone: input.guestPhone.trim(),
          guestEmail: input.guestEmail.trim() || null,
        }
      : {}),
  };
}
