import { z } from "zod";
import { db } from "@/lib/db";
import { newsletters } from "@/lib/schema";
import { getUserSalonId } from "@/lib/get-user-salon";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

const saveSchema = z.object({
  subject: z.string().min(1, "Subject is required").max(500),
  content: z.string().min(1, "Content is required").max(10000),
});

export async function POST(req: Request) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const salonId = await getUserSalonId();
  if (!salonId) {
    return Response.json({ error: "Salon not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { subject, content } = parsed.data;

  try {
    const result = await db
      .insert(newsletters)
      .values({
        salonId,
        subject,
        content,
      })
      .returning({ id: newsletters.id });

    const saved = result[0];
    if (!saved) {
      return Response.json(
        { error: "Nie udalo sie zapisac newslettera" },
        { status: 500 }
      );
    }

    return Response.json({
      success: true,
      savedId: saved.id,
    });
  } catch (error) {
    console.error("[Newsletter Save] Error:", error);
    return Response.json(
      { error: "Blad podczas zapisywania newslettera" },
      { status: 500 }
    );
  }
}
