import { describe, expect, it } from "vitest";
import { decide } from "@/core/decide";
import { computeBelief } from "@/core/belief";
import { PACKS } from "@/domains";
import { rng, sig } from "@/domains/util";
import type { Outcome, Signal } from "@/core/types";

const packs = Object.values(PACKS);

describe("golden scenarios: every pack demonstrates every outcome it claims to", () => {
  for (const pack of packs) {
    for (const sc of pack.scenarios) {
      it(`${pack.id}/${sc.id} → ${sc.expected}`, () => {
        expect(decide(pack, sc.input).outcome).toBe(sc.expected);
      });
    }
  }
  it("all five outcomes are reachable across the demo domains", () => {
    const seen = new Set<Outcome>();
    for (const p of packs) for (const s of p.scenarios) seen.add(decide(p, s.input).outcome);
    expect([...seen].sort()).toEqual(["ask", "defer", "escalate", "execute", "refuse"]);
  });
});

describe("determinism (replay depends on it)", () => {
  it("same input → byte-identical decision", () => {
    for (const p of packs)
      for (const s of p.scenarios) {
        expect(JSON.stringify(decide(p, s.input))).toBe(JSON.stringify(decide(p, s.input)));
      }
  });
});

describe("safety properties over random cases per domain", () => {
  for (const pack of packs) {
    it(`${pack.id}: payload is complete and well-formed`, () => {
      const r = rng(99);
      for (let k = 0; k < 300; k++) {
        const d = decide(pack, pack.generate(r), { skipFlips: true });
        expect(["execute", "ask", "defer", "escalate", "refuse"]).toContain(d.outcome);
        expect(d.confidence.lo).toBeLessThanOrEqual(d.confidence.mid + 1e-9);
        expect(d.confidence.mid).toBeLessThanOrEqual(d.confidence.hi + 1e-9);
        expect(d.riskScore).toBeGreaterThanOrEqual(0);
        expect(d.riskScore).toBeLessThanOrEqual(1);
        expect(d.trace.length).toBeGreaterThanOrEqual(5);
        expect(d.reason.length).toBeGreaterThan(10);
      }
    });

    it(`${pack.id}: execute is NEVER chosen above authority`, () => {
      const r = rng(5);
      for (let k = 0; k < 300; k++) {
        const input = pack.generate(r);
        const d = decide(pack, input, { skipFlips: true });
        if (d.outcome === "execute") expect(pack.exposure(input).amount).toBeLessThanOrEqual(pack.authority);
      }
    });

    it(`${pack.id}: a violated invariant can't be bought off with confidence`, () => {
      const r = rng(3);
      let checked = 0;
      for (let k = 0; k < 1500 && checked < 20; k++) {
        const input = pack.generate(r);
        const hit = pack.invariants.find((inv) => inv.violated(input, { signals: [], exposure: pack.exposure(input) }));
        if (!hit) continue;
        checked++;
        const flood: Signal[] = Array.from({ length: 6 }, (_, i) => sig(`x${i}`, "flood", 5, `g${i}`, { origin: "system" }));
        const d = decide(pack, input, { extraSignals: flood, skipFlips: true });
        // refuse beats escalate when both rules fire
        const expected = pack.invariants.some((inv) => inv.verdict === "refuse" && inv.violated(input, { signals: [], exposure: pack.exposure(input) })) ? "refuse" : hit.verdict;
        expect(d.outcome).toBe(expected);
      }
      expect(checked).toBeGreaterThan(0);
    });

    it(`${pack.id}: more supporting evidence never raises the expected loss of acting`, () => {
      const r = rng(8);
      for (let k = 0; k < 200; k++) {
        const input = pack.generate(r);
        const a = decide(pack, input, { skipFlips: true });
        const b = decide(pack, input, {
          skipFlips: true,
          extraSignals: [sig("extra", "extra support", 1.2, "new-group", { origin: "system" })],
        });
        expect(b.confidence.mid).toBeGreaterThanOrEqual(a.confidence.mid - 1e-9);
        if (a.lossTable.execute !== null && b.lossTable.execute !== null)
          expect(b.lossTable.execute).toBeLessThanOrEqual(a.lossTable.execute + 1e-6);
      }
    });

    it(`${pack.id}: LLM doubt can only make decisions more cautious, never looser`, () => {
      const r = rng(12);
      for (let k = 0; k < 200; k++) {
        const input = pack.generate(r);
        const a = decide(pack, input, { skipFlips: true });
        const doubt = sig("pm", "pre-mortem doubt", -1.5, "premortem", { origin: "premortem" });
        const b = decide(pack, input, { skipFlips: true, extraSignals: [doubt] });
        expect(b.confidence.mid).toBeLessThanOrEqual(a.confidence.mid + 1e-9);
        if (a.outcome !== "execute") expect(b.outcome).not.toBe("execute");
      }
    });

    it(`${pack.id}: a jailbroken pre-mortem claiming SUPPORT is clamped to zero effect`, () => {
      const r = rng(21);
      for (let k = 0; k < 100; k++) {
        const input = pack.generate(r);
        const a = decide(pack, input, { skipFlips: true });
        const lie = sig("pm", "everything is fine!!", 9, "premortem", { origin: "premortem" });
        const b = decide(pack, input, { skipFlips: true, extraSignals: [lie] });
        expect(b.confidence.mid).toBeCloseTo(a.confidence.mid, 9);
        expect(b.outcome).toBe(a.outcome);
      }
    });
  }
});

