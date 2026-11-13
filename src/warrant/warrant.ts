import { createHmac, timingSafeEqual } from "node:crypto";
import { canonical, sha256 } from "./canonical";

/**
 * A WARRANT is a capability token the decision layer mints ONLY on `execute`.
 * Actuators (the code that touches the world) refuse to run without a valid one.
 * It binds: this exact action + this policy version + this decision + an expiry.
 * Change one byte of the action and the warrant is void.
 */
export interface WarrantClaims {
  v: 1;
  decisionId: string;
  packId: string;
  actionHash: string;
  policyVersion: string;
  confidence: number;
  iat: number;
  exp: number;
}

const DEMO_SECRET = "warrant-demo-secret-not-for-production";
export const getSecret = () => process.env.WARRANT_SECRET || DEMO_SECRET;

export const actionHash = (packId: string, input: unknown) => sha256(canonical({ packId, input }));

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest();

export function mintWarrant(claims: Omit<WarrantClaims, "v">, secret = getSecret()): string {
  const payload = b64(canonical({ v: 1, ...claims }));
  return `${payload}.${b64(sign(payload, secret))}`;
}

export type VerifyResult =
  | { ok: true; claims: WarrantClaims }
  | { ok: false; reason: "missing" | "malformed" | "bad-signature" | "expired" | "action-mismatch" | "policy-mismatch" | "already-used" };

export function verifyWarrant(
  token: string | undefined | null,
  expect: { packId: string; input: unknown; policyVersion?: string },
  opts: { now?: number; secret?: string; consumed?: Set<string> } = {},
): VerifyResult {
  if (!token) return { ok: false, reason: "missing" };
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return { ok: false, reason: "malformed" };
  const good = sign(payload, opts.secret ?? getSecret());
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (given.length !== good.length || !timingSafeEqual(given, good)) return { ok: false, reason: "bad-signature" };
  let claims: WarrantClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const now = opts.now ?? Date.now();
  if (now > claims.exp) return { ok: false, reason: "expired" };
  if (claims.packId !== expect.packId || claims.actionHash !== actionHash(expect.packId, expect.input)) return { ok: false, reason: "action-mismatch" };
  if (expect.policyVersion && claims.policyVersion !== expect.policyVersion) return { ok: false, reason: "policy-mismatch" };
  if (opts.consumed?.has(claims.decisionId)) return { ok: false, reason: "already-used" };
  return { ok: true, claims };
}
