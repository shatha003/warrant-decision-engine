import { NextResponse } from "next/server";
import { z } from "zod";
import { getPack } from "@/domains";
import { CalibrationParams, calibrationFor } from "@/server/engine";

const Body = z.object({ packId: z.string(), calibration: CalibrationParams.optional() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const pack = getPack(parsed.data.packId);
  if (!pack) return NextResponse.json({ error: "unknown domain" }, { status: 400 });
  return NextResponse.json(calibrationFor(pack, parsed.data.calibration ?? { badWeeks: 0, extra: [] }));
}
