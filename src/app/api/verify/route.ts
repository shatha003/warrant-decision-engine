import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyChain, type AuditRecord } from "@/ledger/audit";

const Body = z.object({ records: z.array(z.any()).max(2000) });

/** Re-walks a client-held hash chain AND checks every seal was issued by this server. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  return NextResponse.json(verifyChain(parsed.data.records as AuditRecord[], { checkSeals: true }));
}
