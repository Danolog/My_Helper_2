/**
 * Test page that simulates a server-side rendering error (500).
 * This triggers the nearest error.tsx boundary (dashboard/error.tsx).
 * Only works in development mode.
 *
 * Navigate to /dashboard/test-errors/server-crash?crash=true to trigger.
 */

export default async function ServerCrashPage({
  searchParams,
}: {
  searchParams: Promise<{ crash?: string }>;
}) {
  const params = await searchParams;

  if (params.crash === "true") {
    // This simulates a server-side error during page rendering
    // The nearest error.tsx boundary will catch this
    throw new Error("Simulated server-side 500 error for testing");
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-4">Test bledu serwera (500)</h1>
      <p className="text-muted-foreground mb-6">
        Ta strona symuluje blad serwera podczas renderowania. Kliknij przycisk
        ponizej, aby wywolac blad 500 i zobaczyc strone bledu.
      </p>
      <a
        href="/dashboard/test-errors/server-crash?crash=true"
        className="inline-flex items-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors"
      >
        Wywolaj blad serwera 500
      </a>
    </div>
  );
}
