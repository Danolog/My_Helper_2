import { NextResponse } from 'next/server';
// ADR-001 sekcja 4: healthcheck systemowy (ping bazy, bez danych najemcy) — wyjście systemowe #193
import { pingDatabase } from '@/lib/server/system';
import { logger } from "@/lib/logger";
// Health checks must always reflect real-time system state — never cache
export const dynamic = 'force-dynamic';

// Fixed public text for a failed database check; error details go to the server log only
const DATABASE_UNAVAILABLE_MESSAGE = 'Database unavailable';

// Helper function to add timeout to promises
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

export async function GET() {
  const startTime = Date.now();

  try {
    // Test database connection with 5 second timeout
    await withTimeout(pingDatabase(), 5000);

    const responseTime = Date.now() - startTime;

    const response = NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      responseTimeMs: responseTime,
      database: {
        status: 'connected',
        type: 'postgresql'
      }
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.error('Health check failed', { error: error });
    const responseTime = Date.now() - startTime;

    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      responseTimeMs: responseTime,
      database: {
        status: 'disconnected',
        error: DATABASE_UNAVAILABLE_MESSAGE
      }
    }, { status: 503 });
  }
}
