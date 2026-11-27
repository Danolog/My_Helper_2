import type { MetadataRoute } from "next";
import { isModuleFrozen } from "@/lib/features";

/**
 * Publiczne strony do indeksowania. Bez panelu (`/dashboard`), który
 * robots.txt wyklucza. Strona sprzedażowa jest na `/` (dawne `/dla-salonow`
 * przekierowuje tam, więc go tu nie ma). Lista salonów i strona dla klientów
 * należą do katalogu salonów — przy zamrożonym module (`salonCatalog`)
 * przekierowują na `/` i nie trafiają do mapy strony.
 */
const PUBLIC_PATHS: ReadonlyArray<{
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  priority: number;
  catalog?: true;
}> = [
  { path: "", changeFrequency: "monthly", priority: 1 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.9 },
  { path: "/dla-klientow", changeFrequency: "monthly", priority: 0.8, catalog: true },
  { path: "/salons", changeFrequency: "weekly", priority: 0.8, catalog: true },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const lastModified = new Date();
  const catalogFrozen = isModuleFrozen("salonCatalog");

  return PUBLIC_PATHS.filter(({ catalog }) => !(catalog && catalogFrozen)).map(
    ({ path, changeFrequency, priority }) => ({
      url: `${baseUrl}${path}`,
      lastModified,
      changeFrequency,
      priority,
    })
  );
}
