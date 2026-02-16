import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { RegistrationFlow } from "@/components/auth/registration-flow"

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })

  if (session) {
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