describe("belief", () => {
  it("signals sharing a provenance group count once", () => {
    const pack = { prior: 0 };
    const same = [1, 2, 3, 4].map((i) => sig(`s${i}`, "doc", 1, "one-source"));
    const diff = [1, 2, 3, 4].map((i) => sig(`s${i}`, "doc", 1, `source-${i}`));
    const a = computeBelief(pack, [], same, 1).belief.mid;
    const b = computeBelief(pack, [], diff, 1).belief.mid;
    expect(a).toBeCloseTo(1 / (1 + Math.exp(-1)), 6);
    expect(b).toBeGreaterThan(0.97);
  });
  it("permanent actions are judged on the pessimistic bound, reversible ones on the midpoint", () => {
    const pack = { prior: 0 };
    const expected = [{ id: "x", label: "x", magnitude: 2 }];
    const sigs = [sig("a", "a", 2, "a")];
    const permanent = computeBelief(pack, expected, sigs, 0).belief.effective;
    const reversible = computeBelief(pack, expected, sigs, 1).belief.effective;
    expect(permanent).toBeLessThan(reversible);
  });
});

describe("flip lab: counterfactuals are real", () => {
  it("every reported flip changes the outcome", () => {
    for (const pack of packs)
      for (const sc of pack.scenarios) {
        const d = decide(pack, sc.input);
        for (const f of d.flips) expect(f.to).not.toBe(d.outcome);
      }
  });
  it("a missing-proof ask flips to execute once proof checks out", () => {
    const sc = PACKS.refund.scenarios.find((s) => s.id === "missing-proof")!;
    const d = decide(PACKS.refund, sc.input);
    expect(d.flips.some((f) => f.kind === "missing" && f.to === "execute")).toBe(true);
  });
});

describe("autonomy: calibration decides how much the engine may do", () => {
  it("shadow mode (L0) converts execute into escalate but remembers the intent", () => {
    const sc = PACKS.refund.scenarios.find((s) => s.id === "easy-win")!;
    const d = decide(PACKS.refund, sc.input, { state: { autonomy: 0 } });
    expect(d.outcome).toBe("escalate");
    expect(d.shadowed).toBe("execute");
  });
  it("lower autonomy shrinks authority", () => {
    const input = { ...PACKS.refund.scenarios[0].input, amount: 200, orderTotal: 250 };
    expect(decide(PACKS.refund, input, { state: { autonomy: 3 } }).outcome).toBe("execute");
    expect(decide(PACKS.refund, input, { state: { autonomy: 1 } }).outcome).not.toBe("execute");
  });
});
