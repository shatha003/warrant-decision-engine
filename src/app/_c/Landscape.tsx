"use client";
import { useEffect, useRef } from "react";
import type { Decision, Pack } from "@/core/types";
import { OUTCOME, OUTCOMES, SlamWord, money } from "./shared";

/*
  The decision landscape.
  The engine picks the response with the lowest expected loss, so we draw that literally:
  five wells, each as deep as its option is cheap. The case is a ball that rolls into the
  well it is allowed to take. Hard rules slam lids over forbidden wells; cheaper wells the
  engine overruled get a fence; evidence falls in as particles.
  Every number on screen comes from the real Decision object.
*/

interface Target {
  depth: number[];
  chosen: number;
  barred: boolean[];
  fence: (string | null)[];
  struck: (string | null)[];
  loss: (number | null)[];
  sig: { w: number; pos: boolean; collapsed: boolean }[];
}

function targetOf(d: Decision): Target {
  const loss = OUTCOMES.map((o) => d.lossTable[o]);
  const finite = loss.filter((v): v is number => v !== null);
  const maxL = Math.max(...finite, 1);
  const chosen = OUTCOMES.indexOf(d.outcome);
  const blocked = d.trace.some((t) => t.gate === "G0" && t.effect === "block");
  const depth = loss.map((v) => (v === null ? 0 : 0.16 + 0.84 * (1 - Math.log1p(v) / Math.log1p(maxL))));
  if (depth[chosen] < 0.3) depth[chosen] = 0.3;
  const cl = loss[chosen];
  const barred = OUTCOMES.map((_, i) => blocked && i !== chosen);
  const fence = OUTCOMES.map((o, i) => {
    if (i === chosen || barred[i] || loss[i] === null || cl === null) return null;
    if ((loss[i] as number) <= cl) return d.shadowed && o === "execute" ? "SHADOW MODE" : "OVERRULED";
    return null;
  });
  const struck = OUTCOMES.map((o, i) =>
    loss[i] !== null ? null : o === "execute" ? "STRUCK: OVER LIMIT" : o === "ask" ? "NOTHING TO ASK" : o === "defer" ? "NOTHING TO AWAIT" : "N/A",
  );
  const sig = d.evidenceUsed
    .filter((e) => Math.abs(e.effective) > 0.01 || e.collapsedInto)
    .map((e) => ({ w: Math.min(2.5, Math.abs(e.collapsedInto ? e.llr : e.effective)), pos: (e.collapsedInto ? e.llr : e.effective) > 0, collapsed: !!e.collapsedInto }));
  return { depth, chosen, barred, fence, struck, loss, sig };
}

const css = (n: string, f: string) => (typeof window === "undefined" ? f : getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f);

const K = 26; // ridge lines behind the front profile
const R = 9; // ball radius

