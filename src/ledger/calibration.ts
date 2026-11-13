import { decide } from "@/core/decide";
import type { AutonomyLevel, Pack } from "@/core/types";
import { rng } from "@/domains/util";

export interface Outcome1 {
  p: number; //        engine's P(action correct)
  correct: boolean; // what actually happened
  decided: string; //  what the engine said
}

export interface Calibration {
  n: number;
  window: number;
  brier: number;
  ece: number;
  bins: { lo: number; hi: number; n: number; predicted: number; observed: number }[];
  autonomy: AutonomyLevel;
  autonomyReason: string;
  /** accuracy of the engine's `execute` calls specifically */
  executeCount: number;
  executeWrong: number;
}

const WINDOW = 150;
const SEEDS: Record<string, number> = { refund: 11, deploy: 23, moderation: 37, shell: 51 };

/**
 * Deterministic synthetic history: run the REAL engine over generated cases and draw each
 * outcome from a hidden ground-truth model. `badWeeks` simulates the world drifting away from
 * the engine's assumptions (fraud ring adapts, infra changes, new abuse style).
 */
export function buildHistory(pack: Pack<any>, badWeeks = 0, n = 240): Outcome1[] {
  const seed = SEEDS[pack.id] ?? 7;
  const r = rng(seed);
  const out: Outcome1[] = [];
  const total = n + badWeeks * 40;
  for (let i = 0; i < total; i++) {
    const input = pack.generate(r);
    const d = decide(pack, input, { skipFlips: true });
    const drift = i >= n ? 0.45 : 1; // after week 0, truth quietly gets much worse than the engine believes
    const truth = Math.min(0.98, pack.truth(input) * drift);
    out.push({ p: d.confidence.mid, correct: r() < truth, decided: d.outcome });
  }
  return out;
}

export function calibrate(history: Outcome1[]): Calibration {
  const w = history.slice(-WINDOW);
  const n = w.length;
  const brier = n ? w.reduce((a, o) => a + (o.p - (o.correct ? 1 : 0)) ** 2, 0) / n : 0;
  const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0, predicted: 0, observed: 0 }));
  for (const o of w) {
    const b = bins[Math.min(9, Math.floor(o.p * 10))];
    b.n++;
    b.predicted += o.p;
    b.observed += o.correct ? 1 : 0;
  }
  let ece = 0;
  for (const b of bins) {
    if (b.n) {
      b.predicted /= b.n;
      b.observed /= b.n;
      ece += (b.n / n) * Math.abs(b.predicted - b.observed);
    }
  }
  const execs = w.filter((o) => o.decided === "execute");
  const executeWrong = execs.filter((o) => !o.correct).length;

  let autonomy: AutonomyLevel;
  let autonomyReason: string;
  if (n < 30) {
    autonomy = 1;
    autonomyReason = `only ${n} labelled outcomes: not enough evidence to trust yet`;
  } else if (ece <= 0.08) {
    autonomy = 3;
    autonomyReason = `ECE ${ece.toFixed(3)} ≤ 0.08: confidence matches reality`;
  } else if (ece <= 0.13) {
    autonomy = 2;
    autonomyReason = `ECE ${ece.toFixed(3)} is drifting (0.08–0.13): supervised`;
  } else if (ece <= 0.2) {
    autonomy = 1;
    autonomyReason = `ECE ${ece.toFixed(3)} is poor (0.13–0.20): assisted only`;
  } else {
    autonomy = 0;
    autonomyReason = `ECE ${ece.toFixed(3)} > 0.20: the engine's confidence is not trustworthy → shadow mode`;
  }
  return { n, window: WINDOW, brier, ece, bins, autonomy, autonomyReason, executeCount: execs.length, executeWrong };
}
