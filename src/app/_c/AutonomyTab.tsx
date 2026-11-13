"use client";
import { AUTONOMY_NAMES } from "@/core/decide";
import type { Pack } from "@/core/types";
import type { Calibration } from "@/ledger/calibration";
import { Btn, Panel, tint } from "./shared";

const LEVEL_COLOR = ["var(--color-refuse)", "var(--color-defer)", "var(--color-ask)", "var(--color-execute)"];
const LEVEL_DESC = [
  "Shadow: the engine drafts decisions but a human confirms every one.",
  "Assisted: tiny authority (25%), everything else goes to a human.",
  "Supervised: reduced authority (60%).",
  "Autonomous: full authority within its domain limits.",
];

export function AutonomyTab({
  pack,
  packs,
  cals,
  cal,
  badWeeks,
  extraCount,
  addWeek,
  reset,
}: {
  pack: Pack<any>;
  packs: Pack<any>[];
  cals: Record<string, Calibration>;
  cal: Calibration;
  badWeeks: number;
  extraCount: number;
  addWeek: () => void;
  reset: () => void;
}) {
  return (
    <div className="space-y-5">
      <Panel title="Earned autonomy" aside={<span className="font-mono text-[10px] text-faint">authority is a credit score, not a config value</span>}>
        <p className="max-w-3xl text-sm leading-relaxed text-mute">
          WARRANT keeps a ledger of every confidence it ever stated and what really happened. If “90% sure” only comes true 70% of the time, the engine is miscalibrated, so it <b className="text-ink">demotes itself</b>: its
          authority shrinks and eventually it drops into shadow mode where a human confirms everything. Go to <b className="text-ink">Decide</b> afterwards and watch the same easy case stop being executed.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {packs.map((p) => {
            const c = cals[p.id];
            const active = p.id === pack.id;
            return (
              <div key={p.id} className="rounded-md border px-3 py-2.5" style={{ borderColor: active ? "var(--color-ink)" : "var(--color-line)" }}>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="font-mono text-xs font-semibold" style={{ color: LEVEL_COLOR[c.autonomy] }}>L{c.autonomy}</span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-faint">ECE {c.ece.toFixed(3)} · Brier {c.brier.toFixed(3)}</div>
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title={`Reliability diagram · ${pack.name}`} aside={<span className="font-mono text-[10px] text-faint">last {cal.n} labelled outcomes</span>}>
          <Reliability cal={cal} />
          <div className="mt-3 grid grid-cols-4 gap-2 font-mono text-[11px]">
            <KV k="ECE" v={cal.ece.toFixed(3)} />
            <KV k="Brier" v={cal.brier.toFixed(3)} />
            <KV k="execute calls" v={String(cal.executeCount)} />
            <KV k="…of which wrong" v={`${cal.executeWrong} (${cal.executeCount ? Math.round((cal.executeWrong / cal.executeCount) * 100) : 0}%)`} warn={cal.executeCount > 0 && cal.executeWrong / cal.executeCount > 0.15} />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-faint">Bubbles on the diagonal mean “when I say 80% it is right 80% of the time”. Below it: overconfident. The engine is only as autonomous as this chart is honest.</p>
        </Panel>

        <Panel title="Autonomy ladder" aside={<span className="font-mono text-[10px] text-faint">{pack.name}</span>}>
          <ol className="space-y-2">
            {[3, 2, 1, 0].map((lv) => {
              const on = cal.autonomy === lv;
              return (
                <li key={lv} className="rounded-md border px-3.5 py-2.5" style={{ borderColor: on ? LEVEL_COLOR[lv] : "var(--color-line)", background: on ? tint(LEVEL_COLOR[lv], 10) : "transparent" }}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-semibold" style={{ color: LEVEL_COLOR[lv] }}>{AUTONOMY_NAMES[lv]}</span>
                    <span className="font-mono text-[10px] text-faint">{["ECE > 0.20", "ECE ≤ 0.20", "ECE ≤ 0.13", "ECE ≤ 0.08"][lv]}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-mute">{LEVEL_DESC[lv]}</p>
                  {on && <p className="mt-1 font-mono text-[11px]" style={{ color: LEVEL_COLOR[lv] }}>← now: {cal.autonomyReason}</p>}
                </li>
              );
            })}
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Btn tone="danger" onClick={addWeek}>⚠ Simulate a bad week</Btn>
            <Btn onClick={reset} disabled={!badWeeks && !extraCount}>Reset</Btn>
            <span className="font-mono text-[11px] text-faint">
              {badWeeks ? `${badWeeks} drifted week${badWeeks > 1 ? "s" : ""} (+${badWeeks * 40} outcomes)` : "no drift"}
              {extraCount ? ` · ${extraCount} outcome${extraCount > 1 ? "s" : ""} you recorded` : ""}
            </span>
          </div>
          <p className="mt-2 text-xs text-faint">A “bad week” = the world changes under the engine (a fraud ring adapts, infra shifts, a new abuse style). Its stated confidence stops matching reality.</p>
        </Panel>
      </div>
    </div>
  );
}

function KV({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div>
      <div className="label !text-[9px]">{k}</div>
      <div style={{ color: warn ? "var(--color-refuse)" : "var(--color-ink)" }}>{v}</div>
    </div>
  );
}

function Reliability({ cal }: { cal: Calibration }) {
  const S = 280;
  const pad = 30;
  const x = (p: number) => pad + p * (S - pad - 10);
  const y = (p: number) => S - pad - p * (S - pad - 10);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="mx-auto block w-full max-w-[360px]" role="img" aria-label="Reliability diagram: predicted confidence versus observed accuracy">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={y(0)} y2={y(1)} stroke="var(--color-line)" strokeWidth="0.5" />
          <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth="0.5" />
          <text x={x(t)} y={S - 12} fontSize="8" fill="var(--color-faint)" textAnchor="middle" fontFamily="var(--font-mono)">{Math.round(t * 100)}</text>
          <text x={pad - 6} y={y(t) + 3} fontSize="8" fill="var(--color-faint)" textAnchor="end" fontFamily="var(--font-mono)">{Math.round(t * 100)}</text>
        </g>
      ))}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--color-mute)" strokeDasharray="4 4" strokeWidth="1" />
      {cal.bins
        .filter((b) => b.n > 0)
        .map((b, i) => {
          const gap = b.observed - b.predicted;
          const bad = Math.abs(gap) > 0.12;
          const c = bad ? "var(--color-refuse)" : "var(--color-execute)";
          return (
            <g key={i}>
              <line x1={x(b.predicted)} x2={x(b.predicted)} y1={y(b.predicted)} y2={y(b.observed)} stroke={c} strokeWidth="1.5" opacity="0.6" />
              <circle cx={x(b.predicted)} cy={y(b.observed)} r={Math.max(3, Math.sqrt(b.n) * 1.5)} fill={c} fillOpacity="0.55" stroke={c} />
            </g>
          );
        })}
      <text x={S / 2} y={S - 1} fontSize="8.5" fill="var(--color-mute)" textAnchor="middle" fontFamily="var(--font-mono)">stated confidence (%)</text>
      <text x={9} y={S / 2} fontSize="8.5" fill="var(--color-mute)" textAnchor="middle" transform={`rotate(-90 9 ${S / 2})`} fontFamily="var(--font-mono)">actually correct (%)</text>
    </svg>
  );
}
