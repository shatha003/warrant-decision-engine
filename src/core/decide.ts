import { computeBelief, type EffectiveSignal } from "./belief";
import { resolve } from "./loss";
import { buildFlips } from "./flip";
import type {
  Decision,
  EngineState,
  Exposure,
  MissingInfo,
  Outcome,
  Pack,
  Signal,
  TraceStep,
} from "./types";

export const AUTONOMY_AUTHORITY = [0, 0.25, 0.6, 1] as const;
export const AUTONOMY_NAMES = ["L0 · shadow", "L1 · assisted", "L2 · supervised", "L3 · autonomous"] as const;
export const DEFAULT_STATE: EngineState = { autonomy: 3 };
/** Coin-flip actions are never autonomous, however cheap they look: execute needs P(correct) above this. */
export const CONFIDENCE_FLOOR = 0.6;

export function fmt(pack: Pick<Pack, "unit">, n: number): string {
  const v = Math.round(n).toLocaleString("en-US");
  return pack.unit === "$" ? `$${v}` : `${v} ${pack.unit}`;
}
const pct = (p: number) => `${Math.round(p * 100)}%`;

export interface DecideOptions {
  state?: EngineState;
  /** additional signals (user answers, LLM sensors) */
  extraSignals?: Signal[];
  /** skip counterfactual search (history generation, internal calls) */
  skipFlips?: boolean;
  /** override exposure (used by counterfactual scaling + Decision Map) */
  exposureOverride?: Exposure;
}

/** The single entry point. Pure + deterministic. */
export function decide<I>(pack: Pack<I>, input: I, opts: DecideOptions = {}): Decision {
  const state = opts.state ?? DEFAULT_STATE;
  const signals = [...pack.extract(input), ...(opts.extraSignals ?? [])];
  const exposure = opts.exposureOverride ?? pack.exposure(input);
  const base = evaluate(pack, input, signals, exposure, state);
  if (opts.skipFlips) return base;
  return { ...base, flips: buildFlips(pack, input, signals, exposure, state, base, opts.extraSignals ?? []) };
}

