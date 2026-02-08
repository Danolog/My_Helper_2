import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { SignUpForm } from "@/components/auth/sign-up-form"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { auth } from "@/lib/auth"

export default async function ClientRegistrationPage() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (session) {
    redirect("/dashboard")
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Create a client account</CardTitle>
          <CardDescription>
            Register to book appointments, browse salons, and manage your visits
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center">
          <SignUpForm
            showPhone={true}
            redirectTo="/dashboard"
            loginHref="/login"
          />
        </CardContent>
      </Card>
    </div>
  )
}
