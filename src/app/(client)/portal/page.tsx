import { redirect } from "next/navigation"
import { isModuleFrozen } from "@/lib/features"

export default async function ClientPortalPage() {
  // Przy zamrożonym katalogu (`salonCatalog`) `/dla-klientow` przekierowuje
  // na stronę sprzedażową dla salonów, więc klient trafia od razu do logowania.
  redirect(isModuleFrozen("salonCatalog") ? "/portal/login" : "/dla-klientow")
}