/** Evaluate a fixed (input, signals, exposure) triple through gates G0-G5. */
export function evaluate<I>(
  pack: Pack<I>,
  input: I,
  signals: Signal[],
  exposure: Exposure,
  state: EngineState,
): Decision {
  const trace: TraceStep[] = [];

  // ── G2 belief (computed first so every payload carries evidence, even when G0 short-circuits)
  const { belief, evidence, missing } = computeBelief(pack, pack.expected(input), signals, exposure.reversibility);

  // ── G0 invariants
  const violated = pack.invariants.filter((inv) => inv.violated(input, { signals, exposure }));
  if (violated.length === 0) {
    trace.push({
      gate: "G0",
      title: "Invariants",
      detail: `${pack.invariants.length} hard rules checked, none violated.`,
      effect: "pass",
    });
  } else {
    for (const v of violated) {
      trace.push({
        gate: "G0",
        title: `Invariant violated: ${v.id}`,
        detail: `${v.description}${v.explain ? ", " + v.explain(input) : ""} → ${v.verdict.toUpperCase()}. Confidence cannot override this.`,
        effect: "block",
      });
    }
  }

  // ── G1 authority
  const levelAuthority = pack.authority * AUTONOMY_AUTHORITY[state.autonomy === 0 ? 3 : state.autonomy];
  const overAuthority = exposure.amount > levelAuthority;
  const belowFloor = belief.mid < CONFIDENCE_FLOOR;
  trace.push({
    gate: "G1",
    title: "Authority",
    detail: overAuthority
      ? `${fmt(pack, exposure.amount)} exceeds the ${fmt(pack, levelAuthority)} this engine may approve at autonomy ${state.autonomy}. Execute is removed from the options.`
      : belowFloor
        ? `${fmt(pack, exposure.amount)} is within the ${fmt(pack, levelAuthority)} limit, but P(correct) ${pct(belief.mid)} is below the ${pct(CONFIDENCE_FLOOR)} floor for autonomous action. Execute is removed from the options.`
        : `${fmt(pack, exposure.amount)} is within the ${fmt(pack, levelAuthority)} limit at autonomy ${state.autonomy}.`,
    effect: overAuthority || belowFloor ? "block" : "pass",
  });

  // ── G2 narrative
  trace.push({
    gate: "G2",
    title: "Belief",
    detail:
      `${evidence.filter((e) => !e.collapsedInto).length} independent evidence group(s) → P(correct) = ${pct(belief.mid)} ` +
      `[${pct(belief.lo)}–${pct(belief.hi)}]. Reversibility ${pct(exposure.reversibility)} → decision-grade confidence ${pct(belief.effective)}` +
      (evidence.some((e) => e.collapsedInto)
        ? `. ${evidence.filter((e) => e.collapsedInto).length} signal(s) collapsed (shared provenance, counted once).`
        : "."),
    effect: "info",
  });

  // ── G3/G4 loss table + VOI
  const res = resolve(pack.loss, belief, exposure, !overAuthority && !belowFloor);
  const t = res.table;
  const tableTxt = (Object.entries(t) as [Outcome, number | null][])
    .map(([k, v]) => `${k} ${v === null ? "n/a" : fmt(pack, v)}`)
    .join(" · ");
  trace.push({ gate: "G3", title: "Expected loss", detail: tableTxt, effect: "info" });
  trace.push({
    gate: "G4",
    title: "Value of information",
    detail:
      res.qAsk > 0 || res.qDefer > 0
        ? `Asking resolves ${pct(res.qAsk)} of uncertainty (EVOI ${fmt(pack, res.evoiAsk)} vs friction ${fmt(pack, pack.loss.cAsk)}). Waiting resolves ${pct(res.qDefer)} (EVOI ${fmt(pack, res.evoiDefer)}).`
        : "No missing information can be obtained by asking or waiting, so VOI is zero.",
    effect: "info",
  });

  // ── G5 argmin + overrides
  let outcome: Outcome = res.best;
  let reason = "";
  let override = false;

  const refuseInv = violated.find((v) => v.verdict === "refuse");
  const escInv = violated.find((v) => v.verdict === "escalate");
  if (refuseInv) {
    outcome = "refuse";
    override = true;
    reason = `Hard rule "${refuseInv.id}": ${refuseInv.description}.`;
  } else if (escInv) {
    outcome = "escalate";
    override = true;
    reason = `Hard rule "${escInv.id}": ${escInv.description}. A human must decide.`;
  } else if (outcome === "execute" && (t.escalate ?? Infinity) - (t.execute ?? 0) < pack.loss.closeCall) {
    // Compared against the human fallback on purpose: extra doubt can only shrink this gap, never widen it.
    outcome = "escalate";
    override = true;
    reason = `Close call: acting is only ${fmt(pack, (t.escalate ?? 0) - (t.execute ?? 0))} cheaper than a human review (< ${fmt(pack, pack.loss.closeCall)} margin floor). When the call is that tight, a human should look.`;
  }

  let shadowed: Outcome | undefined;
  if (state.autonomy === 0 && outcome === "execute") {
    shadowed = "execute";
    outcome = "escalate";
    override = true;
    reason = "Shadow mode (autonomy L0): the engine would have executed, but its calibration has not earned that right. A human confirms.";
  }

  if (!override) reason = explain(pack, outcome, res, belief.effective, exposure, missing, overAuthority, belowFloor);

  trace.push({
    gate: "G5",
    title: `Decision → ${outcome.toUpperCase()}`,
    detail: `${reason} Margin over ${res.runnerUp ?? "n/a"}: ${Number.isFinite(res.margin) ? fmt(pack, res.margin) : "n/a"}.`,
    effect: outcome === "execute" ? "pass" : "block",
  });

  const askMissing = missing.filter((m) => m.askable);
  const timeMissing = missing.filter((m) => m.resolvesWithTime);
  let nextStep: string | null = null;
  if (outcome === "ask") nextStep = askMissing.map((m) => m.question ?? `Please provide: ${m.label}`).join("  ·  ");
  if (outcome === "defer") nextStep = `Re-evaluate when: ${timeMissing.map((m) => `${m.label}${m.eta ? ` (${m.eta})` : ""}`).join("; ")}`;
  if (outcome === "escalate") nextStep = "Route to a human reviewer with this evidence packet attached.";
  if (outcome === "execute") nextStep = "Warrant minted: the actuator will verify it before acting.";

  return {
    outcome,
    shadowed,
    confidence: { lo: belief.lo, mid: belief.mid, hi: belief.hi, effective: belief.effective },
    riskScore: res.riskScore,
    reversibility: { value: exposure.reversibility, note: exposure.reversibilityNote },
    exposure,
    evidenceUsed: evidence as (EffectiveSignal & { collapsedInto?: string })[],
    missingInfo: missing,
    lossTable: t,
    evoi: res.evoiAsk,
    margin: Number.isFinite(res.margin) ? res.margin : 0,
    runnerUp: res.runnerUp,
    flips: [],
    trace,
    headline: headline(pack, outcome, belief.mid, exposure, res.riskScore),
    reason,
    nextStep,
    policyVersion: pack.policyVersion,
    autonomy: state.autonomy,
    packId: pack.id,
    action: pack.describe(input),
  };
}

