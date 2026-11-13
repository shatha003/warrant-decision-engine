import type { Origin, Signal } from "@/core/types";

export function sig(
  id: string,
  label: string,
  llr: number,
  group: string,
  o: { origin?: Origin; reliability?: number; freshness?: number; detail?: string } = {},
): Signal {
  return {
    id,
    label,
    llr,
    group,
    origin: o.origin ?? "rule",
    reliability: o.reliability ?? 1,
    freshness: o.freshness ?? 1,
    detail: o.detail,
  };
}

/** Deterministic PRNG (mulberry32) so synthetic history is identical on every run and machine. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
export const weighted = <T,>(r: () => number, xs: readonly [T, number][]): T => {
  const total = xs.reduce((a, [, w]) => a + w, 0);
  let x = r() * total;
  for (const [v, w] of xs) if ((x -= w) <= 0) return v;
  return xs[xs.length - 1][0];
};
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Phrases that try to instruct the decision layer instead of describing a case. */
export const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any )?(previous|prior|above) (instructions|rules)/i,
  /system (note|message|override)/i,
  /(approve|execute|authori[sz]e) (this )?(immediately|now|without)/i,
  /already (verified|approved|authori[sz]ed)/i,
  /(do not|don't) (ask|escalate|check|verify)/i,
  /you (must|are required to) (approve|comply)/i,
];
export const looksLikeInjection = (text: string) => INJECTION_PATTERNS.some((p) => p.test(text));
