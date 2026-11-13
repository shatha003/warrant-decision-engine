"use client";
import { useMemo, useState } from "react";
import { decide, AUTONOMY_NAMES } from "@/core/decide";
import { scaleExposure } from "@/core/flip";
import type { AutonomyLevel, Decision, FieldSpec, Flip, Outcome, Pack } from "@/core/types";
import type { AuditRecord } from "@/ledger/audit";
import type { Calibration } from "@/ledger/calibration";
import type { SensorReport } from "@/sensors/llm";
import { DecisionMap } from "./DecisionMap";
import { Btn, Meter, OUTCOME, OUTCOMES, Panel, Tag, money, pct, tint } from "./shared";

export type Input = Record<string, any>;

interface ServerResult {
  key: string;
  decision: Decision;
  warrant: string | null;
  sensors: SensorReport;
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
      setServer({ key, decision: j.decision, warrant: j.warrant, sensors: j.sensors });
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
        note = `${f.label}: ${input[f.key]} → ${sendInput[f.key]}`;
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
      const title = mode === "valid" ? "Run WITH warrant" : mode === "none" ? "Run WITHOUT warrant" : `Run with TAMPERED action (${note})`;
      setLog((l) => [{ ok: !!j.ok, title, detail: j.ok ? j.result : `403 refused · ${j.reason ?? j.error}` }, ...l]);
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

