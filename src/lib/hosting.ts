/**
 * Na jakim hostingu działa serwer? (C3, #106)
 *
 * - Vercel ustawia `VERCEL=1` w środowisku funkcji (build i runtime).
 * - Cloud Run ustawia `K_SERVICE` (nazwa usługi) w każdej instancji usługi.
 *
 * Używane przez bramki, które mają być zamknięte NA KAŻDYM hostingu,
 * niezależnie od NODE_ENV (symulacja płatności, deweloperskie potwierdzenie
 * zadatku). Lokalny `pnpm dev` / `pnpm start` i testy nie mają żadnej z tych
 * zmiennych. `vercel env pull` dopisuje `VERCEL="1"` do `.env.local`, więc
 * taki `pnpm dev` też jest traktowany jak Vercel (bezpieczniej: bramka zamknięta).
 */
export type HostingPlatform = "Vercel" | "Cloud Run";

type HostingEnv = Readonly<Record<string, string | undefined>>;

export function hostingPlatform(env: HostingEnv = process.env): HostingPlatform | null {
  if (env.VERCEL === "1") return "Vercel";
  if (env.K_SERVICE?.trim()) return "Cloud Run";
  return null;
}
