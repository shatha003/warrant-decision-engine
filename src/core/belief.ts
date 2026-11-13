import type { Belief, ExpectedSignal, MissingInfo, Pack, Signal } from "./types";

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
export const logit = (p: number) => Math.log(p / (1 - p));
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Trust ceilings by origin. An LLM can *suggest* support but never dominate. */
const RELIABILITY_CAP: Record<Signal["origin"], number> = {
  rule: 1,
  system: 1,
  user: 0.8,
  llm: 0.55,
  premortem: 1,
};

export type EffectiveSignal = Signal & { effective: number; collapsedInto?: string };

/**
 * Normalise raw signals under the safety rules:
 *  1. premortem (LLM red-team) signals are DOUBT-ONLY: llr is clamped to <= 0.
 *     "LLMs may add doubt, never remove it."
 *  2. reliability is capped by origin.
 *  3. signals in the same provenance group are not independent: only the strongest
 *     supporting and the strongest opposing signal in a group count.
 */
export function normalise(signals: Signal[]): EffectiveSignal[] {
  const out: EffectiveSignal[] = signals.map((s) => {
    const llr = s.origin === "premortem" ? Math.min(0, s.llr) : s.llr;
    const reliability = Math.min(s.reliability, RELIABILITY_CAP[s.origin]);
    const effective = llr * reliability * s.freshness;
    return { ...s, llr, reliability, effective };
  });

  const byGroup = new Map<string, EffectiveSignal[]>();
  for (const s of out) {
    const g = byGroup.get(s.group) ?? [];
    g.push(s);
    byGroup.set(s.group, g);
  }
  for (const members of byGroup.values()) {
    const pos = members.filter((m) => m.effective > 0).sort((a, b) => b.effective - a.effective);
    const neg = members.filter((m) => m.effective < 0).sort((a, b) => a.effective - b.effective);
    for (const list of [pos, neg]) {
      for (let i = 1; i < list.length; i++) list[i].collapsedInto = list[0].id;
    }
  }
  return out;
}

export function findMissing(expected: ExpectedSignal[], signals: Signal[]): MissingInfo[] {
  const have = new Set(signals.map((s) => s.id));
  return expected
    .filter((e) => !have.has(e.id))
    .map((e) => ({
      id: e.id,
      label: e.label,
      askable: !!e.askable,
      resolvesWithTime: !!e.resolvesWithTime,
      question: e.question,
      eta: e.eta,
      magnitude: e.magnitude,
      field: e.field,
    }));
}

export function computeBelief(
  pack: Pick<Pack, "prior">,
  expected: ExpectedSignal[],
  signals: Signal[],
  reversibility: number,
): { belief: Belief; evidence: EffectiveSignal[]; missing: MissingInfo[] } {
  const evidence = normalise(signals);
  const counted = evidence.filter((s) => !s.collapsedInto);
  const sumPos = counted.filter((s) => s.effective > 0).reduce((a, s) => a + s.effective, 0);
  const sumNeg = counted.filter((s) => s.effective < 0).reduce((a, s) => a + s.effective, 0);
  const logOdds = pack.prior + sumPos + sumNeg;

  const missing = findMissing(expected, signals);

  // Uncertainty (in log-odds units) from four independent sources, combined in quadrature.
  let sq = 0;
  let askableSq = 0;
  let timeSq = 0;
  for (const m of missing) {
    const v = m.magnitude ** 2;
    sq += v;
    if (m.askable) askableSq += v;
    if (m.resolvesWithTime) timeSq += v;
  }
  for (const s of counted) {
    sq += ((1 - s.freshness) * Math.abs(s.llr)) ** 2; //            stale evidence
    sq += ((1 - s.reliability) * Math.abs(s.llr) * 0.5) ** 2; //     shaky sources
  }
  // Conflict: strong support AND strong contradiction at once means the model is wrong, not just unsure.
  const conflict = Math.min(sumPos, -sumNeg);
  sq += (conflict * 0.6) ** 2;

  const spread = Math.sqrt(sq);
  const mid = sigmoid(logOdds);
  const lo = sigmoid(logOdds - spread);
  const hi = sigmoid(logOdds + spread);
  // Reversibility-conditioned conservatism:
  // cheaply-undone actions are judged on the midpoint, permanent ones on the pessimistic bound.
  const effective = reversibility * mid + (1 - reversibility) * lo;

  const total = sq || 1;
  return {
    belief: {
      mid,
      lo,
      hi,
      effective: clamp(effective, 0, 1),
      logOdds,
      spread,
      askableShare: askableSq / total,
      timeShare: timeSq / total,
      conflict,
    },
    evidence,
    missing,
  };
}
