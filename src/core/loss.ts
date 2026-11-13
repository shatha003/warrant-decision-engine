import type { Belief, Exposure, LossParams, LossTable, Outcome } from "./types";

/** Tie-break order: when two options cost the same, prefer the safer one. */
const SAFE_FIRST: Outcome[] = ["ask", "defer", "escalate", "refuse", "execute"];

export interface Resolution {
  table: LossTable;
  best: Outcome;
  runnerUp: Outcome | null;
  margin: number;
  /** expected value of asking: loss reduction from the requester's answer, before friction */
  evoiAsk: number;
  evoiDefer: number;
  qAsk: number;
  qDefer: number;
  riskScore: number;
}

/**
 * G3 + G4: the expected-loss table and the value-of-information test.
 *
 * Worlds: the proposed action is CORRECT (prob p) or WRONG (prob 1-p).
 *  execute  : pay for being wrong, discounted by how reversible the action is
 *  refuse   : forgo the value if it was right, plus a trust cost either way
 *  escalate : a human reviews: flat cost, assumed accurate
 *  ask      : friction + (answer resolves uncertainty with prob q, else fall back to best of the rest)
 *  defer    : delay cost + (time resolves uncertainty with prob q, else fall back)
 */
export function resolve(
  loss: LossParams,
  belief: Belief,
  ex: Exposure,
  executeAllowed = true,
): Resolution {
  const pE = belief.effective;
  const pM = belief.mid;
  const r = ex.reversibility;

  const executeRaw = (1 - pE) * (ex.harm * (1 - r) + ex.undoCost * r);
  const execute = executeAllowed ? executeRaw : null;
  const refuse = pM * ex.value + loss.cTrust;
  const escalate = loss.cHuman;
  const base = Math.min(execute ?? Infinity, refuse, escalate);

  // With perfect information we execute good requests (0) and refuse bad ones (cheaply, with a reason).
  const perfectInfo = (1 - pM) * loss.cTrust * 0.5;

  const qAsk = loss.qAsk * belief.askableShare;
  const qDefer = loss.qDefer * belief.timeShare;

  const ask = qAsk > 0 ? loss.cAsk + qAsk * perfectInfo + (1 - qAsk) * base : null;
  const defer =
    qDefer > 0 ? loss.cDelay * ex.urgency + qDefer * perfectInfo + (1 - qDefer) * base : null;

  const table: LossTable = { execute, ask, defer, escalate, refuse };

  const ranked = (Object.entries(table) as [Outcome, number | null][])
    .filter((e): e is [Outcome, number] => e[1] !== null)
    .sort((a, b) => a[1] - b[1] || SAFE_FIRST.indexOf(a[0]) - SAFE_FIRST.indexOf(b[0]));

  const best = ranked[0][0];
  const runnerUp = ranked[1]?.[0] ?? null;
  const margin = ranked[1] ? ranked[1][1] - ranked[0][1] : Infinity;

  return {
    table,
    best,
    runnerUp,
    margin,
    evoiAsk: qAsk * (base - perfectInfo),
    evoiDefer: qDefer * (base - perfectInfo),
    qAsk,
    qDefer,
    riskScore: 1 - Math.exp(-executeRaw / loss.riskScale),
  };
}
