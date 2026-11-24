/**
 * Anonimizacja danych klienta przed usunięciem jego kartoteki.
 *
 * Wołający uruchamia funkcję w TEJ SAMEJ transakcji, w której potem usuwa
 * wiersz `clients`, i PRZED tym usunięciem: klucze obce do `clients` mają
 * `ON DELETE SET NULL`, więc po usunięciu nie da się już ustalić, które
 * wizyty, powiadomienia, rozmowy i opinie należały do klienta.
 *
 * Zostaje (biała lista): data i czas wizyty, usługa, wariant, pracownik,
 * status, kwoty (cena, rabat, zadatek i jego status), ocena opinii.
 * Znika (NULL albo stały tekst): wolny tekst i dane kontaktowe powiązane
 * z klientem przez `client_id` albo przez jego wizyty, a także wskazanie
 * konta portalu, z którego zarezerwowano wizytę (`booked_by_user_id`).
 *
 * Poza zakresem z założenia:
 * - faktury i paragony fiskalne (tabela faktur i tabela paragonów) —
 *   dokumenty rozliczeniowe przechowywane przez okres wymagany przepisami
 *   podatkowymi;
 * - wizyty gościa bez `client_id` — dopasowanie po telefonie lub e-mailu jest
 *   zawodne i groziłoby anonimizacją cudzych danych;
 * - tabele usuwane kaskadą razem z kartoteką (`waiting_list`,
 *   `marketing_consents`, `loyalty_points` → `loyalty_transactions`).
 *
 * Rozdzielenie salonów: `tx` pochodzi z `forSalon(salonId).raw(...)` (rola
 * bez BYPASSRLS i kontekst salonu), a każde zapytanie ma dodatkowo jawny
 * warunek `salon_id` — bezpośrednio albo przez wizytę tego salonu w tabelach
 * bez własnej kolumny `salon_id`.
 *
 * Blokady wierszy i `lock_timeout` ustawione tutaj obowiązują do końca
 * transakcji wołającego (`SET LOCAL`, `FOR UPDATE`), nie tylko do powrotu
 * z funkcji — także dla jego późniejszego `DELETE clients`.
 */
