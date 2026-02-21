import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scheduledPosts } from "@/lib/schema";
import { eq, and, lte } from "drizzle-orm";

/**
 * POST /api/cron/publish-scheduled-posts
 *
 * Triggered periodically (e.g., every minute by a cron job or Vercel cron).
 * Finds scheduled posts where scheduledAt <= now and status is 'scheduled'.
 * Updates them to 'published' with publishedAt timestamp.
 *
 * In a real production environment, this would also call the platform APIs
 * (Instagram Graph API, Facebook API, TikTok API) to actually publish.
 * For now, we simulate publishing by updating the status in the database.
 */
export async function POST(request: Request) {
  try {
    // Optional: verify cron secret for production security
    const { searchParams } = new URL(request.url);
    const cronSecret = searchParams.get("secret");
    const expectedSecret = process.env.CRON_SECRET;

    // In production, verify the cron secret. In dev, allow without secret.
    if (expectedSecret && cronSecret !== expectedSecret) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const now = new Date();

    // Find all scheduled posts that should have been published by now
    const duePosts = await db
      .select()
      .from(scheduledPosts)
      .where(
        and(
          eq(scheduledPosts.status, "scheduled"),
          lte(scheduledPosts.scheduledAt, now)
        )
      );

    if (duePosts.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No posts due for publishing",
        published: 0,
        failed: 0,
      });
    }

    let publishedCount = 0;
    let failedCount = 0;
    const results: Array<{
      id: string;
      platform: string;
      status: "published" | "failed";
      error?: string;
    }> = [];

    for (const post of duePosts) {
      try {
        // In a real implementation, this would call the platform API:
        // - Instagram Graph API for Instagram posts
        // - Facebook Marketing API for Facebook posts
        // - TikTok API for TikTok posts
        // For now, we simulate successful publishing.

        const rows = await db
          .update(scheduledPosts)
          .set({
            status: "published",
            publishedAt: new Date(),
          })
          .where(eq(scheduledPosts.id, post.id))
          .returning();

        const updated = rows[0];

        console.log(
          `[Cron] Published scheduled post ${post.id} on ${post.platform} ` +
          `(scheduled for ${post.scheduledAt.toISOString()}, published at ${new Date().toISOString()})`
        );

        publishedCount++;
        results.push({
          id: updated ? updated.id : post.id,
          platform: updated ? updated.platform : post.platform,
          status: "published",
        });
      } catch (err) {
        console.error(
          `[Cron] Failed to publish post ${post.id}:`,
          err
        );

        // Mark as failed so it's not retried indefinitely
        await db
          .update(scheduledPosts)
          .set({ status: "failed" })
          .where(eq(scheduledPosts.id, post.id));

        failedCount++;
        results.push({
          id: post.id,
          platform: post.platform,
          status: "failed",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${duePosts.length} posts: ${publishedCount} published, ${failedCount} failed`,
      published: publishedCount,
      failed: failedCount,
      results,
    });
  } catch (error) {
    console.error("[Cron] Error in publish-scheduled-posts:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
