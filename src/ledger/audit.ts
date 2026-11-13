import { createHmac, timingSafeEqual } from "node:crypto";
import { canonical, sha256 } from "@/warrant/canonical";
import { getSecret } from "@/warrant/warrant";

export const GENESIS = "0".repeat(64);

/**
 * Tamper-evident audit record.
 *  - `hash`  chains each record to its predecessor (edit/delete/reorder anything → every later hash breaks)
 *  - `seal`  is an HMAC of the hash made by the server, so a forger can't simply recompute a clean chain
 */
export interface AuditRecord {
  seq: number;
  id: string;
  kind: "decision" | "execution" | "outcome";
  ts: string;
  packId: string;
  /** the full, replayable payload (inputs, signals, trace, result...) */
  body: Record<string, unknown>;
  prevHash: string;
  hash: string;
  seal?: string;
}

export const hashRecord = (r: Omit<AuditRecord, "hash" | "seal">) => sha256(r.prevHash + canonical(r));
export const sealHash = (hash: string, secret = getSecret()) => createHmac("sha256", secret).update(hash).digest("hex");

export function makeRecord(
  prev: AuditRecord | undefined | null,
  kind: AuditRecord["kind"],
  packId: string,
  body: Record<string, unknown>,
  ts = new Date().toISOString(),
): AuditRecord {
  const seq = prev ? prev.seq + 1 : 1;
  const prevHash = prev ? prev.hash : GENESIS;
  const id = `${kind.slice(0, 3)}_${seq.toString().padStart(4, "0")}_${sha256(prevHash + ts + packId).slice(0, 6)}`;
  const partial = { seq, id, kind, ts, packId, body, prevHash };
  const hash = hashRecord(partial);
  return { ...partial, hash, seal: sealHash(hash) };
}

/** A single record is trustworthy as a chain tail if its hash matches its content and the server sealed it. */
export function recordIsAuthentic(r: AuditRecord): boolean {
  const { hash, seal, ...rest } = r;
  if (typeof hash !== "string" || typeof seal !== "string" || hashRecord(rest) !== hash) return false;
  const good = Buffer.from(sealHash(hash), "hex");
  const given = Buffer.from(seal, "hex");
  return given.length === good.length && timingSafeEqual(given, good);
}

export type ChainVerdict = { ok: true; length: number; sealed: boolean } | { ok: false; length: number; brokenAt: number; reason: string };

/** Re-walk the chain. With `checkSeals`, also prove each hash was issued by this server. */
export function verifyChain(records: AuditRecord[], opts: { checkSeals?: boolean } = {}): ChainVerdict {
  let prev = GENESIS;
  for (const r of records) {
    const { hash, seal, ...rest } = r;
    if (r.prevHash !== prev)
      return { ok: false, length: records.length, brokenAt: r.seq, reason: `record #${r.seq} points at the wrong predecessor: a record was removed or reordered` };
    if (hashRecord(rest) !== hash)
      return { ok: false, length: records.length, brokenAt: r.seq, reason: `record #${r.seq} no longer matches its hash: it was edited after the fact` };
    if (opts.checkSeals) {
      const good = Buffer.from(sealHash(hash), "hex");
      const given = Buffer.from(seal ?? "", "hex");
      if (given.length !== good.length || !timingSafeEqual(given, good))
        return { ok: false, length: records.length, brokenAt: r.seq, reason: `record #${r.seq} carries a seal this server never issued: the chain was regenerated` };
    }
    prev = hash;
  }
  return { ok: true, length: records.length, sealed: !!opts.checkSeals };
}

/** Best-effort single-use tracking for warrants (per server instance). Stateless checks still apply on a cold instance. */
const g = globalThis as unknown as { __warrantConsumed?: Set<string> };
export const consumedWarrants = () => (g.__warrantConsumed ??= new Set());
