import Link from "next/link"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { auth } from "@/lib/auth"

export default async function ClientPortalPage() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (session) {
    redirect("/dashboard")
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Client Portal</CardTitle>
          <CardDescription>
            Book appointments, browse services, and manage your visits
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button asChild className="w-full" size="lg">
            <Link href="/portal/register">Create an account</Link>
          </Button>
          <Button asChild variant="outline" className="w-full" size="lg">
            <Link href="/login">Sign in</Link>
          </Button>
          <div className="text-center text-sm text-muted-foreground pt-2">
            Are you a salon owner?{" "}
            <Link href="/register" className="text-primary hover:underline">
              Register your salon
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
