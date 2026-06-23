import { NextResponse } from 'next/server';
// eslint-disable-next-line no-restricted-imports -- health-check systemowy (SELECT 1) — brak danych najemcy, brak sesji właściciela
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

import { logger } from "@/lib/logger";

/**
 * Trasa SYSTEMOWA (health-check) — surowy `db`, NIE `forSalon` (ADR-001 sekcja 4 / R2).
 * Tylko `SELECT 1` do testu połączenia — brak danych najemcy, brak sesji właściciela,
 * więc `forSalon` jest nieaplikowalny. Brak danych wrażliwych w odpowiedzi.
 */
// Health checks must always reflect real-time system state — never cache
export const dynamic = 'force-dynamic';

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
    await withTimeout(db.execute(sql`SELECT 1 as connected`), 5000);

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
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }, { status: 503 });
  }
}
