import { notFound, redirect } from "next/navigation";
import { findPublicSalonIdBySlug } from "@/lib/server/system";

/**
 * Krótki adres salonu `/s/<slug>` — link, kod QR i przycisk „Zarezerwuj”
 * z Instagrama i Facebooka prowadzą tutaj.
 *
 * Przekierowanie (307) na `/salons/<id>`, a nie rewrite:
 * - strona salonu i rezerwacja zostają jedną stroną z jednym adresem
 *   kanonicznym; linki wewnątrz (`/salons/<id>/book`) działają bez zmian;
 * - rewrite wymagałby zapytania do bazy w `src/proxy.ts` przy każdym żądaniu
 *   albo drugiej kopii strony salonu pod `/s/`;
 * - 307 (tymczasowe), nie 308: właściciel może zmienić adres, więc
 *   przeglądarka i wyszukiwarki nie mogą zapamiętać przekierowania na stałe.
 *
 * Co jest publiczne decyduje `findPublicSalonIdBySlug` (ta sama reguła co
 * `/salons/[id]`). Nieznany albo niepoprawny slug → 404 (`not-found.tsx`).
 *
 * `force-dynamic`: odczyt przy każdym żądaniu. Bez tego Next mógłby zapamiętać
 * wynik dla danego sluga — po zmianie adresu stary dalej by przekierowywał,
 * a nowy salon pod zwolnionym adresem dostawałby 404.
 */
export const dynamic = "force-dynamic";

export default async function SalonShortLinkPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const salonId = await findPublicSalonIdBySlug(slug);
  if (!salonId) notFound();
  redirect(`/salons/${salonId}`);
}