export function Landscape({ d, pack }: { d: Decision; pack: Pack<any> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tgt = useRef<Target>(targetOf(d));
  const unit = useRef(pack);

  useEffect(() => {
    tgt.current = targetOf(d);
    unit.current = pack;
  }, [d, pack]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext("2d");
    if (!g) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const C = {
      bg: css("--color-bg", "#efe8d8"),
      ink: css("--color-ink", "#17140f"),
      mute: css("--color-mute", "#554d41"),
      sun: css("--color-sun", "#ffd12e"),
      pink: css("--color-pink", "#ff3d8b"),
      exec: css("--color-execute", "#2340f5"),
      red: css("--color-refuse", "#d3105e"),
      mono: css("--font-jet", "monospace"),
    };
    const colorOf = (i: number) => (OUTCOMES[i] === "execute" ? C.exec : OUTCOMES[i] === "refuse" ? C.red : C.ink);

    const S = {
      depth: reduce ? [...tgt.current.depth] : [0, 0, 0, 0, 0],
      ball: { x: reduce ? 0.1 + 0.2 * tgt.current.chosen : 0.5, y: -40, vx: 0, vy: 0, air: !reduce, angle: 0 },
      lids: [null, null, null, null, null] as ({ off: number; v: number; landed: boolean } | null)[],
      parts: [] as { x: number; y: number; px: number; py: number; vy: number; tx: number; kind: 0 | 1 | 2; a: number }[],
      shake: 0,
      t: 0,
      W: 0,
      H: 0,
    };

    let raf = 0;
    let last = performance.now();
    let visible = true;

    const geo = () => {
      const W = S.W;
      const H = S.H;
      const baseY = H * 0.43;
      const D = H * 0.36;
      const sigma = W * 0.052;
      const cx = (i: number) => W * (0.1 + 0.2 * i);
      const prof = (x: number) => {
        let y = baseY;
        for (let i = 0; i < 5; i++) {
          const dx = x - cx(i);
          y += S.depth[i] * D * Math.exp(-(dx * dx) / (2 * sigma * sigma));
        }
        return y;
      };
      const lidHalf = sigma * 1.6;
      return { W, H, baseY, D, sigma, cx, prof, lidHalf };
    };

    const step = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      S.t += dt;
      const T = tgt.current;

      // size
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (w !== S.W || h !== S.H) {
        S.W = w;
        S.H = h;
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const G = geo();
      const { W, H, baseY, cx, prof, lidHalf } = G;

      // terrain carves toward the real losses
      const k = reduce ? 1 : 1 - Math.exp(-dt * 3.2);
      for (let i = 0; i < 5; i++) S.depth[i] += (T.depth[i] - S.depth[i]) * k;

      // lids slam down over wells a hard rule forbids
      for (let i = 0; i < 5; i++) {
        if (T.barred[i]) {
          if (!S.lids[i]) S.lids[i] = { off: reduce ? 0 : -H * (0.9 + i * 0.12), v: 0, landed: reduce };
          const l = S.lids[i]!;
          if (!l.landed) {
            l.v += 5200 * dt;
            l.off += l.v * dt;
            if (l.off >= 0) {
              l.off = 0;
              l.landed = true;
              S.shake = Math.max(S.shake, 9);
            }
          }
        } else S.lids[i] = null;
      }

      // ball: a spring toward the chosen well, riding the surface (or the lids)
      const surf = (x: number) => {
        let y = prof(x);
        for (let i = 0; i < 5; i++) {
          const l = S.lids[i];
          if (l && l.landed && Math.abs(x - cx(i)) < lidHalf) y = Math.min(y, baseY - 14);
        }
        return y - R;
      };
      const b = S.ball;
      const tx = 0.1 + 0.2 * T.chosen;
      if (reduce) {
        b.x = tx;
        b.vx = 0;
        b.air = false;
      } else {
        const ax = 30 * (tx - b.x) - 7.2 * b.vx;
        b.vx += ax * dt;
        b.x += b.vx * dt;
      }
      const sy = surf(b.x * W);
      if (b.air) {
        b.vy += 2000 * dt;
        b.y += b.vy * dt;
        if (b.y >= sy) {
          b.y = sy;
          if (b.vy > 260) {
            b.vy *= -0.36;
            S.shake = Math.max(S.shake, 4);
          } else b.air = false;
        }
      } else b.y = sy;
      b.angle += (b.vx * W * dt) / R;

      // evidence rain
      if (!reduce && visible) {
        for (const s of T.sig) {
          if (S.parts.length < 170 && Math.random() < s.w * dt * 2.4) {
            const x = 0.15 + Math.random() * 0.7;
            S.parts.push({ x, y: -6, px: x, py: -6, vy: 30 + Math.random() * 60, tx: s.pos ? 0.1 : 0.9, kind: s.collapsed ? 2 : s.pos ? 0 : 1, a: 1 });
          }
        }
      }
      for (const p of S.parts) {
        p.px = p.x;
        p.py = p.y;
        p.vy += 240 * dt;
        p.y += p.vy * dt;
        p.x += (p.tx - p.x) * dt * 1.3;
        if (p.kind === 2 && p.y > H * 0.2) p.a -= dt * 3;
      }
      S.parts = S.parts.filter((p) => p.a > 0 && p.y < prof(p.x * W));

      S.shake *= Math.exp(-dt * 9);
      draw(G);
    };

    const draw = (G: ReturnType<typeof geo>) => {
      const { W, H, baseY, cx, prof, lidHalf } = G;
      const T = tgt.current;
      g.fillStyle = C.bg;
      g.fillRect(0, 0, W, H);
      g.save();
      if (S.shake > 0.2) g.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);

      // ridge lines: back to front, each occluding the ones behind it
      for (let k = K; k >= 0; k--) {
        const sc = 1 - k * 0.011;
        const amp = 1 - k * 0.028;
        const yo = -k * 7.4;
        const nz = k === 0 ? 0 : 0.25 + k / K;
        g.beginPath();
        for (let x = -12; x <= W + 12; x += 6) {
          const xx = W / 2 + (x - W / 2) * sc;
          const n = nz * (Math.sin(x * 0.011 + k * 1.31 + S.t * 0.35) * 2.4 + Math.sin(x * 0.029 - S.t * 0.23 + k * 0.71) * 1.5);
          const y = baseY + yo + (prof(x) - baseY) * amp + n;
          if (x === -12) g.moveTo(xx, y);
          else g.lineTo(xx, y);
        }
        g.lineTo(W + 12, H + 12);
        g.lineTo(-12, H + 12);
        g.closePath();
        g.fillStyle = C.bg;
        g.fill();
        g.strokeStyle = C.ink;
        g.globalAlpha = k === 0 ? 0.95 : 0.06 + 0.32 * (1 - k / K);
        g.lineWidth = k === 0 ? 1.6 : 1;
        g.stroke();
        g.globalAlpha = 1;
      }

      // glow in the chosen well
      const ci = T.chosen;
      const bx = cx(ci);
      const by = prof(bx);
      const glow = g.createRadialGradient(bx, by - 8, 0, bx, by - 8, 120);
      const halo = OUTCOMES[ci] === "execute" || OUTCOMES[ci] === "refuse" ? colorOf(ci) : C.sun;
      glow.addColorStop(0, halo + "88");
      glow.addColorStop(1, halo + "00");
      g.globalCompositeOperation = "multiply";
      g.fillStyle = glow;
      g.fillRect(bx - 125, by - 133, 250, 250);
      g.globalCompositeOperation = "source-over";

      // particles
      for (const p of S.parts) {
        g.strokeStyle = p.kind === 0 ? C.exec : p.kind === 1 ? C.red : C.mute;
        g.globalAlpha = Math.max(0, p.a) * (p.kind === 2 ? 0.6 : 0.85);
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(p.px * W, p.py - 5);
        g.lineTo(p.x * W, p.y);
        g.stroke();
      }
      g.globalAlpha = 1;

      g.font = `600 10px ${C.mono}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      (g as any).letterSpacing = "1.5px";

      // fences: cheaper wells the engine was not allowed to take
      for (let i = 0; i < 5; i++) {
        const f = T.fence[i];
        if (!f) continue;
        const x0 = cx(i) - lidHalf;
        const x1 = cx(i) + lidHalf;
        const y = baseY - 2;
        g.strokeStyle = C.ink;
        g.globalAlpha = 0.8;
        g.setLineDash([4, 4]);
        g.beginPath();
        g.moveTo(x0, y);
        g.lineTo(x1, y);
        g.stroke();
        g.setLineDash([]);
        for (let x = x0; x <= x1; x += (x1 - x0) / 6) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x, y - 9);
          g.stroke();
        }
        g.globalAlpha = 1;
        g.fillStyle = C.ink;
        g.fillText(f, cx(i), y - 20);
      }

      // struck options: no well at all
      for (let i = 0; i < 5; i++) {
        const s = T.struck[i];
        if (!s || T.barred[i]) continue;
        g.fillStyle = C.mute;
        g.fillText(s, cx(i), baseY - 16);
      }

      // lids from hard rules
      for (let i = 0; i < 5; i++) {
        const l = S.lids[i];
        if (!l) continue;
        const x0 = cx(i) - lidHalf;
        const wdt = lidHalf * 2;
        const y1 = baseY + l.off;
        const y0 = y1 - 14;
        g.fillStyle = C.bg;
        g.fillRect(x0, y0, wdt, 14);
        g.save();
        g.beginPath();
        g.rect(x0, y0, wdt, 14);
        g.clip();
        g.strokeStyle = C.red;
        g.lineWidth = 1;
        for (let x = x0 - 20; x < x0 + wdt + 20; x += 5) {
          g.beginPath();
          g.moveTo(x, y1);
          g.lineTo(x + 14, y0);
          g.stroke();
        }
        g.restore();
        g.strokeStyle = C.red;
        g.lineWidth = 1.5;
        g.strokeRect(x0 + 0.5, y0 + 0.5, wdt - 1, 14);
        g.fillStyle = C.red;
        g.fillText("BARRED BY RULE", cx(i), y0 - 12);
      }

      // the case
      const b = S.ball;
      const X = b.x * W;
      const col = colorOf(ci);
      g.fillStyle = C.ink;
      g.beginPath();
      g.arc(X + 3, b.y + 3, R + 1.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = OUTCOMES[ci] === "execute" || OUTCOMES[ci] === "refuse" ? col : C.sun;
      g.beginPath();
      g.arc(X, b.y, R + 1.5, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = C.ink;
      g.stroke();
      g.strokeStyle = C.ink;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(X, b.y);
      g.lineTo(X + Math.cos(b.angle) * (R - 2), b.y + Math.sin(b.angle) * (R - 2));
      g.stroke();
      g.strokeStyle = C.ink;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(X, b.y, R + 3.5, 0, Math.PI * 2);
      g.globalAlpha = 0.5;
      g.stroke();
      g.globalAlpha = 1;

      g.restore();

      // labels under each well
      const narrow = W < 640;
      for (let i = 0; i < 5; i++) {
        const o = OUTCOMES[i];
        const chosen = i === ci;
        g.font = `${chosen ? 700 : 500} ${narrow ? 9 : 11}px ${C.mono}`;
        (g as any).letterSpacing = narrow ? "0.5px" : "2px";
        // left-align from the measured width: canvas centring ignores letter-spacing in some engines
        const tw = g.measureText(OUTCOME[o].label).width;
        const lx = cx(i) - tw / 2;
        if (chosen) {
          g.fillStyle = C.sun;
          g.fillRect(lx - 6, H - 43, tw + 10, 18);
        }
        g.textAlign = "left";
        g.fillStyle = chosen ? (OUTCOMES[i] === "execute" || OUTCOMES[i] === "refuse" ? col : C.ink) : C.mute;
        g.fillText(OUTCOME[o].label, lx, H - 34);
        g.textAlign = "center";
        g.font = `500 ${narrow ? 10 : 11}px ${C.mono}`;
        (g as any).letterSpacing = "0px";
        g.fillStyle = chosen ? C.ink : C.mute;
        const v = T.loss[i];
        g.fillText(v === null ? "n/a" : money(unit.current, v), cx(i), H - 16);
      }
      (g as any).letterSpacing = "0px";
    };

    const loop = (now: number) => {
      raf = 0;
      step(now);
      if (visible && !reduce) raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    });
    io.observe(cv);
    raf = requestAnimationFrame(loop);

    // reduced motion: redraw on data changes only
    let rm: ReturnType<typeof setInterval> | undefined;
    if (reduce) rm = setInterval(() => step(performance.now()), 400);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      if (rm) clearInterval(rm);
    };
  }, []);

  const o = OUTCOME[d.outcome];
  return (
    <section className="reveal relative overflow-hidden border-[1.5px] border-ink bg-bg shadow-[6px_6px_0_var(--color-ink)]">
      <canvas
        ref={ref}
        className="block h-[440px] w-full"
        role="img"
        aria-label={`Decision landscape. Five wells whose depth is the expected loss of each response. The case settles in ${o.label}.`}
      />
      <div className="pointer-events-none absolute left-5 top-4 max-w-[46ch] [text-shadow:0_0_6px_var(--color-bg),0_0_14px_var(--color-bg)] sm:left-6 sm:top-5">
        <p className="display text-[30px]">Decision landscape</p>
        <p className="mt-1.5 hidden text-[13px] leading-snug text-ink/85 sm:block">Each well is one possible response, dug as deep as it is cheap. The case rolls into the one it is allowed to take.</p>
        <p className="mt-2 hidden flex-wrap gap-x-4 font-mono text-[10.5px] text-mute sm:flex">
          <span><i className="mr-1.5 inline-block h-2 w-[2px] bg-execute align-middle" />evidence for acting</span>
          <span><i className="mr-1.5 inline-block h-2 w-[2px] bg-refuse align-middle" />against</span>
          <span><i className="mr-1.5 inline-block h-2 w-[2px] bg-mute align-middle" />duplicate, discarded</span>
          <span>depth = expected loss</span>
        </p>
      </div>
      <div className="pointer-events-none absolute right-5 top-4 text-right sm:right-6 sm:top-5">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-mute">settles in</p>
        <p className="display misreg text-[48px] sm:text-[72px]" style={{ color: o.color }}>
          <SlamWord text={o.label} />
        </p>
        <p className="mt-1.5 font-mono text-[11px] text-mute">{Math.round(d.confidence.mid * 100)}% confident acting is right</p>
      </div>
    </section>
  );
}
