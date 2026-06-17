import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { isProPlan } from "@/lib/subscription";
import { scheduledPosts } from "@/lib/schema";
import { getUserSalonId } from "@/lib/get-user-salon";
import { forSalon } from "@/lib/server/repository";

import { logger } from "@/lib/logger";
// GET - Get a single scheduled post by ID
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const salonId = await getUserSalonId();
  if (!salonId) {
    return Response.json({ error: "Salon not found" }, { status: 404 });
  }

  const { id } = await params;

  try {
    const post = await forSalon(salonId).findOne(scheduledPosts, id);

    if (!post) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    return Response.json({ post });
  } catch (error) {
    logger.error("[Scheduled Posts] Error fetching post", { error: error });
    return Response.json({ error: "Failed to fetch post" }, { status: 500 });
  }
}

// DELETE - Cancel a scheduled post
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

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
    const post = await forSalon(salonId).findOne(scheduledPosts, id);

    if (!post) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    if (post.status !== "scheduled") {
      return Response.json(
        { error: "Only scheduled posts can be cancelled" },
        { status: 400 }
      );
    }

    const updated = await forSalon(salonId).updateOwned(scheduledPosts, id, {
      status: "cancelled",
      cancelledAt: new Date(),
    });

    return Response.json({ success: true, post: updated });
  } catch (error) {
    logger.error("[Scheduled Posts] Error cancelling post", { error: error });
    return Response.json({ error: "Failed to cancel post" }, { status: 500 });
  }
}
