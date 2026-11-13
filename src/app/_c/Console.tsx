"use client";
import { useMemo, useState } from "react";
import { decide, AUTONOMY_NAMES } from "@/core/decide";
import { scaleExposure } from "@/core/flip";
import type { AutonomyLevel, Decision, FieldSpec, Flip, Outcome, Pack } from "@/core/types";
import type { AuditRecord } from "@/ledger/audit";
import type { Calibration } from "@/ledger/calibration";
import type { SensorReport } from "@/sensors/llm";
import { DecisionMap } from "./DecisionMap";
import { Landscape } from "./Landscape";
import { Btn, OUTCOME, OUTCOMES, Panel, Swatch, Tag, money, pct, tint } from "./shared";

export type Input = Record<string, any>;

interface ServerResult {
  key: string;
  decision: Decision;
  warrant: string | null;
  sensors: SensorReport;
  seq: number;
}
interface LogLine {
  ok: boolean;
  title: string;
  detail: string;
}

export interface ConsoleProps {
  pack: Pack<any>;
  packId: string;
  variant: "guarded" | "naive";
  input: Input;
  setInput: (fn: (p: Input) => Input) => void;
  scenarioId: string | null;
  pickScenario: (id: string) => void;
  stakeScale: number;
  setStakeScale: (n: number) => void;
  autonomy: AutonomyLevel;
  cal: Calibration;
  calParams: { badWeeks: number; extra: [number, boolean][] };
  sensors: "offline" | "llm";
  setSensors: (s: "offline" | "llm") => void;
  llmAvailable: boolean;
  tip: AuditRecord | null;
  addRecord: (r: AuditRecord) => void;
  recordOutcome: (p: number, correct: boolean) => void;
  goAutonomy: () => void;
}

