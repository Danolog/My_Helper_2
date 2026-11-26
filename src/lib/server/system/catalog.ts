/**
 * Wyjście systemowe: publiczna lista salonów dla `GET /api/salons` (katalog
 * bez sesji).
 *
 * Dlaczego pula systemowa, a nie `forSalon`: `salons` to tabela korzenia
 * najemcy, a lista z natury obejmuje wiele salonów naraz — nie ma jednego
 * salonu, na który dałoby się ustawić kontekst RLS. Osobna polityka SELECT
 * „wszystkie salony” dla roli aplikacji nie wchodzi w grę: RLS działa po
 * wierszach, nie po kolumnach, więc odsłoniłaby `settings_json` (m.in. numer
 * BLIK) każdemu zapytaniu w kontekście dowolnego salonu.
 *
 * Co czyta (wyłącznie jawne listy kolumn):
 * - `salons`: id, name, phone, email, address, industry_type — tylko salony
 *   z niepustym adresem, telefonem i branżą (odsiewa salony testowe/niepełne);
 * - `services`: liczba aktywnych usług na salon;
 * - `reviews`: średnia ocena i liczba opinii `approved` na salon — tylko gdy
 *   moduł opinii nie jest zamrożony; zamrożony = bez zapytania, ocena null
 *   i liczba opinii 0.
 *
 * Czego NIE czyta: `settings_json`, `owner_id` ani żadnej innej kolumny
 * salonu spoza DTO; żadnych danych pracowników, klientów ani wizyt.
 *
 * Błąd bazy propaguje do wołającego.
 */
import { and, avg, count, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { isModuleFrozen } from "@/lib/features";
import { reviews, salons, services } from "@/lib/schema";
import { dbSystem } from "./db-system";

/** Pozycja publicznej listy salonów — dokładnie pola odpowiedzi `GET /api/salons`. */
export interface PublicSalonCatalogEntry {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  industryType: string | null;
  serviceCount: number;
  averageRating: number | null;
  reviewCount: number;
}

/**
 * Zwraca publiczną listę salonów z liczbą aktywnych usług i statystyką
 * zatwierdzonych opinii. Salony z co najmniej jedną aktywną usługą są na początku
 * (sortowanie stabilne, w obrębie grupy kolejność z bazy).
 */
export async function listPublicSalonCatalog(): Promise<PublicSalonCatalogEntry[]> {
  const listedSalons = await dbSystem
    .select({
      id: salons.id,
      name: salons.name,
      phone: salons.phone,
      email: salons.email,
      address: salons.address,
      industryType: salons.industryType,
    })
    .from(salons)
    .where(
      and(
        isNotNull(salons.address),
        ne(salons.address, ""),
        isNotNull(salons.phone),
        ne(salons.phone, ""),
        isNotNull(salons.industryType),
        ne(salons.industryType, "")
      )
    );

  if (listedSalons.length === 0) return [];

  const salonIds = listedSalons.map((s) => s.id);

  const serviceCounts = await dbSystem
    .select({
      salonId: services.salonId,
      serviceCount: count(services.id),
    })
    .from(services)
    .where(and(inArray(services.salonId, salonIds), eq(services.isActive, true)))
    .groupBy(services.salonId);

  const reviewStats = isModuleFrozen("reviews")
    ? []
    : await dbSystem
        .select({
          salonId: reviews.salonId,
          averageRating: avg(reviews.rating),
          reviewCount: count(reviews.id),
        })
        .from(reviews)
        .where(and(inArray(reviews.salonId, salonIds), eq(reviews.status, "approved")))
        .groupBy(reviews.salonId);

  const serviceCountMap = new Map(serviceCounts.map((sc) => [sc.salonId, Number(sc.serviceCount)]));
  const reviewStatsMap = new Map(
    reviewStats.map((rs) => [
      rs.salonId,
      {
        // avg() z Postgresa przychodzi jako napis (numeric); zaokrąglenie do 0,1.
        averageRating: rs.averageRating
          ? Math.round(parseFloat(String(rs.averageRating)) * 10) / 10
          : null,
        reviewCount: Number(rs.reviewCount),
      },
    ])
  );

  return listedSalons
    .map((salon) => ({
      id: salon.id,
      name: salon.name,
      phone: salon.phone,
      email: salon.email,
      address: salon.address,
      industryType: salon.industryType,
      serviceCount: serviceCountMap.get(salon.id) ?? 0,
      averageRating: reviewStatsMap.get(salon.id)?.averageRating ?? null,
      reviewCount: reviewStatsMap.get(salon.id)?.reviewCount ?? 0,
    }))
    .sort((a, b) => (b.serviceCount > 0 ? 1 : 0) - (a.serviceCount > 0 ? 1 : 0));
}
