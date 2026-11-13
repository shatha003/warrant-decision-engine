"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineState, Exposure, Outcome, Pack, Signal } from "@/core/types";
import { mapContext, outcomeAt } from "@/core/map";
import { OUTCOME, OUTCOMES, Tag, pct, money } from "./shared";

const COLS = 110;
const ROWS = 60;
const F_MIN = 1 / 25;
const F_MAX = 25;

const xToP = (x: number) => 0.01 + x * 0.98;
const pToX = (p: number) => (p - 0.01) / 0.98;
const yToF = (y: number) => Math.exp(Math.log(F_MAX) - y * (Math.log(F_MAX) - Math.log(F_MIN))); // y=0 top=high stakes
const fToY = (f: number) => (Math.log(F_MAX) - Math.log(f)) / (Math.log(F_MAX) - Math.log(F_MIN));

const cssVar = (name: string) => (typeof window === "undefined" ? "#888" : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888");

export function DecisionMap({
  pack,
  input,
  signals,
  exposure,
  state,
  mid,
  outcome,
}: {
  pack: Pack<any>;
  input: unknown;
  signals: Signal[];
  exposure: Exposure;
  state: EngineState;
  mid: number;
  outcome: Outcome;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState<{ x: number; y: number } | null>(null);
  const ctx = useMemo(() => mapContext(pack, input, signals, exposure, state), [pack, input, signals, exposure, state]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext("2d");
    if (!g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = W * dpr;
    cv.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = Object.fromEntries(OUTCOMES.map((o) => [o, cssVar(`--color-${o}`)])) as Record<Outcome, string>;
    const cw = W / COLS;
    const ch = H / ROWS;
    g.clearRect(0, 0, W, H);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = xToP((c + 0.5) / COLS);
        const f = yToF((r + 0.5) / ROWS);
        const o = outcomeAt(pack, ctx, state, p, f);
        g.globalAlpha = o === "execute" ? 0.5 : 0.42;
        g.fillStyle = colors[o];
        g.fillRect(c * cw, r * ch, cw + 0.6, ch + 0.6);
      }
    }
    g.globalAlpha = 1;
    // authority line
    const fAuth = ctx.authority / Math.max(exposure.amount, 1e-9);
    if (fAuth > F_MIN && fAuth < F_MAX) {
      const y = fToY(fAuth) * H;
      g.strokeStyle = "rgba(255,255,255,.7)";
      g.setLineDash([5, 4]);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = "rgba(255,255,255,.85)";
      g.font = "10px var(--font-mono), monospace";
      g.textAlign = "right";
      g.fillText(`authority limit ${money(pack, ctx.authority)}`, W - 8, y - 5);
      g.textAlign = "left";
    }
    // confidence floor
    const xf = pToX(0.6) * W;
    g.strokeStyle = "rgba(255,255,255,.28)";
    g.setLineDash([2, 4]);
    g.beginPath();
    g.moveTo(xf, 0);
    g.lineTo(xf, H);
    g.stroke();
    g.setLineDash([]);
  }, [pack, ctx, state, exposure.amount]);

  const point = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const probe = pinned ?? hover;
  const probeOutcome = probe ? outcomeAt(pack, ctx, state, xToP(probe.x), yToF(probe.y)) : null;
  const dotX = Math.min(0.985, Math.max(0.015, pToX(Math.min(0.99, Math.max(0.01, mid)))));

  return (
    <div>
      <div className="select-none">
        <div className="flex gap-1.5">
          <div className="flex w-8 flex-col justify-between py-0.5 text-right font-mono text-[10px] text-faint" aria-hidden>
            <span>×25</span>
            <span>×1</span>
            <span>×0.04</span>
          </div>
          <div className="min-w-0 flex-1">
          <div
            className="relative cursor-crosshair overflow-hidden rounded-md border border-line"
            style={{ touchAction: "none" }}
            onPointerMove={(e) => !pinned && setHover(point(e))}
            onPointerLeave={() => setHover(null)}
            onPointerDown={(e) => setPinned(pinned ? null : point(e))}
          >
            <canvas ref={ref} className="block h-[300px] w-full" aria-label="Decision map: which outcome wins at each confidence and stakes level" />
            {/* current case */}
            <div
              className="pulse absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
              style={{ left: `${dotX * 100}%`, top: `${fToY(1) * 100}%`, background: OUTCOME[outcome].color, ["--ring" as string]: OUTCOME[outcome].color + "88" }}
              title="This case"
            />
            <div className="pointer-events-none absolute -translate-y-6 translate-x-2 font-mono text-[10px] text-white" style={{ left: `${dotX * 100}%`, top: `${fToY(1) * 100}%` }}>
              this case
            </div>
            {probe && (
              <>
                <div className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-black/60" style={{ left: `${probe.x * 100}%`, top: `${probe.y * 100}%` }} />
              </>
            )}
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
            <span>0%</span>
            <span>P(action is correct) →</span>
            <span>100%</span>
          </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex min-h-[28px] flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {OUTCOMES.map((o) => (
            <span key={o} className="flex items-center gap-1.5 font-mono text-[10px] text-mute">
              <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: OUTCOME[o].color, opacity: 0.7 }} />
              {o}
            </span>
          ))}
        </div>
        <div className="text-xs text-mute" aria-live="polite">
          {probe && probeOutcome ? (
            <span className="flex items-center gap-2">
              what-if: {pct(xToP(probe.x))} confident, stakes ×{yToF(probe.y).toFixed(yToF(probe.y) < 1 ? 2 : 1)} → <Tag o={probeOutcome} size="sm" />
              {pinned && (
                <button className="underline" onClick={() => setPinned(null)}>
                  unpin
                </button>
              )}
            </span>
          ) : (
            <span className="text-faint">Hover to probe · click to pin. Every cell is a real run of the engine.</span>
          )}
        </div>
      </div>
      {ctx.invariant && (
        <p className="mt-2 rounded border border-line bg-raised px-3 py-2 text-xs text-mute">
          A hard rule is violated for this case, so the whole surface collapses to <b style={{ color: OUTCOME[ctx.invariant].color }}>{ctx.invariant.toUpperCase()}</b>. Confidence cannot buy
          its way past an invariant.
        </p>
      )}
    </div>
  );
}
