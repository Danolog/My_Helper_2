// PRÓBA #193 P0a — NIE SCALAĆ. Nowa trasa z importem surowego db: lint w CI ma być czerwony.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ ok: typeof db === "object" });
}
