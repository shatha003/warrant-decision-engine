import { NextResponse } from "next/server";
import { DecideBody, runDecision } from "@/server/engine";

export const maxDuration = 30;

export async function POST(req: Request) {
  const parsed = DecideBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  try {
    return NextResponse.json(await runDecision(parsed.data));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