function headline(pack: Pack<any>, o: Outcome, p: number, ex: Exposure, risk: number) {
  const rev = ex.reversibility >= 0.8 ? "easily reversible" : ex.reversibility >= 0.4 ? "partly reversible" : "hard to reverse";
  return `${o.toUpperCase()} · ${pct(p)} confident · ${fmt(pack, ex.harm)} at stake · ${rev} · risk ${Math.round(risk * 100)}/100`;
}

function explain(
  pack: Pack<any>,
  o: Outcome,
  res: ReturnType<typeof resolve>,
  pEff: number,
  ex: Exposure,
  missing: MissingInfo[],
  overAuthority: boolean,
  belowFloor: boolean,
): string {
  const t = res.table;
  switch (o) {
    case "execute":
      return `Acting is the cheapest option (expected loss ${fmt(pack, t.execute ?? 0)} vs ${res.runnerUp} ${fmt(pack, t[res.runnerUp!] ?? 0)}). Decision-grade confidence ${pct(pEff)} is enough for something ${ex.reversibility >= 0.6 ? "this reversible" : "this consequential"}.`;
    case "ask": {
      const q = missing.filter((m) => m.askable).map((m) => m.label);
      return `Missing information (${q.join(", ")}) is cheap to get and would change the outcome: asking is worth ${fmt(pack, res.evoiAsk)} against ${fmt(pack, pack.loss.cAsk)} of friction.`;
    }
    case "defer": {
      const q = missing.filter((m) => m.resolvesWithTime).map((m) => m.label);
      return `The missing information (${q.join(", ")}) will arrive on its own. Waiting costs ${fmt(pack, pack.loss.cDelay * ex.urgency)} but is cheaper than acting blind or interrupting anyone.`;
    }
    case "escalate":
      return overAuthority
        ? `The stakes exceed this engine's authority, and nothing asked of the requester can change that. A human with authority decides.`
        : belowFloor
          ? `P(correct) is below the ${pct(CONFIDENCE_FLOOR)} floor for autonomous action and no cheap question or wait would fix it. A human decides.`
          : `Uncertainty is too costly to act on and asking would not resolve it. A human review (${fmt(pack, pack.loss.cHuman)}) is cheaper than the ${fmt(pack, t.execute ?? 0)} expected loss of acting.`;
    case "refuse":
      return `Acting carries ${fmt(pack, t.execute ?? 0)} of expected loss and no available information fixes it; refusing costs ${fmt(pack, t.refuse ?? 0)}.`;
  }
}
