"use client";
import { useMemo, useState } from "react";
import { decide } from "@/core/decide";
import type { Outcome, Pack } from "@/core/types";
import type { AuditRecord, ChainVerdict } from "@/ledger/audit";
import { getPack } from "@/domains";
import { rng } from "@/domains/util";
import { Btn, OUTCOME, OUTCOMES, Panel, Tag, tint } from "./shared";

type Replay = { ok: boolean; note: string };

export function AuditTab({
  records,
  clear,
  tamper,
  tamperedSeq,
  restore,
  pack,
}: {
  records: AuditRecord[];
  clear: () => void;
  tamper: (seq: number) => void;
  tamperedSeq: number | null;
  restore: () => void;
  pack: Pack<any>;
}) {
  const [verdict, setVerdict] = useState<ChainVerdict | null>(null);
  const [replays, setReplays] = useState<Record<string, Replay>>({});
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    try {
      const r = await fetch("/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ records }) });
      setVerdict(await r.json());
    } finally {
      setBusy(false);
    }
  }

  function replayAll() {
    const out: Record<string, Replay> = {};
    for (const r of records) {
      if (r.kind !== "decision") continue;
      const b = r.body as any;
      const p = getPack(r.packId, b.variant ?? undefined);
      if (!p) continue;
      const again = decide(p, b.input, { state: { autonomy: b.autonomy }, extraSignals: b.sensorSignals ?? [] });
      const same = JSON.stringify(again) === JSON.stringify(b.decision);
      out[r.id] = { ok: same, note: same ? "re-ran from stored inputs → byte-identical decision" : `differs: stored ${b.decision?.outcome}, replay ${again.outcome}` };
    }
    setReplays(out);
  }

  const decisions = records.filter((r) => r.kind === "decision").length;

  return (
    <div className="space-y-5">
      <Panel
        title="Audit ledger · hash-chained, server-sealed, replayable"
        aside={<span className="font-mono text-[10px] text-faint">{records.length} records · {decisions} decisions</span>}
      >
        <p className="mb-4 max-w-3xl text-sm leading-relaxed text-mute">
          Every decision, every actuator attempt (including the refused ones), and every outcome is appended here. Each record contains the hash of the one before it, and the server seals each hash with
          an HMAC. Edit, delete or reorder anything and the chain breaks at that record. Even re-hashing the whole chain can’t forge the seals.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Btn tone="primary" onClick={verify} disabled={!records.length || busy}>{busy ? "Verifying…" : "Verify chain"}</Btn>
          <Btn onClick={replayAll} disabled={!decisions}>↻ Replay every decision</Btn>
          <Btn tone="danger" onClick={() => tamper(Math.max(1, records.findIndex((r) => r.kind === "decision") + 1))} disabled={!decisions || tamperedSeq !== null} title="Silently rewrite the first decision record to say EXECUTE">
            Tamper with a record
          </Btn>
          {tamperedSeq !== null && <Btn onClick={restore}>Restore original</Btn>}
          <Btn tone="ghost" onClick={clear} disabled={!records.length}>Clear</Btn>
        </div>
        {verdict && (
          <div
            className="rise mt-5 border-[1.5px] border-ink px-4 py-3 text-[14.5px] shadow-[4px_4px_0_var(--color-ink)]"
            style={{
              background: verdict.ok ? "var(--color-blue)" : "var(--color-pink)",
              color: verdict.ok ? "var(--color-panel)" : "var(--color-ink)",
            }}
            role="status"
          >
            {verdict.ok ? (
              <><b className="display mr-2 text-[24px]">Chain intact.</b>{verdict.length} records, every hash links to its predecessor and every seal was issued by this server.</>
            ) : (
              <><b className="display mr-2 text-[24px]">Chain broken at #{verdict.brokenAt}.</b> {verdict.reason}.</>
            )}
          </div>
        )}
      </Panel>

      {records.length === 0 ? (
        <Panel>
          <div className="flex flex-wrap items-center gap-6 py-4"><span className="display text-[72px] text-line">0</span><p className="max-w-[48ch] text-[15px] text-mute">Nothing logged yet. Go to <b className="text-ink">Decide</b>, pick a case, and press <mark className="font-semibold text-ink">Decide and log</mark>. Every record lands here, sealed.</p></div>
        </Panel>
      ) : (
        <ol className="stagger space-y-3">
          {[...records].reverse().map((r) => {
            const b = r.body as any;
            const outcome: Outcome | null = r.kind === "decision" ? b.decision?.outcome : null;
            const broken = verdict && !verdict.ok && verdict.brokenAt === r.seq;
            const after = verdict && !verdict.ok && r.seq > verdict.brokenAt;
            const rp = replays[r.id];
            return (
              <li
                key={r.id}
                className="border-[1.5px] border-ink transition-[transform,box-shadow] duration-200 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_var(--color-ink)]"
                style={{ background: broken ? "var(--color-pink)" : "var(--color-panel)", boxShadow: broken ? "5px 5px 0 var(--color-ink)" : undefined, opacity: after ? 0.5 : 1 }}
              >
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3">
                    <span className="display text-[26px] leading-none">#{r.seq}</span>
                    <span className="bg-ink px-1.5 py-0.5 font-mono text-[10px] uppercase text-sun">{r.kind}</span>
                    <span className="font-mono text-xs text-mute">{r.packId}</span>
                    {outcome && <Tag o={outcome} size="sm" />}
                    {r.kind === "execution" && (
                      <span className="font-mono text-[11px]" style={{ color: b.ok ? "var(--color-execute)" : "var(--color-refuse)" }}>
                        {b.ok ? "✓ ran with valid warrant" : `✕ blocked: ${b.rejected}`}
                      </span>
                    )}
                    {tamperedSeq === r.seq && <span className="rough bg-refuse px-1.5 py-0.5 font-mono text-[10px] font-bold text-panel">EDITED BY ATTACKER</span>}
                    {rp && <span className="font-mono text-[10px]" style={{ color: rp.ok ? "var(--color-execute)" : "var(--color-refuse)" }}>{rp.ok ? "✓ replays identically" : "✕ " + rp.note}</span>}
                    <span className="ml-auto font-mono text-[10px] text-faint">{r.hash.slice(0, 10)}…</span>
                  </summary>
                  <div className="space-y-3 border-t-[1.5px] border-dashed border-ink px-4 py-3">
                    <p className="text-sm">{r.kind === "decision" ? b.decision?.action : r.kind === "execution" ? b.action : ""}</p>
                    {r.kind === "decision" && <p className="text-xs leading-relaxed text-mute">{b.decision?.reason}</p>}
                    <dl className="grid gap-x-6 gap-y-1 font-mono text-[11px] sm:grid-cols-[110px_1fr]">
                      <dt className="text-faint">prev hash</dt><dd className="break-all text-mute">{r.prevHash}</dd>
                      <dt className="text-faint">hash</dt><dd className="break-all text-ink">{r.hash}</dd>
                      <dt className="text-faint">server seal</dt><dd className="break-all text-mute">{r.seal}</dd>
                      <dt className="text-faint">time</dt><dd className="text-mute">{r.ts}</dd>
                    </dl>
                    <details>
                      <summary className="cursor-pointer font-mono text-[11px] text-faint">full replayable body (inputs · signals · trace)</summary>
                      <pre className="scroll-thin mt-2 max-h-72 overflow-auto bg-ink p-3 font-mono text-[10.5px] leading-snug text-sun">{JSON.stringify(r.body, null, 2)}</pre>
                    </details>
                    {r.kind === "decision" && <Btn small tone="danger" disabled={tamperedSeq !== null} onClick={() => tamper(r.seq)}>Tamper with this record</Btn>}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      )}

      <TimeMachine pack={pack} />
    </div>
  );
}

/* ───────────── policy time machine: replay history under a different policy ───────────── */

function TimeMachine({ pack }: { pack: Pack<any> }) {
  const [auth, setAuth] = useState(1);
  const [human, setHuman] = useState(1);
  const N = 300;
  const result = useMemo(() => {
    const r = rng(777);
    const cases = Array.from({ length: N }, () => pack.generate(r));
    const next: Pack<any> = { ...pack, authority: pack.authority * auth, loss: { ...pack.loss, cHuman: pack.loss.cHuman * human }, policyVersion: pack.policyVersion + "+whatif" };
    const matrix: Record<string, number> = {};
    const examples: { from: Outcome; to: Outcome; action: string }[] = [];
    let changed = 0;
    for (const c of cases) {
      const a = decide(pack, c, { skipFlips: true });
      const b = decide(next, c, { skipFlips: true });
      matrix[`${a.outcome}>${b.outcome}`] = (matrix[`${a.outcome}>${b.outcome}`] ?? 0) + 1;
      if (a.outcome !== b.outcome) {
        changed++;
        if (examples.length < 5) examples.push({ from: a.outcome, to: b.outcome, action: a.action });
      }
    }
    return { matrix, changed, examples };
  }, [pack, auth, human]);

  return (
    <Panel title="Policy time machine" aside={<span className="font-mono text-[10px] text-faint">replay {N} historical {pack.name.toLowerCase()} cases under a new policy</span>}>
      <p className="mb-4 max-w-3xl text-sm text-mute">
        Because the core is pure and every decision is stored with its inputs, you can ask “what would we have done last quarter under a different policy?” before shipping the change.
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <Slider label="Autonomous authority" value={auth} set={setAuth} fmtv={(v) => `×${v.toFixed(2)}  (${Math.round(pack.authority * v).toLocaleString()} ${pack.unit})`} />
          <Slider label="Cost of a human review" value={human} set={setHuman} fmtv={(v) => `×${v.toFixed(2)}  (${Math.round(pack.loss.cHuman * v)} ${pack.unit})`} />
          <p className="font-mono text-sm">
            <b className="display mr-2 text-[64px] align-middle" style={{ color: result.changed ? "var(--color-refuse)" : "var(--color-execute)" }}>{result.changed}</b> of {N} past decisions would change
          </p>
          <ul className="space-y-1.5">
            {result.examples.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-xs text-mute">
                <Tag o={e.from} size="sm" /> → <Tag o={e.to} size="sm" /> <span className="truncate">{e.action}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-1 font-mono text-[11px]">
            <thead>
              <tr>
                <th className="label text-left !text-[9px]">was ↓ / now →</th>
                {OUTCOMES.map((o) => (
                  <th key={o} style={{ color: OUTCOME[o].color }} className="pb-1 text-center font-normal">{o.slice(0, 4)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {OUTCOMES.map((a) => (
                <tr key={a}>
                  <td style={{ color: OUTCOME[a].color }}>{a}</td>
                  {OUTCOMES.map((b) => {
                    const n = result.matrix[`${a}>${b}`] ?? 0;
                    const diag = a === b;
                    return (
                      <td key={b} className="rounded text-center" style={{ background: n ? tint(diag ? "var(--color-faint)" : OUTCOME[b].color, diag ? 18 : Math.min(60, 18 + n * 4)) : "transparent", color: n ? "var(--color-ink)" : "var(--color-faint)", padding: "6px 0" }}>
                        {n || "·"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

function Slider({ label, value, set, fmtv }: { label: string; value: number; set: (n: number) => void; fmtv: (n: number) => string }) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between"><span className="label">{label}</span><span className="font-mono text-xs text-mute">{fmtv(value)}</span></span>
      <input type="range" min={0.25} max={4} step={0.05} value={value} onChange={(e) => set(Number(e.target.value))} className="w-full accent-ink" />
    </label>
  );
}