  return (
    <div className="grid gap-5 lg:grid-cols-[330px_minmax(0,1fr)]">
      {/* ─────────────── LEFT: scenarios + case editor ─────────────── */}
      <aside className="space-y-4">
        <Panel title="Scenarios">
          <ul className="space-y-1.5">
            {pack.scenarios.map((s) => {
              const active = s.id === p.scenarioId;
              return (
                <li key={s.id}>
                  <button
                    onClick={() => p.pickScenario(s.id)}
                    className="w-full rounded-md border px-3 py-2 text-left transition-colors hover:border-faint"
                    style={{ borderColor: active ? "var(--color-ink)" : "var(--color-line)", background: active ? "var(--color-raised)" : "transparent" }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium leading-tight">{s.title}</span>
                      {s.expected && (
                        <span className="font-mono text-[10px]" style={{ color: OUTCOME[s.expected].color }}>
                          {OUTCOME[s.expected].glyph} {s.expected}
                        </span>
                      )}
                    </div>
                    {active && <p className="mt-1 text-xs leading-snug text-mute">{s.blurb}</p>}
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="Case editor · live">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            {pack.fields.map((f) => (
              <Field key={f.key} f={f} value={input[f.key]} onChange={(v) => p.setInput((c) => ({ ...c, [f.key]: v }))} />
            ))}
          </div>
        </Panel>
      </aside>

      {/* ─────────────── RIGHT: the decision ─────────────── */}
      <div className="min-w-0 space-y-5">
        {autonomy < 3 && (
          <button
            onClick={p.goAutonomy}
            className="w-full rounded-lg border px-4 py-2.5 text-left text-sm"
            style={{ borderColor: tint("var(--color-defer)", 45), background: tint("var(--color-defer)", 10), color: "var(--color-defer)" }}
          >
            <b>{AUTONOMY_NAMES[autonomy]}</b>: {p.cal.autonomyReason}. Authority is reduced{autonomy === 0 ? " and the engine only runs in shadow mode" : ""}. <u>See calibration →</u>
          </button>
        )}

        {/* verdict */}
        <section className="rise overflow-hidden rounded-lg border" style={{ borderColor: tint(dec.color, 40), background: `linear-gradient(120deg, ${tint(dec.color, 9)}, transparent 60%), var(--color-panel)` }}>
          <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="label">proposed action</span>
                {!fresh && <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint">live preview · not logged</span>}
                {fresh && <span className="rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ color: dec.color, background: tint(dec.color, 14) }}>logged · {fresh.sensors.mode} sensors</span>}
              </div>
              <p className="font-mono text-[13px] leading-snug text-ink">{d.action}</p>
              <div className="mt-4 flex items-center gap-3" aria-live="polite">
                <span className="text-5xl font-semibold leading-none tracking-tight sm:text-6xl" style={{ color: dec.color }}>
                  <span aria-hidden className="mr-2 inline-block w-[0.9em] text-center">{dec.glyph}</span>
                  {dec.label}
                </span>
              </div>
              {d.shadowed && <p className="mt-2 font-mono text-xs text-defer">shadow mode: the engine would have said EXECUTE</p>}
              <p className="mt-3 text-sm leading-relaxed text-ink/90">{d.reason}</p>
              {d.nextStep && (
                <p className="mt-2 rounded border border-line bg-bg/40 px-3 py-2 text-xs leading-relaxed text-mute">
                  <b className="text-ink">Next:</b> {d.nextStep}
                </p>
              )}
            </div>

            <div className="space-y-3.5">
              <ConfidenceBar d={d} />
              <Meter value={d.riskScore} color={d.riskScore > 0.5 ? "var(--color-refuse)" : d.riskScore > 0.2 ? "var(--color-defer)" : "var(--color-execute)"} label="risk score if we act" right={`${Math.round(d.riskScore * 100)}/100`} />
              <Meter value={d.reversibility.value} color="var(--color-ask)" label="reversibility" right={pct(d.reversibility.value)} />
              <p className="text-[11px] leading-snug text-faint">{d.reversibility.note}</p>
              <div className="grid grid-cols-3 gap-2 border-t border-line pt-3 font-mono text-[11px]">
                <Stat k="at stake" v={money(pack, d.exposure.harm)} />
                <Stat k="margin" v={d.runnerUp ? money(pack, d.margin) : "-"} />
                <Stat k="EVOI(ask)" v={money(pack, d.evoi)} />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-line bg-bg/30 px-5 py-3">
            <Btn tone="primary" onClick={run} disabled={busy || stakeScale !== 1} title={stakeScale !== 1 ? "Reset the what-if stakes first" : "Run through the server: mints a warrant if allowed, appends a sealed audit record"}>
              {busy ? "Deciding…" : fresh ? "Re-run & log" : "Decide & log"} <span className="ml-1 opacity-60">⏎ signed</span>
            </Btn>
            <label className="flex items-center gap-2 text-xs text-mute" title={p.llmAvailable ? "" : "Set AI_GATEWAY_API_KEY and WARRANT_MODE=llm to enable"}>
              <input
                type="checkbox"
                disabled={!p.llmAvailable}
                checked={p.sensors === "llm"}
                onChange={(e) => p.setSensors(e.target.checked ? "llm" : "offline")}
              />
              LLM sensors <span className="text-faint">(pre-mortem is doubt-only){!p.llmAvailable && " · off: no API key"}</span>
            </label>
            {stakeScale !== 1 && (
              <button className="ml-auto rounded border border-defer/40 px-2 py-1 font-mono text-[11px] text-defer" onClick={() => p.setStakeScale(1)}>
                what-if stakes ×{stakeScale.toFixed(2)} · reset
              </button>
            )}
            {err && <span className="text-xs text-refuse">{err}</span>}
          </div>
          {fresh && fresh.sensors.notes.length > 0 && (
            <ul className="border-t border-line px-5 py-2.5 font-mono text-[11px] text-faint">
              {fresh.sensors.notes.map((n, i) => (
                <li key={i}>• {n}</li>
              ))}
            </ul>
          )}
        </section>

        {/* missing information */}
        {d.missingInfo.length > 0 && (
          <Panel title="Missing information" aside={<span className="font-mono text-[10px] text-faint">resolve it and watch the decision move</span>}>
            <ul className="divide-y divide-line">
              {d.missingInfo.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm">
                      {m.label}{" "}
                      <span className="ml-1 rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ color: m.askable ? OUTCOME.ask.color : OUTCOME.defer.color, background: tint(m.askable ? OUTCOME.ask.color : OUTCOME.defer.color, 14) }}>
                        {m.askable ? "ask the requester" : `arrives by itself${m.eta ? ` · ${m.eta}` : ""}`}
                      </span>
                    </p>
                    {m.question && <p className="mt-0.5 text-xs text-mute">“{m.question}”</p>}
                  </div>
                  {m.field && (
                    <div className="flex shrink-0 gap-1.5">
                      <Btn small onClick={() => resolveField(m.field!, true)}>
                        {m.askable ? "answer: checks out" : "arrives: good"}
                      </Btn>
                      <Btn small tone="danger" onClick={() => resolveField(m.field!, false)}>
                        {m.askable ? "answer: red flag" : "arrives: bad"}
                      </Btn>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {/* map + loss table */}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Panel title="Decision map" aside={<span className="font-mono text-[10px] text-faint">where each outcome wins</span>}>
            <DecisionMap pack={pack} input={input} signals={signals} exposure={exposure} state={{ autonomy }} mid={d.confidence.mid} outcome={d.outcome} />
          </Panel>
          <Panel title="Expected loss per option" aside={<span className="font-mono text-[10px] text-faint">lower wins</span>}>
            <LossBars d={d} pack={pack} />
          </Panel>
        </div>

        {/* flip lab */}
        <Panel title="Flip lab · what would change my mind?" aside={<span className="font-mono text-[10px] text-faint">minimal single changes that flip the outcome</span>}>
          {local.flips.length === 0 ? (
            <p className="text-sm text-mute">
              {d.trace.some((t) => t.gate === "G0" && t.effect === "block")
                ? "Nothing about the evidence can change this: a hard rule decided it. Only changing the facts the rule tests would."
                : "No single change flips this decision. It is robust."}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {local.flips.map((f, i) => {
                const clickable = f.patch.type === "scale" || (f.patch.type === "supply" && !!f.patch.field);
                return (
                  <li key={i}>
                    <button
                      disabled={!clickable}
                      onClick={() => applyFlip(f)}
                      className="group flex items-center gap-2 rounded-md border border-line bg-raised px-3 py-1.5 text-left text-xs transition-colors enabled:hover:border-faint disabled:cursor-default"
                      title={clickable ? "Apply this change" : "Hypothetical evidence edit (not applicable to the live form)"}
                    >
                      <span className="text-mute">{f.change}</span>
                      <span className="text-faint">→</span>
                      <Tag o={f.to} size="sm" />
                      {clickable && <span className="font-mono text-[10px] text-faint group-hover:text-ink">apply</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* evidence + trace */}
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Evidence used" aside={<span className="font-mono text-[10px] text-faint">{d.evidenceUsed.filter((e) => !e.collapsedInto).length} counted · {d.evidenceUsed.filter((e) => e.collapsedInto).length} collapsed</span>}>
            <Evidence d={d} />
          </Panel>
          <Panel title="Reasoning trace" aside={<span className="font-mono text-[10px] text-faint">{pack.policyVersion}</span>}>
            <ol className="space-y-2.5">
              {d.trace.map((t, i) => (
                <li key={i} className="grid grid-cols-[34px_1fr] gap-2.5">
                  <span
                    className="mt-0.5 h-fit rounded px-1 py-0.5 text-center font-mono text-[10px] font-semibold"
                    style={{
                      color: t.effect === "block" ? "var(--color-refuse)" : t.effect === "pass" ? "var(--color-execute)" : "var(--color-mute)",
                      background: t.effect === "block" ? tint("var(--color-refuse)", 13) : t.effect === "pass" ? tint("var(--color-execute)", 13) : "var(--color-raised)",
                    }}
                  >
                    {t.gate}
                  </span>
                  <div>
                    <p className="text-[13px] font-medium leading-tight">{t.title}</p>
                    <p className="text-xs leading-relaxed text-mute">{t.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        {/* actuator */}
        <Panel title="Actuator · the gate, not an advisor" aside={<span className="font-mono text-[10px] text-faint">{fresh ? "tools verify the warrant before touching anything" : "log the decision first"}</span>}>
          {!fresh ? (
            <p className="text-sm text-mute">Press <b className="text-ink">Decide &amp; log</b> to run this case through the server. Only an <span style={{ color: OUTCOME.execute.color }}>EXECUTE</span> mints a warrant, and the actuator will not move without one.</p>
          ) : (
            <div className="space-y-4">
              <WarrantView token={fresh.warrant} outcome={fresh.decision.outcome} />
              <div className="flex flex-wrap gap-2">
                <Btn onClick={() => act("valid")} disabled={!fresh.warrant}>▶ Run with warrant</Btn>
                <Btn tone="danger" onClick={() => act("none")}>Run without a warrant</Btn>
                <Btn tone="danger" onClick={() => act("tampered")} disabled={!fresh.warrant} title="Change the action after the decision, then try to reuse the warrant">Tamper with the action, reuse warrant</Btn>
              </div>
              {log.length > 0 && (
                <ul className="space-y-1.5 font-mono text-xs">
                  {log.map((l, i) => (
                    <li key={i} className="rounded border px-3 py-2" style={{ borderColor: tint(l.ok ? "var(--color-execute)" : "var(--color-refuse)", 40), background: tint(l.ok ? "var(--color-execute)" : "var(--color-refuse)", 8) }}>
                      <div style={{ color: l.ok ? "var(--color-execute)" : "var(--color-refuse)" }}>{l.ok ? "✓ executed" : "✕ blocked"} · {l.title}</div>
                      <div className="mt-0.5 text-mute">{l.detail}</div>
                    </li>
                  ))}
                </ul>
              )}
              {log.some((l) => l.ok) && (
                <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-mute">
                  Close the loop: was that action actually correct?
                  <Btn small disabled={!!labelled} onClick={() => { p.recordOutcome(d.confidence.mid, true); setLabelled("right"); }}>✓ yes</Btn>
                  <Btn small tone="danger" disabled={!!labelled} onClick={() => { p.recordOutcome(d.confidence.mid, false); setLabelled("wrong"); }}>✕ no, it was wrong</Btn>
                  {labelled && <span className="text-faint">recorded: feeds the calibration ledger (Autonomy tab)</span>}
                </div>
              )}
            </div>
          )}
        </Panel>
        {sc?.tags?.includes("failure-test") && (
          <p className="text-xs text-mute">This is the deliberate failure case: see the <b className="text-ink">Failure test</b> tab for v1 vs v2.</p>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── pieces ─────────────────────────── */

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="label !text-[9px]">{k}</div>
      <div className="mt-0.5 text-ink">{v}</div>
    </div>
  );
}

function ConfidenceBar({ d }: { d: Decision }) {
  const { lo, mid, hi, effective } = d.confidence;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="label">confidence P(correct)</span>
        <span className="font-mono text-xs text-mute">
          {pct(mid)} <span className="text-faint">[{pct(lo)}–{pct(hi)}]</span>
        </span>
      </div>
      <div className="relative h-3 w-full rounded-full bg-raised">
        <div className="absolute top-0 h-full rounded-full" style={{ left: `${lo * 100}%`, width: `${Math.max(1, (hi - lo) * 100)}%`, background: tint("var(--color-ask)", 35) }} />
        <div className="absolute top-[-3px] h-[18px] w-[2px] bg-white" style={{ left: `${mid * 100}%` }} title="point estimate" />
        <div className="absolute top-[3px] h-[6px] w-[6px] -translate-x-1/2 rounded-full bg-defer" style={{ left: `${effective * 100}%` }} title="decision-grade (reversibility-weighted pessimistic)" />
      </div>
      <p className="mt-1.5 flex flex-wrap gap-x-3 font-mono text-[10px] text-faint">
        <span><i className="mr-1 inline-block h-2 w-0.5 bg-white align-middle" />estimate</span>
        <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-defer align-middle" />decision-grade {pct(effective)}</span>
        <span><i className="mr-1 inline-block h-2 w-3 rounded-sm bg-ask/40 align-middle" />uncertainty</span>
      </p>
    </div>
  );
}

function LossBars({ d, pack }: { d: Decision; pack: Pack<any> }) {
  const finite = OUTCOMES.map((o) => d.lossTable[o]).filter((v): v is number => v !== null);
  const max = Math.max(...finite, 1);
  const scale = (v: number) => Math.log1p(v) / Math.log1p(max);
  return (
    <div className="space-y-2.5">
      {OUTCOMES.map((o) => {
        const v = d.lossTable[o];
        const chosen = o === d.outcome;
        return (
          <div key={o}>
            <div className="mb-1 flex items-baseline justify-between font-mono text-[11px]">
              <span style={{ color: chosen ? OUTCOME[o].color : "var(--color-mute)" }}>
                {chosen ? "● " : "  "}
                {o}
              </span>
              <span className="text-mute">{v === null ? "not available" : money(pack, v)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-raised">
              {v !== null && <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(1.5, scale(v) * 100)}%`, background: OUTCOME[o].color, opacity: chosen ? 1 : 0.4 }} />}
            </div>
          </div>
        );
      })}
      <p className="pt-1 text-[11px] leading-snug text-faint">
        Log scale. <b className="text-mute">execute</b> is removed when stakes exceed authority or P(correct) is under 60%. <b className="text-mute">ask</b>/<b className="text-mute">defer</b> only exist when something is missing that a question or time can supply.
        {d.outcome !== argmin(d) && " The marked option differs from the cheapest because a hard rule, the close-call floor, or shadow mode overrode it."}
      </p>
    </div>
  );
}
const argmin = (d: Decision): Outcome => OUTCOMES.filter((o) => d.lossTable[o] !== null).sort((a, b) => d.lossTable[a]! - d.lossTable[b]!)[0];

function Evidence({ d }: { d: Decision }) {
  const rows = [...d.evidenceUsed].filter((e) => Math.abs(e.llr) > 0).sort((a, b) => Math.abs(b.effective) - Math.abs(a.effective));
  if (!rows.length) return <p className="text-sm text-mute">No evidence yet.</p>;
  const max = Math.max(...rows.map((r) => Math.abs(r.llr)), 1);
  return (
    <ul className="space-y-2">
      {rows.map((e) => (
        <li key={e.id} className={e.collapsedInto ? "opacity-45" : ""}>
          <div className="flex items-baseline justify-between gap-2">
            <span className={`text-[13px] leading-tight ${e.collapsedInto ? "line-through" : ""}`}>{e.label}</span>
            <span className="shrink-0 font-mono text-[10px] text-faint">{e.origin}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="relative h-1.5 flex-1 rounded-full bg-raised">
              <div className="absolute left-1/2 top-[-2px] h-[10px] w-px bg-line" />
              <div
                className="absolute h-full rounded-full"
                style={{
                  background: e.effective > 0 ? "var(--color-execute)" : "var(--color-refuse)",
                  left: e.effective > 0 ? "50%" : `${50 - (Math.abs(e.effective) / max) * 50}%`,
                  width: `${(Math.abs(e.effective) / max) * 50}%`,
                }}
              />
            </div>
            <span className="w-14 text-right font-mono text-[10px] text-mute">{e.effective > 0 ? "+" : ""}{e.effective.toFixed(2)}</span>
          </div>
          {e.collapsedInto ? (
            <p className="mt-0.5 font-mono text-[10px] text-defer">collapsed: same provenance as “{e.group}”, counted once</p>
          ) : (
            e.detail && <p className="mt-0.5 text-[11px] leading-snug text-faint">{e.detail}</p>
          )}
        </li>
      ))}
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

function WarrantView({ token, outcome }: { token: string | null; outcome: Outcome }) {
  if (!token) {
    return (
      <div className="rounded-md border border-dashed border-line px-4 py-3 text-sm text-mute">
        <b style={{ color: OUTCOME[outcome].color }}>No warrant minted.</b> A decision of {outcome.toUpperCase()} never produces one. Any attempt to act will be refused by the actuator.
      </div>
    );
  }
  const c = decodeClaims(token);
  return (
    <div className="rounded-md border px-4 py-3" style={{ borderColor: tint("var(--color-execute)", 40), background: tint("var(--color-execute)", 7) }}>
      <div className="flex items-center justify-between">
        <span className="label !text-execute">warrant · HMAC-SHA256 · single use · 5 min</span>
        <span className="font-mono text-[10px] text-faint">{c?.policyVersion}</span>
      </div>
      <p className="mt-2 break-all font-mono text-[11px] leading-snug text-mute">{token.slice(0, 74)}…</p>
      {c && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] sm:grid-cols-4">
          <div><dt className="label !text-[9px]">decision</dt><dd>{c.decisionId}</dd></div>
          <div><dt className="label !text-[9px]">action hash</dt><dd>{String(c.actionHash).slice(0, 12)}…</dd></div>
          <div><dt className="label !text-[9px]">confidence</dt><dd>{pct(c.confidence)}</dd></div>
          <div><dt className="label !text-[9px]">expires</dt><dd>{new Date(c.exp).toLocaleTimeString()}</dd></div>
        </dl>
      )}
    </div>
  );
}

function Field({ f, value, onChange }: { f: FieldSpec; value: any; onChange: (v: any) => void }) {
  const base = "w-full rounded border border-line bg-raised px-2 py-1.5 font-mono text-xs text-ink";
  const wide = f.type === "text";
  return (
    <label className={`block ${wide ? "col-span-2" : ""}`}>
      <span className="label !text-[9.5px] block pb-1 leading-tight">{f.label}</span>
      {f.type === "number" && (
        <input type="number" className={base} value={value ?? 0} min={f.min} max={f.max} step={f.step ?? 1} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />
      )}
      {f.type === "select" && (
        <select className={base} value={value} onChange={(e) => onChange(e.target.value)}>
          {f.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      )}
      {f.type === "boolean" && (
        <button type="button" onClick={() => onChange(!value)} className={`${base} text-left`} style={{ color: value ? "var(--color-execute)" : "var(--color-mute)" }}>
          {value ? "yes" : "no"}
        </button>
      )}
      {f.type === "text" && <textarea className={`${base} min-h-[64px] leading-snug`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}
