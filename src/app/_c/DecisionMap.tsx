"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineState, Exposure, Outcome, Pack, Signal } from "@/core/types";
import { mapContext, outcomeAt } from "@/core/map";
import { OUTCOME, OUTCOMES, Swatch, Tag, pct, money } from "./shared";

const COLS = 150;
const ROWS = 76;
const F_MIN = 1 / 25;
const F_MAX = 25;

const xToP = (x: number) => 0.01 + x * 0.98;
const pToX = (p: number) => (p - 0.01) / 0.98;
const yToF = (y: number) => Math.exp(Math.log(F_MAX) - y * (Math.log(F_MAX) - Math.log(F_MIN))); // y=0 top = high stakes
const fToY = (f: number) => (Math.log(F_MAX) - Math.log(f)) / (Math.log(F_MAX) - Math.log(F_MIN));

const cssVar = (name: string, fallback: string) =>
  typeof window === "undefined" ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

type Ink = { ink: string; paper: string; cobalt: string; red: string };

/** One engraved tile per territory, drawn at device resolution so the hatching stays crisp. */
function makePattern(g: CanvasRenderingContext2D, o: Outcome, dpr: number, c: Ink): CanvasPattern | string {
  const S = o === "defer" ? 4 : o === "ask" ? 5 : 5;
  const px = Math.max(1, Math.round(S * dpr));
  const cv = document.createElement("canvas");
  cv.width = cv.height = px;
  const t = cv.getContext("2d");
  if (!t) return c.paper;
  const k = px / S;
  t.scale(k, k);
  t.fillStyle = c.paper;
  t.fillRect(0, 0, S, S);
  if (o === "execute") {
    t.globalAlpha = 0.3;
    t.fillStyle = c.cobalt;
    t.fillRect(0, 0, S, S);
  } else if (o === "ask") {
    t.globalAlpha = 0.7;
    t.fillStyle = c.ink;
    t.beginPath();
    t.arc(S / 2, S / 2, 0.75, 0, Math.PI * 2);
    t.fill();
  } else if (o === "defer") {
    t.globalAlpha = 0.5;
    t.fillStyle = c.ink;
    t.fillRect(0, 0, S, 0.75);
  } else {
    t.strokeStyle = o === "refuse" ? c.red : c.ink;
    t.globalAlpha = o === "refuse" ? 0.85 : 0.7;
    t.lineWidth = 0.75;
    const diag = (back: boolean) => {
      t.beginPath();
      for (const s of [-S, 0, S]) {
        if (back) {
          t.moveTo(s, 0);
          t.lineTo(s + S, S);
        } else {
          t.moveTo(s, S);
          t.lineTo(s + S, 0);
        }
      }
      t.stroke();
    };
    diag(false);
    if (o === "refuse") diag(true);
  }
  const pat = g.createPattern(cv, "repeat");
  if (!pat) return c.paper;
  pat.setTransform(new DOMMatrix().scale(1 / k, 1 / k));
  return pat;
}

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
  const [width, setWidth] = useState(0);
  const ctx = useMemo(() => mapContext(pack, input, signals, exposure, state), [pack, input, signals, exposure, state]);

  const grid = useMemo(() => {
    const out = new Array<Outcome>(COLS * ROWS);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) out[r * COLS + c] = outcomeAt(pack, ctx, state, xToP((c + 0.5) / COLS), yToF((r + 0.5) / ROWS));
    return out;
  }, [pack, ctx, state]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ro = new ResizeObserver(() => setWidth(cv.clientWidth));
    ro.observe(cv);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !width) return;
    const g = cv.getContext("2d");
    if (!g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors: Ink = {
      ink: cssVar("--color-ink", "#15161a"),
      paper: cssVar("--color-panel", "#fbfbf9"),
      cobalt: cssVar("--color-execute", "#1d3ccf"),
      red: cssVar("--color-refuse", "#c0301b"),
    };
    const mono = cssVar("--font-geist-mono", "monospace");
    const cw = W / COLS;
    const ch = H / ROWS;
    g.clearRect(0, 0, W, H);

    // territories
    for (const o of OUTCOMES) {
      g.fillStyle = makePattern(g, o, dpr, colors);
      g.beginPath();
      let any = false;
      for (let i = 0; i < grid.length; i++) {
        if (grid[i] !== o) continue;
        any = true;
        const r = Math.floor(i / COLS);
        const c = i % COLS;
        g.rect(c * cw, r * ch, cw + 0.35, ch + 0.35);
      }
      if (any) g.fill();
    }

    // borders between territories
    g.strokeStyle = colors.ink;
    g.globalAlpha = 0.8;
    g.lineWidth = 1;
    g.beginPath();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        if (c < COLS - 1 && grid[i + 1] !== grid[i]) {
          const x = Math.round((c + 1) * cw) + 0.5;
          g.moveTo(x, r * ch);
          g.lineTo(x, (r + 1) * ch);
        }
        if (r < ROWS - 1 && grid[i + COLS] !== grid[i]) {
          const y = Math.round((r + 1) * ch) + 0.5;
          g.moveTo(c * cw, y);
          g.lineTo((c + 1) * cw, y);
        }
      }
    }
    g.stroke();
    g.globalAlpha = 1;

    const tag = (text: string, x: number, y: number, color: string, align: "left" | "center" | "right" = "center") => {
      g.font = `600 10px ${mono}`;
      (g as any).letterSpacing = "1.5px";
      const w = g.measureText(text).width;
      const pad = 5;
      const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
      g.fillStyle = colors.paper;
      g.fillRect(left - pad, y - 8, w + pad * 2, 16);
      g.strokeStyle = colors.ink;
      g.lineWidth = 1;
      g.strokeRect(Math.round(left - pad) + 0.5, Math.round(y - 8) + 0.5, Math.round(w + pad * 2), 16);
      g.fillStyle = color;
      g.textBaseline = "middle";
      g.textAlign = "left";
      g.fillText(text, left, y + 0.5);
      (g as any).letterSpacing = "0px";
    };

    // confidence floor
    const xf = Math.round(pToX(0.6) * W) + 0.5;
    g.strokeStyle = colors.ink;
    g.globalAlpha = 0.55;
    g.setLineDash([2, 3]);
    g.beginPath();
    g.moveTo(xf, 0);
    g.lineTo(xf, H);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;

    // authority line
    const fAuth = ctx.authority / Math.max(exposure.amount, 1e-9);
    if (fAuth > F_MIN && fAuth < F_MAX) {
      const y = Math.round(fToY(fAuth) * H) + 0.5;
      g.strokeStyle = colors.ink;
      g.lineWidth = 1.25;
      g.setLineDash([6, 4]);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
      g.setLineDash([]);
      tag(`AUTHORITY ${money(pack, ctx.authority)}`, W - 10, y, colors.ink, "right");
    }

    // territory names, placed on the cell nearest each region's centre of mass
    const total = grid.length;
    for (const o of OUTCOMES) {
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < total; i++) if (grid[i] === o) {
        n++;
        sx += i % COLS;
        sy += Math.floor(i / COLS);
      }
      if (n < total * 0.03) continue;
      const cx = sx / n;
      const cy = sy / n;
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < total; i++) if (grid[i] === o) {
        const d = (i % COLS - cx) ** 2 + (Math.floor(i / COLS) - cy) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      const bx = ((best % COLS) + 0.5) * cw;
      const by = (Math.floor(best / COLS) + 0.5) * ch;
      const color = o === "execute" ? colors.cobalt : o === "refuse" ? colors.red : colors.ink;
      tag(OUTCOME[o].label, Math.min(W - 50, Math.max(50, bx)), Math.min(H - 14, Math.max(14, by)), color);
    }
  }, [pack, ctx, grid, exposure.amount, width]);

  const point = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const probe = pinned ?? hover;
  const probeOutcome = probe ? outcomeAt(pack, ctx, state, xToP(probe.x), yToF(probe.y)) : null;
  const dotX = Math.min(0.985, Math.max(0.015, pToX(Math.min(0.99, Math.max(0.01, mid)))));

  return (
    <div>
      <div className="flex select-none gap-2">
        <div className="flex w-12 shrink-0 flex-col justify-between py-0.5 text-right font-mono text-[10px] leading-tight text-mute" aria-hidden>
          <span>25×<br />stakes</span>
          <span>as filed</span>
          <span>1/25</span>
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="relative cursor-crosshair border border-ink"
            style={{ touchAction: "none" }}
            onPointerMove={(e) => !pinned && setHover(point(e))}
            onPointerLeave={() => setHover(null)}
            onPointerDown={(e) => setPinned(pinned ? null : point(e))}
          >
            <canvas ref={ref} className="block h-[320px] w-full" aria-label="Territory map: which outcome wins at each level of confidence and stakes" />
            <div
              className="pulse pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-panel"
              style={{ left: `${dotX * 100}%`, top: `${fToY(1) * 100}%`, ["--ring" as string]: "#15161a40" }}
            >
              <span className="absolute inset-[3px] rounded-full" style={{ background: OUTCOME[outcome].color }} />
            </div>
            <div
              className="pointer-events-none absolute -translate-y-[26px] translate-x-2 whitespace-nowrap bg-ink px-1.5 py-0.5 font-mono text-[10px] text-panel"
              style={{ left: `${Math.min(dotX, 0.86) * 100}%`, top: `${fToY(1) * 100}%` }}
            >
              this case
            </div>
            {probe && (
              <div className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-ink bg-panel" style={{ left: `${probe.x * 100}%`, top: `${probe.y * 100}%` }} />
            )}
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px] text-mute">
            <span>0%</span>
            <span>confidence that acting is correct</span>
            <span>100%</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex min-h-[28px] flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {OUTCOMES.map((o) => (
            <span key={o} className="flex items-center gap-1.5 font-mono text-[10.5px] text-mute">
              <Swatch o={o} size={12} />
              {o}
            </span>
          ))}
        </div>
        <div className="text-[12px] text-mute" aria-live="polite">
          {probe && probeOutcome ? (
            <span className="flex flex-wrap items-center gap-2">
              At {pct(xToP(probe.x))} confidence and {yToF(probe.y).toFixed(yToF(probe.y) < 1 ? 2 : 1)}× the stakes: <Tag o={probeOutcome} size="sm" />
              {pinned && (
                <button className="underline underline-offset-2" onClick={() => setPinned(null)}>
                  unpin
                </button>
              )}
            </span>
          ) : (
            <span>Hover to probe, click to pin. Every cell is a real run of the engine.</span>
          )}
        </div>
      </div>
      {ctx.invariant && (
        <p className="mt-3 border-l-2 border-ink pl-3 text-[12.5px] leading-relaxed text-mute">
          A hard rule is violated, so the whole map collapses to <b style={{ color: OUTCOME[ctx.invariant].color }}>{ctx.invariant.toUpperCase()}</b>. Confidence cannot buy its way past an invariant.
        </p>
      )}
    </div>
  );
}
