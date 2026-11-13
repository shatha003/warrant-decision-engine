import { computeBelief, logit, sigmoid } from "./belief";
import { AUTONOMY_AUTHORITY, CONFIDENCE_FLOOR } from "./decide";
import { scaleExposure } from "./flip";
import { resolve } from "./loss";
import type { EngineState, Exposure, Outcome, Pack, Signal } from "./types";

export interface MapContext {
  spread: number;
  reversibility: number;
  askableShare: number;
  timeShare: number;
  exposure: Exposure;
  /** a hard rule is violated: the whole surface collapses to this verdict */
  invariant: "refuse" | "escalate" | null;
  authority: number;
}

/** Everything the map needs from the current case, computed once. */
export function mapContext<I>(pack: Pack<I>, input: I, signals: Signal[], exposure: Exposure, state: EngineState): MapContext {
  const { belief } = computeBelief(pack, pack.expected(input), signals, exposure.reversibility);
  const violated = pack.invariants.filter((v) => v.violated(input, { signals, exposure }));
  return {
    spread: belief.spread,
    reversibility: exposure.reversibility,
    askableShare: belief.askableShare,
    timeShare: belief.timeShare,
    exposure,
    invariant: violated.some((v) => v.verdict === "refuse") ? "refuse" : violated.length ? "escalate" : null,
    authority: pack.authority * AUTONOMY_AUTHORITY[state.autonomy === 0 ? 3 : state.autonomy],
  };
}

/**
 * The outcome the engine WOULD choose if P(correct) were `p` and the stakes were `factor` × the current case.
 * Mirrors G0-G5 in decide(); a test pins them together at the case's own coordinates.
 */
export function outcomeAt<I>(pack: Pack<I>, ctx: MapContext, state: EngineState, p: number, factor: number): Outcome {
  if (ctx.invariant) return ctx.invariant;
  const ex = scaleExposure(ctx.exposure, factor);
  const lo = sigmoid(logit(p) - ctx.spread);
  const belief = {
    mid: p,
    lo,
    hi: sigmoid(logit(p) + ctx.spread),
    effective: ctx.reversibility * p + (1 - ctx.reversibility) * lo,
    logOdds: logit(p),
    spread: ctx.spread,
    askableShare: ctx.askableShare,
    timeShare: ctx.timeShare,
    conflict: 0,
  };
  const allowed = ex.amount <= ctx.authority && p >= CONFIDENCE_FLOOR;
  const res = resolve(pack.loss, belief, ex, allowed);
  let o = res.best;
  if (o === "execute" && (res.table.escalate ?? Infinity) - (res.table.execute ?? 0) < pack.loss.closeCall) o = "escalate";
  if (state.autonomy === 0 && o === "execute") o = "escalate";
  return o;
}
