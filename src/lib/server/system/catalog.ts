/**
 * Wyjścia systemowe: publiczna lista salonów dla `GET /api/salons` (katalog
 * bez sesji) i wyszukiwanie salonu po krótkim adresie `/s/<slug>`
 * (`findPublicSalonIdBySlug`, opis przy funkcji).
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
import { isValidSalonSlug } from "@/lib/salon-slug";
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

/**
 * Id salonu o krótkim adresie `slug` albo null (strona `/s/[slug]`, bez sesji).
 *
 * Dlaczego pula systemowa: przed odczytem nie znamy salonu, więc nie ma id
 * dla `forSalon`, a polityka RLS `salons` (tenant_self) przepuszcza tylko
 * wiersz o id = kontekst.
 *
 * Co jest publiczne: ta sama reguła co na stronie `/salons/[id]` i w
 * `GET /api/salons/[id]` — każdy istniejący salon (schemat nie ma flagi
 * „salon aktywny”, a strona salonu nie sprawdza subskrypcji). Dodatkowo salon
 * musi mieć slug (wiersz bez sluga nie ma krótkiego adresu).
 *
 * Wejście z adresu: wielkie litery sprowadzane do małych (`/s/Salon-Ada`
 * = `/s/salon-ada`); napis, który nie jest poprawnym slugiem (format, długość,
 * słowo zastrzeżone), daje null BEZ zapytania do bazy. Zapytanie czyta
 * wyłącznie `id` (bez `settings_json`, `owner_id` i pozostałych kolumn),
 * a warunek to równość — slug idzie jako parametr, nie jako wzorzec.
 *
 * Błąd bazy propaguje do wołającego.
 */
export async function findPublicSalonIdBySlug(slug: string): Promise<string | null> {
  const normalized = slug.toLowerCase();
  if (!isValidSalonSlug(normalized)) return null;

  const [row] = await dbSystem
    .select({ id: salons.id })
    .from(salons)
    .where(eq(salons.slug, normalized))
    .limit(1);
  return row?.id ?? null;
}
