import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { newsletters } from "@/lib/schema";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

const saveSchema = z.object({
  subject: z.string().min(1, "Subject is required").max(500),
  content: z.string().min(1, "Content is required").max(10000),
});

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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
        salonId: DEMO_SALON_ID,
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
