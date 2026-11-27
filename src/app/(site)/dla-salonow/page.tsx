import { redirect } from "next/navigation";

/**
 * Strona sprzedażowa przeniesiona na stronę główną `/` (src/app/(site)/page.tsx).
 * Stary adres i jego kotwice (`#features`, `#pricing`) prowadzą tam dalej —
 * przeglądarka zachowuje kotwicę przy przekierowaniu.
 */
export default function DlaSalonowRedirect(): never {
  redirect("/");
}
