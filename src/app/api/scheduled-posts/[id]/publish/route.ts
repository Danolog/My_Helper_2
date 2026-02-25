import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isProPlan } from "@/lib/subscription";
import { db } from "@/lib/db";
import { scheduledPosts } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { getUserSalonId } from "@/lib/get-user-salon";

// POST - Manually publish a scheduled post (simulates publishing)
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const salonId = await getUserSalonId();
  if (!salonId) {
    return Response.json({ error: "Salon not found" }, { status: 404 });
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
        and(eq(scheduledPosts.id, id), eq(scheduledPosts.salonId, salonId))
      );

    if (!post) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    if (post.status !== "scheduled") {
      return Response.json(
        { error: "Only scheduled posts can be published" },
        { status: 400 }
      );
    }

    // In a real implementation, this would call the platform API
    // (Instagram Graph API, Facebook API, etc.) to publish the post.
    // For now, we simulate publishing by updating the status.
    const [updated] = await db
      .update(scheduledPosts)
      .set({
        status: "published",
        publishedAt: new Date(),
      })
      .where(eq(scheduledPosts.id, id))
      .returning();

    console.log(
      `[Scheduled Posts] Post ${id} published on ${post.platform} at ${new Date().toISOString()}`
    );

    return Response.json({ success: true, post: updated });
  } catch (error) {
    console.error("[Scheduled Posts] Error publishing post:", error);
    return Response.json({ error: "Failed to publish post" }, { status: 500 });
  }
}
