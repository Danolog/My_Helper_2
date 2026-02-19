import { NextResponse } from "next/server";

/**
 * Test endpoint to simulate various server error responses.
 * Used for testing error handling in the frontend.
 * Only available in development mode.
 *
 * GET /api/test/error?type=500|400|timeout|crash
 */
export async function GET(request: Request) {
  // Only allow in development
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "500";

  switch (type) {
    case "500":
      // Simulate internal server error - returns user-friendly message, no technical details
      console.error("[Test Error API] Simulated 500 internal server error");
      return NextResponse.json(
        { success: false, error: "Wystapil blad serwera. Sprobuj ponownie pozniej." },
        { status: 500 }
      );

    case "400":
      // Simulate validation error
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          details: {
            name: "Pole jest wymagane",
            email: "Nieprawidlowy format adresu email",
          },
        },
        { status: 400 }
      );

    case "timeout":
      // Simulate slow response (will timeout on client if configured)
      await new Promise((resolve) => setTimeout(resolve, 20000));
      return NextResponse.json({ success: true, data: "slow response" });

    case "crash":
      // Simulate unhandled error in the API
      throw new Error("Simulated unhandled server crash");

    default:
      return NextResponse.json(
        { success: false, error: "Nieznany typ bledu" },
        { status: 400 }
      );
  }
}

export async function POST(request: Request) {
  // Only allow in development
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const body = await request.json();

    // Simulate a POST that fails with server error
    console.error("[Test Error API] Simulated POST failure");
    return NextResponse.json(
      { success: false, error: "Nie udalo sie zapisac danych. Sprobuj ponownie." },
      { status: 500 }
    );
  } catch {
    return NextResponse.json(
      { success: false, error: "Nieprawidlowe dane wejsciowe" },
      { status: 400 }
    );
  }
}
