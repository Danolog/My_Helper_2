import { redirect } from "next/navigation"
import { hasActiveSession } from "@/lib/session"
import { RegistrationFlow } from "@/components/auth/registration-flow"

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>
}) {
  const isLoggedIn = await hasActiveSession()

  if (isLoggedIn) {
    redirect("/dashboard")
  }

  const params = await searchParams
  const preselectedPlan = params.plan || null

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <RegistrationFlow preselectedPlan={preselectedPlan} />
    </div>
  )
}
