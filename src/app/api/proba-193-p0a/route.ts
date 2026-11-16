// PRÓBA — NIE SCALAĆ. Lint w CI ma odrzucić surowy import db (#193).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ ok: typeof db });
}
