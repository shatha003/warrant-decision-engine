import { describe, expect, it } from "vitest";
import { actionHash, mintWarrant, verifyWarrant } from "@/warrant/warrant";
import { GENESIS, hashRecord, makeRecord, recordIsAuthentic, sealHash, verifyChain, type AuditRecord } from "@/ledger/audit";
import { decide } from "@/core/decide";
import { PACKS } from "@/domains";

const input = { amount: 60, who: "alice" };
const claims = (over = {}) => ({
  decisionId: "dec_1",
  packId: "refund",
  actionHash: actionHash("refund", input),
  policyVersion: "refund@2.1",
  confidence: 0.97,
  iat: 1000,
  exp: 5000,
  ...over,
});

describe("warrants (actuators refuse to act without one)", () => {
  const secret = "test-secret";
  const token = mintWarrant(claims(), secret);
  it("valid warrant verifies", () => {
    expect(verifyWarrant(token, { packId: "refund", input }, { now: 2000, secret }).ok).toBe(true);
  });
  it("missing token is rejected", () => {
    expect(verifyWarrant(undefined, { packId: "refund", input }, { secret })).toEqual({ ok: false, reason: "missing" });
  });
  it("changing ONE field of the action voids the warrant", () => {
    const r = verifyWarrant(token, { packId: "refund", input: { ...input, amount: 6000 } }, { now: 2000, secret });
    expect(r).toEqual({ ok: false, reason: "action-mismatch" });
  });
  it("forged signature is rejected", () => {
    const forged = token.split(".")[0] + "." + Buffer.from("not-the-signature").toString("base64url");
    expect(verifyWarrant(forged, { packId: "refund", input }, { now: 2000, secret })).toEqual({ ok: false, reason: "bad-signature" });
  });
  it("re-signed with the wrong key is rejected", () => {
    const evil = mintWarrant(claims(), "attacker-key");
    expect(verifyWarrant(evil, { packId: "refund", input }, { now: 2000, secret }).ok).toBe(false);
  });
  it("expired warrant is rejected", () => {
    expect(verifyWarrant(token, { packId: "refund", input }, { now: 9000, secret })).toEqual({ ok: false, reason: "expired" });
  });
  it("a warrant is single-use", () => {
    const consumed = new Set(["dec_1"]);
    expect(verifyWarrant(token, { packId: "refund", input }, { now: 2000, secret, consumed })).toEqual({ ok: false, reason: "already-used" });
  });
  it("a warrant minted under another policy version is rejected", () => {
    expect(verifyWarrant(token, { packId: "refund", input, policyVersion: "refund@9.9" }, { now: 2000, secret })).toEqual({
      ok: false,
      reason: "policy-mismatch",
    });
  });
});

describe("hash-chained audit ledger", () => {
  const build = (n = 6) => {
    const recs: AuditRecord[] = [];
    for (let i = 0; i < n; i++) {
      const sc = PACKS.refund.scenarios[i % 3];
      const d = decide(PACKS.refund, sc.input, { skipFlips: true });
      recs.push(makeRecord(recs[recs.length - 1], "decision", "refund", { outcome: d.outcome, input: sc.input }, `2026-01-0${i + 1}T00:00:00Z`));
    }
    return recs;
  };
  it("an untouched chain verifies and starts at genesis", () => {
    const c = build();
    expect(c[0].prevHash).toBe(GENESIS);
    expect(verifyChain(c)).toEqual({ ok: true, length: 6, sealed: false });
    expect(verifyChain(c, { checkSeals: true })).toEqual({ ok: true, length: 6, sealed: true });
  });
  it("editing any record is detected at that record", () => {
    const c = build();
    (c[2].body as { outcome: string }).outcome = "execute";
    const v = verifyChain(c);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.brokenAt).toBe(3);
  });
  it("deleting a record is detected", () => {
    const c = build();
    c.splice(2, 1);
    expect(verifyChain(c).ok).toBe(false);
  });
  it("a forger who recomputes a perfectly consistent chain is still caught by the server seal", () => {
    const c = build();
    // attacker edits record 3 and re-hashes the whole chain forward so every hash is internally consistent
    (c[2].body as { outcome: string }).outcome = "execute";
    let prev = c[1];
    for (let i = 2; i < c.length; i++) {
      const { hash: _h, seal: _s, ...rest } = c[i];
      const fixed = { ...rest, prevHash: prev.hash };
      c[i] = { ...fixed, hash: hashRecord(fixed), seal: _s };
      prev = c[i];
    }
    expect(verifyChain(c).ok).toBe(true); //                         hashes alone are fooled…
    expect(verifyChain(c, { checkSeals: true }).ok).toBe(false); //   …seals are not
    expect(sealHash(c[2].hash)).not.toBe(c[2].seal);
  });
  it("a record is only accepted as a chain tail if the server sealed it", () => {
    const c = build(2);
    expect(recordIsAuthentic(c[1])).toBe(true);
    expect(recordIsAuthentic({ ...c[1], seal: "00".repeat(32) })).toBe(false);
    expect(recordIsAuthentic({ ...c[1], body: { outcome: "execute" } })).toBe(false);
  });
  it("reordering is detected", () => {
    const c = build();
    [c[1], c[2]] = [c[2], c[1]];
    expect(verifyChain(c).ok).toBe(false);
  });
});

describe("replay: a stored decision re-runs to the identical result", () => {
  it("decision body is reproducible from its stored inputs", () => {
    for (const pack of Object.values(PACKS))
      for (const sc of pack.scenarios) {
        const stored = JSON.parse(JSON.stringify(decide(pack, sc.input)));
        const replayed = JSON.parse(JSON.stringify(decide(pack, JSON.parse(JSON.stringify(sc.input)))));
        expect(replayed).toEqual(stored);
      }
  });
});
