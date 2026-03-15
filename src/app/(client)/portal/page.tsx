import { redirect } from "next/navigation"

export default async function ClientPortalPage() {
  // Redirect all visitors to the new client landing page
  redirect("/dla-klientow")
}
