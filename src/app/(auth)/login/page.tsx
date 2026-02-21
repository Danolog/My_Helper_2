import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { SignInButton } from "@/components/auth/sign-in-button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { auth } from "@/lib/auth"

/**
 * Validate returnTo URL to prevent open redirects.
 * Only allows relative paths that start with "/" but not "//".
 */
function isSafeReturnTo(url: string | null | undefined): string {
  if (!url) return "/dashboard"
  if (url.startsWith("/") && !url.startsWith("//")) return url
  return "/dashboard"
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; returnTo?: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })

  const { reset, returnTo } = await searchParams

  if (session) {
    // If already logged in, redirect to returnTo or dashboard (with open-redirect protection)
    redirect(isSafeReturnTo(returnTo))
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Welcome back</CardTitle>
          <CardDescription>Sign in to your account</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center">
          {reset === "success" && (
            <p className="mb-4 text-sm text-green-600 dark:text-green-400">
              Password reset successfully. Please sign in with your new password.
            </p>
          )}
          <SignInButton returnTo={returnTo} />
        </CardContent>
      </Card>
    </div>
  )
}