import { and, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import {
  aiConversations,
  appointmentMaterials,
  appointments,
  clients,
  notifications,
  reviews,
  treatmentHistory,
} from "@/lib/schema";
import type { DbTx } from "@/lib/server/repository";

/** Stała treść w miejsce wiadomości (kolumna `notifications.message` jest NOT NULL). */
export const REMOVED_MESSAGE_PLACEHOLDER = "[treść usunięta]";

/**
 * Limit czekania na blokadę wiersza klienta i wierszy powiązanych. Dłuższe
 * czekanie oznacza równoległy zapis; transakcja się wycofuje, a wołający
 * może ponowić usunięcie.
 */
const LOCK_TIMEOUT = "5s";

/** Liczba wierszy zmienionych w każdej tabeli. */
export type ClientAnonymizationCounts = {
  appointments: number;
  treatmentHistory: number;
  appointmentMaterials: number;
  notifications: number;
  aiConversations: number;
  reviews: number;
};

const ZERO_COUNTS: ClientAnonymizationCounts = {
  appointments: 0,
  treatmentHistory: 0,
  appointmentMaterials: 0,
  notifications: 0,
  aiConversations: 0,
  reviews: 0,
};

/** Status wizyty odwołanej. */
const CANCELLED_STATUS = "cancelled";

/** Wizyty klienta, które blokują usunięcie kartoteki. */
export type ClientRemovalBlockers = {
  /** Wizyty z terminem w przyszłości i statusem innym niż odwołana. */
  futureAppointments: number;
  /** Wizyty odwołane z wpłaconym zadatkiem (`deposit_paid = true`). */
  depositsToRefund: number;
};

/**
 * Blokady przed usunięciem kartoteki, w tej kolejności:
 * 1. `SET LOCAL lock_timeout`;
 * 2. wiersz klienta `FOR UPDATE` — chroni tabele z `client_id`
 *    (`appointments`, `notifications`, `ai_conversations`, `reviews`):
 *    wstawienie albo przepięcie wiersza na tego klienta sprawdza klucz obcy
 *    blokadą `FOR KEY SHARE` na kliencie i czeka do końca transakcji;
 * 3. wizyty klienta w tym salonie `FOR UPDATE` — chroni tabele powiązane
 *    tylko przez `appointment_id` (`treatment_history`,
 *    `appointment_materials`, `reviews` bez `client_id`): ich wstawienie bierze
 *    `FOR KEY SHARE` na wizycie, a ta wyklucza się z `FOR UPDATE`. Sam
 *    `UPDATE appointments` nie wystarczy — zmienia kolumny niekluczowe,
 *    więc bierze tylko `FOR NO KEY UPDATE`, zgodne z `FOR KEY SHARE`.
 * Obie blokady czekają najwyżej `LOCK_TIMEOUT`; po nim Postgres zgłasza
 * 55P03 i transakcja wołającego się wycofuje.
 *
 * Ponowne wywołanie w tej samej transakcji niczego nie zmienia (blokady już
 * należą do niej), więc wołający może zablokować, sprawdzić warunki usunięcia
 * i dopiero potem wywołać `anonymizeClientData`.
 *
 * @returns `false`, gdy klienta nie ma w `salonId` — wtedy bez blokady wizyt.
 */
export async function lockClientForRemoval(tx: DbTx, salonId: string, clientId: string): Promise<boolean> {
  await tx.execute(sql.raw(`set local lock_timeout = '${LOCK_TIMEOUT}'`));

  const locked = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.salonId, salonId)))
    .for("update");
  if (locked.length === 0) return false;

  await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(and(eq(appointments.clientId, clientId), eq(appointments.salonId, salonId)))
    .for("update");
  return true;
}

/**
 * Liczy wizyty klienta, które blokują usunięcie kartoteki:
 * - przyszłe i nieodwołane — po usunięciu klient przyszedłby na termin bez
 *   kontaktu i bez wiadomości o odwołaniu;
 * - odwołane z wpłaconym zadatkiem — zwrot wymaga kontaktu z klientem.
 * Zadatek przy wizycie zakończonej albo nieobecności nie blokuje: jest
 * rozliczony albo przepadł.
 *
 * Wołać po `lockClientForRemoval` w tej samej transakcji: zbiór wizyt
 * klienta jest wtedy stały, więc równoległa rezerwacja nie wejdzie między
 * liczenie a usunięcie. „Teraz” to czas aplikacji przekazany tak samo, jak
 * aplikacja zapisuje terminy (kolumna bez strefy, wartości w UTC), a nie
 * `now()` bazy, które zależałoby od strefy sesji.
 */
export async function countClientRemovalBlockers(
  tx: DbTx,
  salonId: string,
  clientId: string,
  now: Date = new Date()
): Promise<ClientRemovalBlockers> {
  const isUpcoming = and(gt(appointments.startTime, now), ne(appointments.status, CANCELLED_STATUS));
  const isDepositToRefund = and(eq(appointments.status, CANCELLED_STATUS), eq(appointments.depositPaid, true));
  const [row] = await tx
    .select({
      futureAppointments: sql<number>`(count(*) filter (where ${isUpcoming}))::int`,
      depositsToRefund: sql<number>`(count(*) filter (where ${isDepositToRefund}))::int`,
    })
    .from(appointments)
    .where(and(eq(appointments.clientId, clientId), eq(appointments.salonId, salonId)));
  return {
    futureAppointments: Number(row?.futureAppointments ?? 0),
    depositsToRefund: Number(row?.depositsToRefund ?? 0),
  };
}

