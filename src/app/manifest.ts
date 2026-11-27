import { PLANS } from "@/lib/constants";
import { planPriceText } from "@/lib/plan-price";
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MyHelper",
    short_name: "MyHelper",
    // Ten sam opis co w metadanych strony (layout.tsx), cena z funkcji cennika.
    description: `MyHelper — system rezerwacji online dla salonów usługowych. Jeden plan, ${planPriceText(PLANS.basic.priceMonthly)} miesięcznie.`,
    // Strona główna: katalog salonów (`/salons`) jest zamrożony i przekierowuje.
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    lang: "pl",
    dir: "ltr",
    background_color: "#FFFAF5",
    theme_color: "#C4704B",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Kalendarz",
        url: "/dashboard/calendar",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
      {
        name: "Nowa wizyta",
        url: "/dashboard/appointments/new",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
    ],
  };
}
