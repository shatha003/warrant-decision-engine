import { evaluate, fmt } from "./decide";
import type { Decision, EngineState, Exposure, Flip, Outcome, Pack, Signal } from "./types";

/**
 * Counterfactual explanations: "what would change my mind?"
 * We perturb ONE thing at a time, re-run the full gate pipeline, and report every perturbation
 * that changes the outcome. This is the decision margin made tangible.
 */
export function buildFlips<I>(
  pack: Pack<I>,
  input: I,
  signals: Signal[],
  exposure: Exposure,
  state: EngineState,
  base: Decision,
  extra: Signal[] = [],
): Flip[] {
  const out: Flip[] = [];
  const outcomeOf = (sigs: Signal[], ex: Exposure): Outcome => evaluate(pack, input, sigs, ex, state).outcome;
  const seen = new Set<string>();
  const push = (f: Flip) => {
    const key = `${f.kind}:${f.to}:${JSON.stringify(f.patch)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(f);
    }
  };

  // 1. Stakes scaling: bisect the factor at which the outcome first changes (both directions).
  for (const dir of ["down", "up"] as const) {
    const grid =
      dir === "down"
        ? [0.9, 0.8, 0.65, 0.5, 0.4, 0.3, 0.2, 0.12, 0.07, 0.04]
        : [1.1, 1.25, 1.5, 2, 3, 4, 6, 10, 16, 25];
    let prev = 1;
    for (const f of grid) {
      const o = outcomeOf(signals, scaleExposure(exposure, f));
      if (o !== base.outcome) {
        // refine between prev (same outcome) and f (different)
        let a = prev;
        let b = f;
        for (let i = 0; i < 14; i++) {
          const m = (a + b) / 2;
          if (outcomeOf(signals, scaleExposure(exposure, m)) === base.outcome) a = m;
          else b = m;
        }
        const boundary = b;
        push({
          kind: "scale",
          change: `If the stakes were ${boundary < 1 ? "down to" : "up to"} ${fmt(pack, exposure.amount * boundary)} (×${boundary.toFixed(2)})`,
          to: o,
          patch: { type: "scale", factor: Number(boundary.toFixed(3)) },
        });
        break;
      }
      prev = f;
    }
  }

  // 2. Missing information: what if it were supplied and good / bad?
  for (const m of base.missingInfo) {
    for (const sign of [1, -1] as const) {
      if (m.field) {
        // Real counterfactual: edit the actual input field and re-run the whole pipeline.
        const patched = { ...(input as object), [m.field.key]: sign > 0 ? m.field.good : m.field.bad } as I;
        const o = evaluate(pack, patched, [...pack.extract(patched), ...extra], pack.exposure(patched), state).outcome;
        if (o !== base.outcome) {
          push({
            kind: "missing",
            change: `If we learned "${m.label}" ${sign > 0 ? "checks out" : "is a red flag"}`,
            to: o,
            patch: { type: "supply", signalId: m.id, sign, field: { key: m.field.key, value: sign > 0 ? m.field.good : m.field.bad } },
          });
        }
        continue;
      }
      const sig: Signal = {
        id: m.id,
        label: m.label,
        llr: sign * m.magnitude,
        reliability: 0.9,
        freshness: 1,
        group: `cf:${m.id}`,
        origin: "user",
      };
      const o = outcomeOf([...signals, sig], exposure);
      if (o !== base.outcome) {
        push({
          kind: "missing",
          change: `If we learned "${m.label}" ${sign > 0 ? "checks out" : "is a red flag"}`,
          to: o,
          patch: { type: "supply", signalId: m.id, sign },
        });
      }
    }
  }

  // 3. Existing evidence: removed or reversed.
  for (const e of base.evidenceUsed) {
    if (e.collapsedInto || Math.abs(e.effective) < 0.15) continue;
    const without = signals.filter((s) => s.id !== e.id);
    const o1 = outcomeOf(without, exposure);
    if (o1 !== base.outcome) {
      push({ kind: "signal", change: `If "${e.label}" were absent`, to: o1, patch: { type: "remove", signalId: e.id } });
    }
    const reversed = signals.map((s) => (s.id === e.id ? { ...s, llr: -s.llr } : s));
    const o2 = outcomeOf(reversed, exposure);
    if (o2 !== base.outcome) {
      push({ kind: "signal", change: `If "${e.label}" were reversed`, to: o2, patch: { type: "reverse", signalId: e.id } });
    }
  }

  // Most useful first: stakes and missing info (actionable) before hypothetical evidence edits.
  const rank = { scale: 0, missing: 1, signal: 2 } as const;
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, 7);
}

export function scaleExposure(ex: Exposure, f: number): Exposure {
  return { ...ex, amount: ex.amount * f, harm: ex.harm * f, undoCost: ex.undoCost * f, value: ex.value * f };
}