/**
 * Zeruje dane osobowe klienta w tabelach powiązanych z jego kartoteką.
 *
 * Zanim padnie pierwszy `UPDATE`, bierze blokady z `lockClientForRemoval`
 * (opis, która blokada chroni które tabele, jest tam).
 *
 * Wizyty klienta tracą też `booked_by_user_id`: inaczej wizyta dalej
 * wskazywałaby konto portalu klienta (imię i e-mail), a klient widziałby ją
 * w „Moich wizytach”. Samo konto portalu zostaje nietknięte.
 *
 * Klient spoza `salonId` (albo nieistniejący) → nic się nie zmienia, wynik
 * z samymi zerami. Wołający rozpoznaje brak klienta wcześniej (404).
 *
 * @throws Error gdy `salonId` albo `clientId` jest pusty.
 */
export async function anonymizeClientData(
  tx: DbTx,
  salonId: string,
  clientId: string
): Promise<ClientAnonymizationCounts> {
  if (!salonId || !clientId) {
    throw new Error("anonymizeClientData: salonId i clientId wymagane");
  }

  if (!(await lockClientForRemoval(tx, salonId, clientId))) {
    return { ...ZERO_COUNTS };
  }

  const isClientAppointment = and(
    eq(appointments.clientId, clientId),
    eq(appointments.salonId, salonId)
  );

  // Wizyty klienta w tym salonie — źródło dla tabel bez własnego `salon_id`.
  const clientAppointmentIds = tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(isClientAppointment);

  // `materials_json` (lista materiałów zapisywana przez salon dowolnym JSON-em)
  // wraca do pustej listy — tę samą wartość zapisuje UI i zakończenie wizyty.
  const treatmentRows = await tx
    .update(treatmentHistory)
    .set({ notes: null, recipe: null, techniques: null, materialsJson: sql`'[]'::jsonb` })
    .where(inArray(treatmentHistory.appointmentId, clientAppointmentIds))
    .returning({ id: treatmentHistory.id });

  const materialRows = await tx
    .update(appointmentMaterials)
    .set({ notes: null })
    .where(inArray(appointmentMaterials.appointmentId, clientAppointmentIds))
    .returning({ id: appointmentMaterials.id });

  const appointmentRows = await tx
    .update(appointments)
    .set({ guestName: null, guestPhone: null, guestEmail: null, notes: null, bookedByUserId: null })
    .where(isClientAppointment)
    .returning({ id: appointments.id });

  const notificationRows = await tx
    .update(notifications)
    .set({ message: REMOVED_MESSAGE_PLACEHOLDER })
    .where(and(eq(notifications.clientId, clientId), eq(notifications.salonId, salonId)))
    .returning({ id: notifications.id });

  const conversationRows = await tx
    .update(aiConversations)
    .set({ transcript: null })
    .where(and(eq(aiConversations.clientId, clientId), eq(aiConversations.salonId, salonId)))
    .returning({ id: aiConversations.id });

  // Opinia klienta: po `client_id` albo po jego wizycie — opinia z portalu
  // dostaje `client_id` wizyty z chwili wystawienia, więc wizyta gościa
  // dopisana później do kartoteki zostawia opinię z `client_id = NULL`.
  // Odpowiedź salonu (szablony zaczynają się od imienia i nazwiska klienta)
  // znika razem z treścią. Ocena zostaje; autora nie ma w `reviews`, widoki
  // biorą imię z `clients`, które znika przy usunięciu kartoteki.
  const reviewRows = await tx
    .update(reviews)
    .set({ comment: null, ownerResponse: null, ownerResponseAt: null })
    .where(
      and(
        eq(reviews.salonId, salonId),
        or(eq(reviews.clientId, clientId), inArray(reviews.appointmentId, clientAppointmentIds))
      )
    )
    .returning({ id: reviews.id });

  return {
    appointments: appointmentRows.length,
    treatmentHistory: treatmentRows.length,
    appointmentMaterials: materialRows.length,
    notifications: notificationRows.length,
    aiConversations: conversationRows.length,
    reviews: reviewRows.length,
  };
}
