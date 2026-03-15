import { ClientHeader } from "@/components/client/client-header";
import { SiteFooter } from "@/components/site-footer";

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <ClientHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
