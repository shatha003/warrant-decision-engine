import { z } from "zod";
import { decide } from "@/core/decide";
import type { AutonomyLevel, Decision, Pack } from "@/core/types";
import { getPack } from "@/domains";
import type { RefundVariant } from "@/domains/refund";
import { consumedWarrants, makeRecord, recordIsAuthentic, type AuditRecord } from "@/ledger/audit";
import { buildHistory, calibrate, type Calibration } from "@/ledger/calibration";
import { runSensors, defaultMode, type SensorReport } from "@/sensors/llm";
import { actionHash, mintWarrant, verifyWarrant } from "@/warrant/warrant";

export const CalibrationParams = z
  .object({
    badWeeks: z.number().int().min(0).max(6).default(0),
    /** user-recorded outcomes: [engine P(correct), what actually happened] */
    extra: z.array(z.tuple([z.number().min(0).max(1), z.boolean()])).max(300).default([]),
  })
  .default({ badWeeks: 0, extra: [] });
export type CalibrationParams = z.infer<typeof CalibrationParams>;

export const DecideBody = z.object({
  packId: z.string(),
  variant: z.enum(["guarded", "naive"]).optional(),
  input: z.record(z.string(), z.unknown()),
  sensors: z.enum(["offline", "llm"]).optional(),
  calibration: CalibrationParams.optional(),
  /** the client's latest audit record: the new record chains onto it */
  prev: z.any().nullable().optional(),
});

/** Accept a client-held predecessor only if its content matches its hash AND this server sealed it. */
export function acceptPrev(prev: unknown): AuditRecord | null {
  if (!prev || typeof prev !== "object") return null;
  const p = prev as AuditRecord;
  return recordIsAuthentic(p) ? p : null;
}

/** Coerce arbitrary JSON into the pack's typed input, field by field, falling back to a sane default. */
export function coerceInput(pack: Pack<any>, raw: Record<string, unknown>) {
  const fallback = pack.scenarios[0].input as Record<string, unknown>;
  const out: Record<string, unknown> = { ...fallback };
  for (const f of pack.fields) {
    const v = raw[f.key];
    if (v === undefined) continue;
    if (f.type === "number") {
      const n = Number(v);
      if (Number.isFinite(n)) out[f.key] = Math.min(f.max ?? 1e9, Math.max(f.min ?? 0, n));
    } else if (f.type === "boolean") out[f.key] = v === true || v === "true";
    else if (f.type === "select") {
      if (typeof v === "string" && f.options.includes(v)) out[f.key] = v;
    } else if (typeof v === "string") out[f.key] = v.slice(0, 2000);
  }
  return out;
}

const cache = new Map<string, Calibration>();
export function calibrationFor(pack: Pack<any>, params: CalibrationParams): Calibration {
  const key = `${pack.id}:${params.badWeeks}:${params.extra.length}:${params.extra.at(-1)?.join(",") ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const history = buildHistory(pack, params.badWeeks);
  for (const [p, correct] of params.extra) history.push({ p, correct, decided: "user" });
  const cal = calibrate(history);
  if (cache.size > 200) cache.clear();
  cache.set(key, cal);
  return cal;
}

export interface DecideResult {
  decision: Decision;
  warrant: string | null;
  record: AuditRecord;
  sensors: SensorReport;
  calibration: { autonomy: AutonomyLevel; ece: number; reason: string };
}

export async function runDecision(body: z.infer<typeof DecideBody>): Promise<DecideResult> {
  const pack = getPack(body.packId, body.variant as RefundVariant | undefined);
  if (!pack) throw new Error(`unknown domain "${body.packId}"`);
  const input = coerceInput(pack, body.input);
  const calParams = body.calibration ?? { badWeeks: 0, extra: [] };
  const cal = calibrationFor(pack, calParams);

  const requested = body.sensors ?? defaultMode();
  const sensors = await runSensors(pack, input, requested);

  const decision = decide(pack, input, { state: { autonomy: cal.autonomy }, extraSignals: sensors.signals });

  const now = Date.now();
  const record = makeRecord(acceptPrev(body.prev), "decision", pack.id, {
    variant: body.variant ?? null,
    input,
    sensorSignals: sensors.signals,
    sensorMode: sensors.mode,
    autonomy: cal.autonomy,
    decision,
    actionHash: actionHash(pack.id, input),
  });

  let warrant: string | null = null;
  if (decision.outcome === "execute") {
    warrant = mintWarrant({
      decisionId: record.id,
      packId: pack.id,
      actionHash: actionHash(pack.id, input),
      policyVersion: pack.policyVersion,
      confidence: Number(decision.confidence.effective.toFixed(4)),
      iat: now,
      exp: now + 5 * 60 * 1000,
    });
  }
  return { decision, warrant, record, sensors, calibration: { autonomy: cal.autonomy, ece: cal.ece, reason: cal.autonomyReason } };
}

/** The ACTUATOR. It is the only code path that touches the (simulated) world, and it demands a warrant. */
export function runActuator(
  packId: string,
  variant: RefundVariant | undefined,
  rawInput: Record<string, unknown>,
  token: string | undefined,
  prev: unknown,
) {
  const pack = getPack(packId, variant);
  if (!pack) throw new Error(`unknown domain "${packId}"`);
  const input = coerceInput(pack, rawInput);
  const v = verifyWarrant(token, { packId: pack.id, input, policyVersion: pack.policyVersion }, { consumed: consumedWarrants() });
  const base = { actionHash: actionHash(pack.id, input), action: pack.describe(input) };
  if (!v.ok) {
    const record = makeRecord(acceptPrev(prev), "execution", pack.id, { ...base, ok: false, rejected: v.reason });
    return { ok: false as const, reason: v.reason, record };
  }
  consumedWarrants().add(v.claims.decisionId);
  const result = simulate(pack.id, input);
  const record = makeRecord(acceptPrev(prev), "execution", pack.id, { ...base, ok: true, warrantFor: v.claims.decisionId, result });
  return { ok: true as const, result, record };
}

function simulate(packId: string, input: Record<string, unknown>): string {
  const id = Math.random().toString(36).slice(2, 8);
  switch (packId) {
    case "refund":
      return `Refund of $${input.amount} issued to customer via ${String(input.refundMethod).replace("_", " ")} (txn rf_${id}). [simulated]`;
    case "deploy":
      return `Deployed ${input.changedLines}-line change to ${input.service}: release rel_${id} live. [simulated]`;
    case "moderation":
      return `${input.action === "suspend_account" ? "Account suspended" : "Post removed"} and author notified (case mod_${id}); appealable. [simulated]`;
    default:
      return `Executed \`${input.command}\` in sandbox (run sh_${id}). [simulated]`;
  }
}
