import { ClientHeader } from "@/components/client/client-header";

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <ClientHeader />
      <main className="flex-1">{children}</main>
    </div>
  );
}
