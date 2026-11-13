import { NextResponse } from "next/server";
import { defaultMode, llmConfigured } from "@/sensors/llm";

export async function GET() {
  return NextResponse.json({ ok: true, name: "warrant", mode: defaultMode(), llmAvailable: llmConfigured() });
}
