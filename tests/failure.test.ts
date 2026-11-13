/**
 * THE DELIBERATE FAILURE TEST: "The Echo Chamber".
 * See docs/FAILURE_TEST.md for the narrative. These tests pin down exactly what breaks,
 * what fixes it, and what still doesn't.
 */
import { describe, expect, it } from "vitest";
import { decide } from "@/core/decide";
import { makeRefundPack, type RefundInput } from "@/domains/refund";

const guarded = makeRefundPack("guarded");
const naive = makeRefundPack("naive");
const echo = guarded.scenarios.find((s) => s.id === "echo-chamber")!.input;
const clean = guarded.scenarios.find((s) => s.id === "easy-win")!.input;

describe("Echo Chamber: poisoned, correlated evidence", () => {
  it("v1 (naive): four 'independent' documents + injected claim → EXECUTE a fraudulent $260 refund", () => {
    const d = decide(naive, echo);
    expect(d.outcome).toBe("execute");
    expect(d.confidence.mid).toBeGreaterThan(0.97); // 97%+ confident, and completely wrong
  });
  it("v2 layer 1 alone (provenance collapse + integrity signal, no hard rule): no longer executes", () => {
    const noRules = { ...guarded, invariants: [] };
    const d = decide(noRules, echo);
    expect(d.outcome).not.toBe("execute");
    expect(d.confidence.mid).toBeLessThan(0.2);
  });
  it("v2 full: injection is a hard-rule violation → ESCALATE regardless of confidence", () => {
    const d = decide(guarded, echo);
    expect(d.outcome).toBe("escalate");
    expect(d.trace.some((t) => t.gate === "G0" && t.effect === "block")).toBe(true);
  });
  it("collapse works: 4 requester-supplied docs count as ONE vote", () => {
    const d = decide(guarded, echo);
    const docs = d.evidenceUsed.filter((e) => e.id.startsWith("doc_"));
    expect(docs).toHaveLength(4);
    expect(docs.filter((e) => e.collapsedInto)).toHaveLength(3);
  });
});

describe("KNOWN LIMIT: the engine cannot beat genuinely independent forged evidence", () => {
  // The attacker compromised the order system AND the CRM. Every signal is "real", independent, and wrong.
  const compromised: RefundInput = {
    ...clean,
    amount: 250,
    orderTotal: 280,
    reason: "damaged",
    orderProof: "yes", //          forged in the (compromised) order system
    customerTenureDays: 800, //    backdated in the (compromised) CRM
    ticketText: "My item arrived broken, please refund.",
  };
  it("it executes: this is the honest failure", () => {
    expect(decide(guarded, compromised).outcome).toBe("execute");
  });
  it("but the damage is capped: authority bounds a single request", () => {
    expect(decide(guarded, { ...compromised, amount: 2500, orderTotal: 2800 }).outcome).toBe("escalate");
  });
  it("and the rolling window bounds a drip-feed", () => {
    expect(decide(guarded, { ...compromised, amount: 49, refundCount30d: 6, refundedTotal30d: 294 }).outcome).not.toBe("execute");
  });
});

describe("Salami slicing: twenty $49 refunds", () => {
  const next = (k: number, total: number): RefundInput => ({
    ...clean,
    amount: 49,
    orderTotal: 60,
    reason: "changed_mind",
    customerTenureDays: 120,
    refundCount30d: k - 1,
    refundedTotal30d: total,
    priorRefunds90d: 0,
  });
  it("the rolling exposure window stops it within 7 refunds", () => {
    let total = 0;
    let stoppedAt = -1;
    for (let k = 1; k <= 20; k++) {
      const d = decide(guarded, next(k, total), { skipFlips: true });
      if (d.outcome !== "execute") {
        stoppedAt = k;
        break;
      }
      total += 49;
    }
    expect(stoppedAt).toBeGreaterThan(0);
    expect(stoppedAt).toBeLessThanOrEqual(7);
  });
  it("…but a slow drip that never fills the 30-day window is NOT caught (documented limit)", () => {
    expect(decide(guarded, next(1, 0), { skipFlips: true }).outcome).toBe("execute");
  });
});
