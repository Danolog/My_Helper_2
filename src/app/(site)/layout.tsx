import { eq } from "drizzle-orm";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { getOptionalSession } from "@/lib/session";
import { db } from "@/lib/db";
import { salons } from "@/lib/schema";

async function isOwner(): Promise<boolean> {
  const session = await getOptionalSession();
  if (!session) return false;

  const role = (session.user as { role?: string }).role;
  if (role === "admin" || role === "owner") return true;

  const [salon] = await db
    .select({ id: salons.id })
    .from(salons)
    .where(eq(salons.ownerId, session.user.id))
    .limit(1);

  return !!salon;
}

export default async function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ownerView = await isOwner();

  return (
    <>
      {!ownerView && <SiteHeader />}
      <main id="main-content">{children}</main>
      {!ownerView && <SiteFooter />}
    </>
  );
}