/** Stable, human-readable serial for the document on screen. */
function serial(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const x = (h >>> 0).toString(16).toUpperCase().padStart(8, "0");
  return `W-${x.slice(0, 4)}-${x.slice(4)}`;
}

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function Console(p: ConsoleProps) {
  const { pack, input, autonomy, stakeScale } = p;
  const [server, setServer] = useState<ServerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [labelled, setLabelled] = useState<string | null>(null);

  const baseExposure = useMemo(() => pack.exposure(input), [pack, input]);
  const exposure = useMemo(() => (stakeScale === 1 ? baseExposure : scaleExposure(baseExposure, stakeScale)), [baseExposure, stakeScale]);
  const local = useMemo(
    () => decide(pack, input, { state: { autonomy }, exposureOverride: stakeScale === 1 ? undefined : exposure }),
    [pack, input, autonomy, stakeScale, exposure],
  );
  const key = JSON.stringify({ id: pack.policyVersion, input, autonomy, s: p.sensors });
  const fresh = server && server.key === key ? server : null;
  const d: Decision = fresh ? fresh.decision : local;
  const signals = useMemo(() => [...pack.extract(input), ...(fresh?.sensors.signals ?? [])], [pack, input, fresh]);
  const dec = OUTCOME[d.outcome];
  const isExec = d.outcome === "execute";
  const serialNo = useMemo(() => serial(key + stakeScale), [key, stakeScale]);

  async function run() {
    setBusy(true);
    setErr(null);
    setLabelled(null);
    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packId: p.packId, variant: p.variant, input, sensors: p.sensors, calibration: p.calParams, prev: p.tip }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "request failed");
      p.addRecord(j.record);
      setServer({ key, decision: j.decision, warrant: j.warrant, sensors: j.sensors, seq: j.record?.seq ?? 0 });
      setLog([]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(mode: "valid" | "none" | "tampered") {
    if (!fresh) return;
    let sendInput: Input = input;
    let note = "";
    if (mode === "tampered") {
      const f = pack.fields.find((x) => x.type === "number");
      if (f) {
        sendInput = { ...input, [f.key]: Math.round(Number(input[f.key] ?? 1) * 10 + 7) };
        note = `${f.label} ${input[f.key]} to ${sendInput[f.key]}`;
      }
    }
    const warrant = mode === "none" ? undefined : (fresh.warrant ?? undefined);
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packId: p.packId, variant: p.variant, input: sendInput, warrant, prev: p.tip }),
      });
      const j = await res.json();
      if (j.record) p.addRecord(j.record);
      const title = mode === "valid" ? "Presented the warrant" : mode === "none" ? "Called the tool without a warrant" : `Altered the action after signing (${note})`;
      setLog((l) => [{ ok: !!j.ok, title, detail: j.ok ? j.result : `403, ${j.reason ?? j.error}` }, ...l]);
    } catch (e) {
      setLog((l) => [{ ok: false, title: "Actuator error", detail: (e as Error).message }, ...l]);
    }
  }

  const applyFlip = (f: Flip) => {
    if (f.patch.type === "scale") p.setStakeScale(Number((stakeScale * f.patch.factor).toFixed(4)));
    else if (f.patch.type === "supply" && f.patch.field) {
      const { key: k, value } = f.patch.field;
      p.setInput((cur) => ({ ...cur, [k]: value }));
    }
  };
  const resolveField = (field: { key: string; good: string; bad: string }, good: boolean) =>
    p.setInput((cur) => ({ ...cur, [field.key]: good ? field.good : field.bad }));

  const sc = pack.scenarios.find((s) => s.id === p.scenarioId);
  const counted = d.evidenceUsed.filter((e) => !e.collapsedInto).length;
  const collapsed = d.evidenceUsed.filter((e) => e.collapsedInto).length;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,310px)_minmax(0,1fr)]">
      {/* ─────────── docket + case file ─────────── */}
      <aside className="scroll-thin space-y-10 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-3">
        <section>
          <h2 className="text-[15px] font-semibold tracking-tight">Docket</h2>
          <p className="mt-1 text-[12.5px] leading-snug text-mute">{pack.scenarios.length} cases, each built to land on a specific outcome.</p>
          <ol className="mt-3 border-t border-ink">
            {pack.scenarios.map((s) => {
              const active = s.id === p.scenarioId;
              return (
                <li key={s.id}>
                  <button
                    onClick={() => p.pickScenario(s.id)}
                    aria-current={active ? "true" : undefined}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-line py-2.5 pl-3 pr-2 text-left transition-colors hover:bg-panel"
                    style={active ? { background: "var(--color-panel)", boxShadow: "inset 3px 0 0 var(--color-ink)" } : undefined}
                  >
                    <span>
                      <span className="block text-[13.5px] font-medium leading-snug">{s.title}</span>
                      {active && s.blurb && <span className="rise mt-1 block text-[12px] leading-snug text-mute">{s.blurb}</span>}
                    </span>
                    {s.expected && (
                      <span className="pt-0.5">
                        <Tag o={s.expected} size="sm" />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold tracking-tight">Case file</h2>
          <p className="mt-1 text-[12.5px] leading-snug text-mute">Edit any field. The verdict is recomputed as you type.</p>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-ink pt-4">
            {pack.fields.map((f) => (
              <Field key={f.key} f={f} value={input[f.key]} onChange={(v) => p.setInput((c) => ({ ...c, [f.key]: v }))} />
            ))}
          </div>
        </section>
      </aside>

      {/* ─────────── the instrument ─────────── */}
      <div className="min-w-0 space-y-10">
        {autonomy < 3 && (
          <button onClick={p.goAutonomy} className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 border border-ink bg-panel px-4 py-3 text-left text-[13px] leading-snug">
            <span className="bg-ink px-1.5 py-0.5 font-mono text-[11px] font-semibold text-panel">{AUTONOMY_NAMES[autonomy]}</span>
            <span className="text-ink">
              {p.cal.autonomyReason}. Authority is reduced{autonomy === 0 ? " and every decision now needs a human" : ""}. <span className="underline underline-offset-2">Open calibration</span>
            </span>
          </button>
        )}

        <Landscape d={d} pack={pack} />

        <article className="relative border border-line bg-panel shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_40px_80px_-40px_rgba(0,0,0,0.9)]">
          <Guilloche active={isExec} />
          <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line px-6 py-3 md:px-10">
            <span className="text-[13px] font-semibold tracking-tight">{isExec ? "Warrant to act" : "Stay of action"}</span>
            <span className="flex flex-wrap gap-x-4 font-mono text-[11px] text-mute">
              <span>No. {serialNo}</span>
              <span>{pack.policyVersion}</span>
              <span>{AUTONOMY_NAMES[autonomy]}</span>
            </span>
          </header>

          <div className="px-6 pt-8 md:px-10">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[12px] text-mute">Proposed by the agent</span>
              <span className="border border-line px-1.5 py-px font-mono text-[10.5px] text-mute">{fresh ? `logged, ${fresh.sensors.mode} sensors` : "draft, not logged"}</span>
            </div>
            <p className="mt-2 font-mono text-[15px] leading-snug text-ink md:text-[16px]">{d.action}</p>

            <div className="relative mt-8">
              <h2 aria-live="polite" className="pb-1 text-[60px] font-semibold leading-[0.95] tracking-[-0.04em] sm:text-[80px] lg:text-[96px]" style={{ color: dec.color }}>
                {titleCase(dec.label)}
              </h2>
              {fresh && (
                <div key={`${fresh.key}${fresh.seq}`} className="stamp hidden md:block" style={{ color: dec.color }}>
                  <div className="border-[3px] border-double px-4 py-2 text-center" style={{ borderColor: dec.color }}>
                    <div className="font-mono text-[15px] font-bold tracking-[0.2em]">{dec.stamp}</div>
                    <div className="mt-0.5 font-mono text-[10px] tracking-[0.12em]">AUDIT RECORD #{fresh.seq}</div>
                  </div>
                </div>
              )}
            </div>
            {d.shadowed && <p className="mt-3 font-mono text-[12px] text-ink">Shadow mode. The engine would have executed, but its calibration has not earned that right.</p>}
            <p className="mt-4 max-w-[62ch] text-[15.5px] leading-relaxed text-ink/85">{d.reason}</p>
            {d.nextStep && (
              <p className="mt-3 max-w-[62ch] text-[13.5px] leading-relaxed text-mute">
                <span className="font-semibold text-ink">Next.</span> {d.nextStep}
              </p>
            )}
          </div>

          <div className="mt-9 border-t border-line px-6 py-5 md:px-10">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-[13px] font-medium">Confidence that acting is correct</span>
              <span className="font-mono text-[12.5px] text-mute">
                <b className="text-[15px] text-ink">{pct(d.confidence.mid)}</b> range {pct(d.confidence.lo)} to {pct(d.confidence.hi)}, decision-grade {pct(d.confidence.effective)}
              </span>
            </div>
            <Ruler lo={d.confidence.lo} mid={d.confidence.mid} hi={d.confidence.hi} effective={d.confidence.effective} />
          </div>

          <dl className="grid grid-cols-2 border-t border-line md:grid-cols-4">
            <Fig k="At stake" v={money(pack, d.exposure.harm)} />
            <Fig k="Risk if we act" v={`${Math.round(d.riskScore * 100)}`} unit="/100" />
            <Fig k="Reversibility" v={pct(d.reversibility.value)} note={d.reversibility.note} />
            <Fig k="Value of asking" v={money(pack, d.evoi)} note={d.runnerUp ? `Margin over ${d.runnerUp}: ${money(pack, d.margin)}` : undefined} />
          </dl>

          {d.missingInfo.length > 0 && (
            <div className="border-t border-line px-6 py-5 md:px-10">
              <p className="text-[13px] font-medium">Outstanding before this can be signed</p>
              <ul className="mt-3 space-y-3">
                {d.missingInfo.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-ink pl-3">
                    <div className="min-w-0">
                      <p className="text-[14px]">
                        {m.label}
                        <span className="ml-2 font-mono text-[10.5px] text-mute">{m.askable ? "ask the requester" : `arrives by itself${m.eta ? `, ${m.eta}` : ""}`}</span>
                      </p>
                      {m.question && <p className="mt-0.5 text-[12.5px] text-mute">“{m.question}”</p>}
                    </div>
                    {m.field && (
                      <div className="flex shrink-0 gap-2">
                        <Btn small onClick={() => resolveField(m.field!, true)}>
                          {m.askable ? "Answer checks out" : "Arrives clean"}
                        </Btn>
                        <Btn small tone="danger" onClick={() => resolveField(m.field!, false)}>
                          {m.askable ? "Answer is a red flag" : "Arrives bad"}
                        </Btn>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line px-6 py-4 md:px-10">
            <Btn tone="primary" onClick={run} disabled={busy || stakeScale !== 1} title={stakeScale !== 1 ? "Reset the what-if stakes first" : "Run on the server: issues a warrant or a stay and appends a sealed audit record"}>
              {busy ? "Signing…" : fresh ? "Log again" : "Decide and log"}
            </Btn>
            <label className="flex items-center gap-2 text-[12.5px] text-mute" title={p.llmAvailable ? "" : "Set AI_GATEWAY_API_KEY and WARRANT_MODE=llm to enable"}>
              <input type="checkbox" className="accent-ink" disabled={!p.llmAvailable} checked={p.sensors === "llm"} onChange={(e) => p.setSensors(e.target.checked ? "llm" : "offline")} />
              LLM sensors, doubt only{!p.llmAvailable && " (no API key on this deployment)"}
            </label>
            {stakeScale !== 1 && (
              <button className="ml-auto border border-ink px-2 py-1 font-mono text-[11px]" onClick={() => p.setStakeScale(1)}>
                What-if stakes ×{stakeScale.toFixed(2)}. Reset
              </button>
            )}
            {err && <span className="text-[12.5px] text-refuse">{err}</span>}
          </div>
          {fresh && fresh.sensors.notes.length > 0 && (
            <ul className="border-t border-line px-6 py-2.5 font-mono text-[11px] text-mute md:px-10">
              {fresh.sensors.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}

          {/* the stub: what the tool actually receives */}
          <div className="stub relative border-t border-dashed border-ink/35 bg-raised/60 px-6 py-6 md:px-10">
            {!fresh ? (
              <p className="max-w-[62ch] text-[13.5px] leading-relaxed text-mute">
                Logging the decision issues either a signed warrant (only for <span style={{ color: OUTCOME.execute.color }}>execute</span>) or a stay. The tool on the other side checks it before it touches
                anything.
              </p>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13.5px] font-semibold">{fresh.warrant ? "Warrant stub, presented to the tool" : "No warrant issued"}</span>
                  <span className="font-mono text-[10.5px] text-mute">
                    {fresh.warrant ? "HMAC-SHA256, single use, expires in 5 minutes" : `${OUTCOME[fresh.decision.outcome].label} never mints one`}
                  </span>
                </div>
                {fresh.warrant ? (
                  <WarrantClaims token={fresh.warrant} />
                ) : (
                  <p className="text-[13.5px] text-mute">Anything sent to the tool for this case will be refused.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Btn onClick={() => act("valid")} disabled={!fresh.warrant}>
                    Present the warrant
                  </Btn>
                  <Btn tone="danger" onClick={() => act("none")}>
                    Call without one
                  </Btn>
                  <Btn tone="danger" onClick={() => act("tampered")} disabled={!fresh.warrant} title="Change the action after the decision, then reuse the warrant">
                    Alter the action, reuse it
                  </Btn>
                </div>
                {log.length > 0 && (
                  <ul className="space-y-2.5">
                    {log.map((l, i) => (
                      <li key={i} className="rise border-l-2 pl-3 font-mono text-[12px] leading-snug" style={{ borderColor: l.ok ? "var(--color-execute)" : "var(--color-refuse)" }}>
                        <span className="font-semibold" style={{ color: l.ok ? "var(--color-execute)" : "var(--color-refuse)" }}>
                          {l.ok ? "EXECUTED" : "REFUSED"}
                        </span>{" "}
                        <span className="text-ink">{l.title}</span>
                        <div className="mt-0.5 text-mute">{l.detail}</div>
                      </li>
                    ))}
                  </ul>
                )}
                {log.some((l) => l.ok) && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4 text-[12.5px] text-mute">
                    Close the loop. Was that action actually right?
                    <Btn small disabled={!!labelled} onClick={() => { p.recordOutcome(d.confidence.mid, true); setLabelled("right"); }}>
                      Yes
                    </Btn>
                    <Btn small tone="danger" disabled={!!labelled} onClick={() => { p.recordOutcome(d.confidence.mid, false); setLabelled("wrong"); }}>
                      No, it was wrong
                    </Btn>
                    {labelled && <span>Recorded in the calibration ledger.</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        </article>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
          <Panel title="Territory" aside={<span className="text-[12px] text-mute">where each outcome wins, at every confidence and stake</span>}>
            <DecisionMap pack={pack} input={input} signals={signals} exposure={exposure} state={{ autonomy }} mid={d.confidence.mid} outcome={d.outcome} />
          </Panel>
          <Panel title="Expected loss" aside={<span className="text-[12px] text-mute">lowest wins</span>}>
            <LossLedger d={d} pack={pack} />
          </Panel>
        </div>

        <Panel title="What would change the verdict" aside={<span className="text-[12px] text-mute">smallest single changes that flip the outcome</span>}>
          {local.flips.length === 0 ? (
            <p className="text-[13.5px] text-mute">
              {d.trace.some((t) => t.gate === "G0" && t.effect === "block")
                ? "Nothing about the evidence can change this. A hard rule decided it; only the facts that rule tests could."
                : "No single change flips this decision. It is robust."}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {local.flips.map((f, i) => {
                const clickable = f.patch.type === "scale" || (f.patch.type === "supply" && !!f.patch.field);
                return (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="text-[13.5px]">{f.change}</span>
                    <span className="flex items-center gap-3">
                      <Tag o={f.to} size="sm" />
                      {clickable ? (
                        <Btn small onClick={() => applyFlip(f)}>
                          Apply
                        </Btn>
                      ) : (
                        <span className="font-mono text-[10.5px] text-mute">hypothetical</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Evidence" aside={<span className="font-mono text-[11px] text-mute">{counted} counted, {collapsed} collapsed</span>}>
            <Evidence d={d} />
          </Panel>
          <Panel title="Reasoning trace" aside={<span className="font-mono text-[11px] text-mute">{pack.policyVersion}</span>}>
            <ol className="space-y-3">
              {d.trace.map((t, i) => (
                <li key={i} className="grid grid-cols-[34px_1fr] gap-3">
                  <span
                    className="h-fit border px-1 py-0.5 text-center font-mono text-[10.5px] font-semibold"
                    style={{
                      color: t.effect === "block" ? "var(--color-refuse)" : t.effect === "pass" ? "var(--color-execute)" : "var(--color-ink)",
                      borderColor: t.effect === "block" ? "var(--color-refuse)" : t.effect === "pass" ? "var(--color-execute)" : "var(--color-line)",
                    }}
                  >
                    {t.gate}
                  </span>
                  <div>
                    <p className="text-[13.5px] font-medium leading-tight">{t.title}</p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-mute">{t.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
        {sc?.tags?.includes("failure-test") && (
          <p className="border-l-2 border-refuse pl-3 text-[13px] text-mute">
            This is the deliberate failure case. The <b className="text-ink">Failure test</b> tab shows v1 approving it at 99% and how v2 stops it.
          </p>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── pieces ─────────────────────────── */

const GUILLOCHE = (() => {
  const W = 1200;
  const H = 56;
  const N = 12;
  const out: string[] = [];
  for (let i = 0; i < N; i++) {
    const ph = (i / N) * Math.PI * 2;
    let d = "";
    for (let x = 0; x <= W; x += 3) {
      const y = H / 2 + 19 * Math.sin(x * 0.034 + ph) * Math.cos(x * 0.0071 - ph * 0.5) + 3.5 * Math.sin(x * 0.21 + ph * 2);
      d += `${x === 0 ? "M" : "L"}${x} ${y.toFixed(2)}`;
    }
    out.push(d);
  }
  return out;
})();

/** Generated security-print band, like a banknote or passport. Cobalt only on a valid warrant. */
function Guilloche({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 1200 56" preserveAspectRatio="none" className="block h-14 w-full border-b border-line" aria-hidden>
      {GUILLOCHE.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={active ? "var(--color-execute)" : "var(--color-ink)"} strokeOpacity={active ? 0.6 : 0.22} strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

function Ruler({ lo, mid, hi, effective }: { lo: number; mid: number; hi: number; effective: number }) {
  return (
    <div className="relative mt-4 h-10">
      <div className="absolute inset-x-0 top-[14px] h-px bg-ink/70" />
      {Array.from({ length: 21 }, (_, i) => (
        <div key={i} className="absolute top-[10px] w-px bg-ink/45" style={{ left: `${i * 5}%`, height: i % 10 === 0 ? 10 : i % 2 === 0 ? 7 : 4 }} />
      ))}
      <div className="absolute top-[6px] h-[16px] w-px bg-refuse" style={{ left: "60%" }} title="Confidence floor for autonomous action" />
      <div className="absolute top-[10px] h-[9px] transition-all duration-500" style={{ left: `${lo * 100}%`, width: `${Math.max(0.5, (hi - lo) * 100)}%`, background: tint("var(--color-execute)", 40) }} />
      <div className="absolute top-[3px] h-[23px] w-[2px] -translate-x-1/2 bg-ink transition-all duration-500" style={{ left: `${mid * 100}%` }} title="Point estimate" />
      <div
        className="absolute top-[22px] h-0 w-0 -translate-x-1/2 border-x-[5px] border-b-[7px] border-x-transparent transition-all duration-500"
        style={{ left: `${effective * 100}%`, borderBottomColor: "var(--color-execute)" }}
        title="Decision-grade confidence"
      />
      <div className="absolute inset-x-0 top-[30px] font-mono text-[10px] text-mute">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: "50%" }}>50</span>
        <span className="absolute -translate-x-1/2 text-refuse" style={{ left: "60%" }}>floor</span>
        <span className="absolute right-0">100</span>
      </div>
    </div>
  );
}

function Fig({ k, v, unit, note }: { k: string; v: string; unit?: string; note?: string }) {
  return (
    <div className="border-b border-r border-line px-6 py-4 last:border-r-0 md:border-b-0 md:px-10 md:[&:not(:first-child)]:pl-6 md:[&:not(:last-child)]:pr-6">
      <dt className="text-[12px] text-mute">{k}</dt>
      <dd className="mt-1 font-mono text-[22px] leading-none tracking-tight text-ink">
        {v}
        {unit && <span className="text-[13px] text-mute">{unit}</span>}
      </dd>
      {note && <p className="mt-1.5 text-[11.5px] leading-snug text-mute">{note}</p>}
    </div>
  );
}

function LossLedger({ d, pack }: { d: Decision; pack: Pack<any> }) {
  const finite = OUTCOMES.map((o) => d.lossTable[o]).filter((v): v is number => v !== null);
  const max = Math.max(...finite, 1);
  const scale = (v: number) => Math.log1p(v) / Math.log1p(max);
  return (
    <div>
      <ul>
        {OUTCOMES.map((o) => {
          const v = d.lossTable[o];
          const chosen = o === d.outcome;
          return (
            <li key={o} className={`grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-2.5 first:pt-0 ${v === null ? "opacity-45" : ""}`}>
              <Swatch o={o} size={14} />
              <div className="min-w-0">
                <span className={`font-mono text-[12.5px] ${chosen ? "font-semibold text-ink" : "text-mute"}`}>
                  {o}
                  {chosen && <span className="ml-2 bg-ink px-1 text-[9.5px] font-semibold tracking-[0.08em] text-panel">CHOSEN</span>}
                </span>
                {v !== null && <div className="mt-1.5 h-[3px] transition-[width] duration-500" style={{ width: `${Math.max(2, scale(v) * 100)}%`, background: chosen ? "var(--color-ink)" : tint("var(--color-ink)", 22) }} />}
              </div>
              <span className="font-mono text-[13px] text-ink">{v === null ? "n/a" : money(pack, v)}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-[12px] leading-relaxed text-mute">
        Bars are log scale. Execute is struck when stakes exceed authority or confidence is under the 60% floor. Ask and defer only exist when something is missing that a question or time can supply.
        {d.outcome !== argmin(d) && " The chosen option differs from the cheapest because a hard rule, the close-call margin, or shadow mode overrode it."}
      </p>
    </div>
  );
}
const argmin = (d: Decision): Outcome => OUTCOMES.filter((o) => d.lossTable[o] !== null).sort((a, b) => d.lossTable[a]! - d.lossTable[b]!)[0];

function Evidence({ d }: { d: Decision }) {
  const rows = [...d.evidenceUsed].filter((e) => Math.abs(e.llr) > 0).sort((a, b) => Math.abs(b.effective) - Math.abs(a.effective));
  if (!rows.length) return <p className="text-[13.5px] text-mute">No evidence yet.</p>;
  const max = Math.max(...rows.map((r) => Math.abs(r.llr)), 1);
  return (
    <ul className="space-y-3">
      {rows.map((e) => {
        const pos = e.effective > 0;
        const c = pos ? "var(--color-execute)" : "var(--color-refuse)";
        return (
          <li key={e.id} className={e.collapsedInto ? "opacity-50" : ""}>
            <div className="flex items-baseline justify-between gap-3">
              <span className={`text-[13.5px] leading-tight ${e.collapsedInto ? "line-through" : ""}`}>{e.label}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-mute">
                {e.origin} <span className="ml-1 text-ink">{pos ? "+" : ""}{e.effective.toFixed(2)}</span>
              </span>
            </div>
            <div className="relative mt-1.5 h-2">
              <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
              <div className="absolute left-1/2 top-[-2px] h-3 w-px bg-ink/50" />
              <div
                className="absolute top-0 h-2"
                style={{ background: c, left: pos ? "50%" : `${50 - (Math.abs(e.effective) / max) * 50}%`, width: `${(Math.abs(e.effective) / max) * 50}%` }}
              />
            </div>
            {e.collapsedInto ? (
              <p className="mt-1 font-mono text-[10.5px] text-ink">Same source as “{e.group}”. Counted once.</p>
            ) : (
              e.detail && <p className="mt-1 text-[11.5px] leading-snug text-mute">{e.detail}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function decodeClaims(token: string): Record<string, any> | null {
  try {
    const b = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b));
  } catch {
    return null;
  }
}

function WarrantClaims({ token }: { token: string }) {
  const c = decodeClaims(token);
  return (
    <div>
      <p className="break-all font-mono text-[11px] leading-snug text-mute">{token.slice(0, 96)}…</p>
      {c && (
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-[11.5px] sm:grid-cols-4">
          <div>
            <dt className="text-mute">decision</dt>
            <dd className="text-ink">{c.decisionId}</dd>
          </div>
          <div>
            <dt className="text-mute">bound to action</dt>
            <dd className="text-ink">{String(c.actionHash).slice(0, 12)}…</dd>
          </div>
          <div>
            <dt className="text-mute">confidence</dt>
            <dd className="text-ink">{pct(c.confidence)}</dd>
          </div>
          <div>
            <dt className="text-mute">expires</dt>
            <dd className="text-ink">{new Date(c.exp).toLocaleTimeString()}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function Field({ f, value, onChange }: { f: FieldSpec; value: any; onChange: (v: any) => void }) {
  const base = "w-full border-0 border-b border-ink/30 bg-transparent px-0 py-1 font-mono text-[13px] text-ink transition-colors hover:border-ink/60 focus:border-ink focus:outline-none";
  const wide = f.type === "text";
  const id = `f-${f.key}`;
  return (
    <div className={wide ? "col-span-2" : ""}>
      <label htmlFor={id} className="block pb-1 font-mono text-[10px] uppercase leading-tight tracking-[0.06em] text-mute">
        {f.label}
      </label>
      {f.type === "number" && (
        <input id={id} type="number" className={base} value={value ?? 0} min={f.min} max={f.max} step={f.step ?? 1} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />
      )}
      {f.type === "select" && (
        <select id={id} className={`${base} cursor-pointer`} value={value} onChange={(e) => onChange(e.target.value)}>
          {f.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      )}
      {f.type === "boolean" && (
        <button id={id} type="button" onClick={() => onChange(!value)} className={`${base} text-left`} aria-pressed={!!value}>
          {value ? "yes" : "no"}
        </button>
      )}
      {f.type === "text" && <textarea id={id} className="min-h-[72px] w-full border border-ink/30 bg-panel p-2 font-mono text-[12.5px] leading-snug text-ink focus:border-ink focus:outline-none" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}
