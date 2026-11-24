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
 * z klientem przez `client_id` albo przez jego wizyty.
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
import { and, eq, inArray, or, sql } from "drizzle-orm";
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

/**
 * Zeruje dane osobowe klienta w tabelach powiązanych z jego kartoteką.
 *
 * Blokady, zanim padnie pierwszy `UPDATE`:
 * 1. wiersz klienta `FOR UPDATE` — chroni tabele z `client_id`
 *    (`appointments`, `notifications`, `ai_conversations`, `reviews`):
 *    wstawienie albo przepięcie wiersza na tego klienta sprawdza klucz obcy
 *    blokadą `FOR KEY SHARE` na kliencie i czeka do końca transakcji;
 * 2. wizyty klienta w tym salonie `FOR UPDATE` — chroni tabele powiązane
 *    tylko przez `appointment_id` (`treatment_history`,
 *    `appointment_materials`, `reviews` bez `client_id`): ich wstawienie bierze
 *    `FOR KEY SHARE` na wizycie, a ta wyklucza się z `FOR UPDATE`. Sam
 *    `UPDATE appointments` niżej nie wystarczy — zmienia kolumny niekluczowe,
 *    więc bierze tylko `FOR NO KEY UPDATE`, zgodne z `FOR KEY SHARE`.
 * Obie blokady czekają najwyżej `LOCK_TIMEOUT`; po nim Postgres zgłasza
 * 55P03 i transakcja wołającego się wycofuje.
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

  await tx.execute(sql.raw(`set local lock_timeout = '${LOCK_TIMEOUT}'`));

  const locked = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.salonId, salonId)))
    .for("update");
  if (locked.length === 0) {
    return { ...ZERO_COUNTS };
  }

  const isClientAppointment = and(
    eq(appointments.clientId, clientId),
    eq(appointments.salonId, salonId)
  );

  // Pełna blokada wizyt klienta (patrz JSDoc, punkt 2).
  await tx.select({ id: appointments.id }).from(appointments).where(isClientAppointment).for("update");

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
    .set({ guestName: null, guestPhone: null, guestEmail: null, notes: null })
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
