import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isProPlan } from "@/lib/subscription";
import { db } from "@/lib/db";
import { scheduledPosts } from "@/lib/schema";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

const createSchema = z.object({
  platform: z.enum(["instagram", "facebook", "tiktok"]),
  postType: z.enum([
    "promotion",
    "service_highlight",
    "tips_and_tricks",
    "behind_the_scenes",
    "client_transformation",
    "seasonal",
    "engagement",
  ]),
  content: z.string().min(1).max(5000),
  hashtags: z.array(z.string()).default([]),
  tone: z
    .enum(["professional", "casual", "fun", "luxurious", "educational"])
    .optional(),
  scheduledAt: z.string().refine(
    (val) => {
      const date = new Date(val);
      return !isNaN(date.getTime()) && date > new Date();
    },
    { message: "Scheduled date must be in the future" }
  ),
});

// GET - List all scheduled posts for the salon
export async function GET() {
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

  try {
    const posts = await db
      .select()
      .from(scheduledPosts)
      .where(eq(scheduledPosts.salonId, DEMO_SALON_ID))
      .orderBy(desc(scheduledPosts.scheduledAt));

    return Response.json({ posts });
  } catch (error) {
    console.error("[Scheduled Posts] Error fetching posts:", error);
    return Response.json({ error: "Failed to fetch scheduled posts" }, { status: 500 });
  }
}

// POST - Create a new scheduled post
export async function POST(req: Request) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { platform, postType, content, hashtags, tone, scheduledAt } = parsed.data;

  try {
    const [newPost] = await db
      .insert(scheduledPosts)
      .values({
        salonId: DEMO_SALON_ID,
        platform,
        postType,
        content,
        hashtags,
        tone: tone || null,
        status: "scheduled",
        scheduledAt: new Date(scheduledAt),
      })
      .returning();

    return Response.json({ success: true, post: newPost }, { status: 201 });
  } catch (error) {
    console.error("[Scheduled Posts] Error creating post:", error);
    return Response.json({ error: "Failed to create scheduled post" }, { status: 500 });
  }
}
