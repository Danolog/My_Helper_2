import Image from "next/image";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <Image
          src="/auth-salon.jpg"
          alt=""
          fill
          className="object-cover"
          aria-hidden="true"
          priority
        />
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, oklch(0.60 0.12 45 / 70%) 0%, oklch(0.35 0.08 45 / 80%) 100%)`,
          }}
        />
        {/* Botanical decorations */}
        <svg
          className="absolute top-8 right-8 w-32 h-32 text-white/10"
          viewBox="0 0 100 100"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="0.5" />
          <circle cx="50" cy="50" r="25" stroke="currentColor" strokeWidth="0.5" />
          <path d="M50 10 Q60 50 50 90" stroke="currentColor" strokeWidth="0.5" />
          <path d="M10 50 Q50 60 90 50" stroke="currentColor" strokeWidth="0.5" />
        </svg>
        <svg
          className="absolute bottom-12 left-8 w-24 h-24 text-white/8"
          viewBox="0 0 100 100"
          fill="none"
          aria-hidden="true"
        >
          <path d="M20 80 Q50 20 80 80" stroke="currentColor" strokeWidth="0.5" fill="none" />
          <path d="M30 80 Q50 30 70 80" stroke="currentColor" strokeWidth="0.5" fill="none" />
          <path d="M50 80 L50 20" stroke="currentColor" strokeWidth="0.5" />
        </svg>
        <div className="relative z-10 flex flex-col justify-end p-12 text-white">
          <h2 className="font-[family-name:var(--font-playfair)] text-4xl font-bold mb-3 leading-tight">
            Zarzadzaj salonem
            <br />z elegancja
          </h2>
          <p className="text-white/80 text-lg max-w-md mb-8">
            Wizyty, klienci i zespół w jednym miejscu.
          </p>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-4 lg:p-8">
        {children}
      </div>
    </div>
  );
}
