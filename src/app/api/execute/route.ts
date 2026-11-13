import { NextResponse } from "next/server";
import { z } from "zod";
import { runActuator } from "@/server/engine";

const Body = z.object({
  packId: z.string(),
  variant: z.enum(["guarded", "naive"]).optional(),
  input: z.record(z.string(), z.unknown()),
  warrant: z.string().optional(),
  prev: z.any().nullable().optional(),
});

/** The actuator endpoint. Without a valid warrant for THIS exact action, it refuses. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  try {
    const r = runActuator(parsed.data.packId, parsed.data.variant, parsed.data.input, parsed.data.warrant, parsed.data.prev);
    return NextResponse.json(r, { status: r.ok ? 200 : 403 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
