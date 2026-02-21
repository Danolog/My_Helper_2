import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isProPlan } from "@/lib/subscription";
import { db } from "@/lib/db";
import { scheduledPosts } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

// GET - Get a single scheduled post by ID
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const [post] = await db
      .select()
      .from(scheduledPosts)
      .where(
        and(eq(scheduledPosts.id, id), eq(scheduledPosts.salonId, DEMO_SALON_ID))
      );

    if (!post) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    return Response.json({ post });
  } catch (error) {
    console.error("[Scheduled Posts] Error fetching post:", error);
    return Response.json({ error: "Failed to fetch post" }, { status: 500 });
  }
}

// DELETE - Cancel a scheduled post
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hasPro = await isProPlan();
  if (!hasPro) {
    return Response.json(
      { error: "Funkcje AI sa dostepne tylko w Planie Pro.", code: "PLAN_UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }

  const { id } = await params;

  try {
    const [post] = await db
      .select()
      .from(scheduledPosts)
      .where(
        and(eq(scheduledPosts.id, id), eq(scheduledPosts.salonId, DEMO_SALON_ID))
      );

    if (!post) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    if (post.status !== "scheduled") {
      return Response.json(
        { error: "Only scheduled posts can be cancelled" },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(scheduledPosts)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
      })
      .where(eq(scheduledPosts.id, id))
      .returning();

    return Response.json({ success: true, post: updated });
  } catch (error) {
    console.error("[Scheduled Posts] Error cancelling post:", error);
    return Response.json({ error: "Failed to cancel post" }, { status: 500 });
  }
}
