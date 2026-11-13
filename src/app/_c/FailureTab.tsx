"use client";
import { useMemo, useState } from "react";
import { decide } from "@/core/decide";
import type { Decision, Outcome } from "@/core/types";
import { makeRefundPack, type RefundInput } from "@/domains/refund";
import { Btn, OUTCOME, Panel, Tag, pct, tint } from "./shared";

const guarded = makeRefundPack("guarded");
const naive = makeRefundPack("naive");
const echo = guarded.scenarios.find((s) => s.id === "echo-chamber")!.input;
const clean = guarded.scenarios.find((s) => s.id === "easy-win")!.input;

const compromised: RefundInput = {
  ...clean,
  amount: 250,
  orderTotal: 280,
  reason: "damaged",
  orderProof: "yes",
  customerTenureDays: 800,
  ticketText: "My item arrived broken, please refund.",
};

export function FailureTab({ openInConsole }: { openInConsole: (variant: "guarded" | "naive") => void }) {
  const v1 = useMemo(() => decide(naive, echo, { skipFlips: true }), []);
  const v2a = useMemo(() => decide({ ...guarded, invariants: [] }, echo, { skipFlips: true }), []);
  const v2b = useMemo(() => decide(guarded, echo, { skipFlips: true }), []);
  const limit = useMemo(() => decide(guarded, compromised, { skipFlips: true }), []);
  const limitBig = useMemo(() => decide(guarded, { ...compromised, amount: 2500, orderTotal: 2800 }, { skipFlips: true }), []);

  return (
    <div className="space-y-5">
      <Panel>
        <p className="label">deliberate failure test</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">The Echo Chamber</h2>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-mute">
          The scariest failure for a confidence-based system isn’t low confidence. It’s <b className="text-ink">high confidence built from one poisoned source</b>. An attacker files a refund, injects instructions into the ticket, and
          attaches four “independent” documents that all come from the same place. A naive evidence-summing engine sees five agreeing signals and approves with 99% confidence.
        </p>
        <blockquote className="mt-4 max-w-3xl rounded-md border border-line bg-bg/50 p-4 font-mono text-xs leading-relaxed text-mute">
          <span className="label block pb-1">the ticket (untrusted data)</span>
          {echo.ticketText}
          <span className="mt-2 block text-faint">+ {echo.supportingDocs} attached documents · $ {echo.amount} · customer {echo.customerTenureDays} days old · card refund</span>
        </blockquote>
        <div className="mt-4 flex gap-2">
          <Btn small onClick={() => openInConsole("naive")}>Open in console as v1 (guard OFF)</Btn>
          <Btn small onClick={() => openInConsole("guarded")}>Open as v2 (guard ON)</Btn>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Stage n="v1" title="Naive evidence sum" d={v1} bad note="Four attachments, each counted as independent corroboration, plus a ticket that claims it was “verified”. This is the bug." />
        <Stage n="v2a" title="+ Provenance collapse + integrity signal" d={v2a} note="Requester-supplied documents share ONE source, so they count once. Instruction-like text becomes negative evidence. Confidence collapses, but no hard rule yet." />
        <Stage n="v2b" title="+ Hard rule: instructions in content" d={v2b} good note="Defence in depth: text that addresses the decision layer is a G0 invariant, so even a miscalibrated belief can’t approve it. Routed to a human." />
      </div>

      <Panel title="What still breaks" aside={<span className="font-mono text-[10px] text-refuse">honest limits</span>}>
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h4 className="text-sm font-semibold">1. Genuinely independent forged evidence wins.</h4>
            <p className="mt-1 text-sm leading-relaxed text-mute">
              If the attacker compromises the order system <i>and</i> the CRM, every signal is real, independent, and wrong. Confidence cannot beat real forgery.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-mute">
              Compromised sources, $250 → <Tag o={limit.outcome} size="sm" /> <span className="text-faint">({pct(limit.confidence.mid)} confident, wrongly)</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-mute">
              Same attacker, $2,500 → <Tag o={limitBig.outcome} size="sm" /> <span className="text-faint">authority caps the blast radius</span>
            </div>
            <p className="mt-2 text-xs text-faint">The defence isn’t smarter belief. It’s bounded authority, an audit trail, and calibration that notices when “97% sure” keeps being wrong.</p>
          </div>
          <Salami />
        </div>
        <ul className="mt-6 space-y-1.5 border-t border-line pt-4 text-sm text-mute">
          <li><b className="text-ink">This breaks when…</b> a slow drip stays under the 30-day window forever (one refund a month never trips velocity).</li>
          <li><b className="text-ink">…</b> the signal weights are wrong in a way that the history can’t reveal (calibration only sees outcomes someone bothered to label).</li>
          <li><b className="text-ink">…</b> the pre-mortem LLM is silent: doubt-only means a broken sensor fails <i>toward the rules</i>, not toward safety it never had.</li>
          <li><b className="text-ink">…</b> the loss numbers are guesses. The engine is only as sane as the costs you encode; the Policy time machine exists to stress those before shipping.</li>
        </ul>
      </Panel>
    </div>
  );
}

function Stage({ n, title, d, note, bad, good }: { n: string; title: string; d: Decision; note: string; bad?: boolean; good?: boolean }) {
  const m = OUTCOME[d.outcome];
  const counted = d.evidenceUsed.filter((e) => !e.collapsedInto && Math.abs(e.llr) > 0);
  const collapsed = d.evidenceUsed.filter((e) => e.collapsedInto);
  return (
    <section className="rounded-lg border bg-panel p-4" style={{ borderColor: bad ? tint("var(--color-refuse)", 55) : good ? tint("var(--color-execute)", 45) : "var(--color-line)" }}>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-xs text-faint">{n}</span>
        {bad && <span className="font-mono text-[10px] text-refuse">▲ FAILURE</span>}
        {good && <span className="font-mono text-[10px] text-execute">✓ HOLDS</span>}
      </div>
      <h3 className="mt-1 text-sm font-semibold leading-tight">{title}</h3>
      <div className="mt-3 text-[40px] font-semibold leading-none tracking-[-0.03em]" style={{ color: m.color }}>{m.label.charAt(0) + m.label.slice(1).toLowerCase()}</div>
      <p className="mt-1 font-mono text-xs text-mute">{pct(d.confidence.mid)} confident · {counted.length} signals counted · {collapsed.length} collapsed</p>
      <p className="mt-3 text-xs leading-relaxed text-mute">{note}</p>
      <ul className="mt-3 space-y-0.5 font-mono text-[10.5px]">
        {d.evidenceUsed.filter((e) => Math.abs(e.llr) > 0).map((e) => (
          <li key={e.id} className={`flex justify-between gap-2 ${e.collapsedInto ? "text-faint line-through" : e.effective > 0 ? "text-execute/90" : "text-refuse/90"}`}>
            <span className="truncate">{e.label}</span>
            <span>{e.effective > 0 ? "+" : ""}{e.effective.toFixed(1)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Salami() {
  const [run, setRun] = useState<{ o: Outcome; total: number }[] | null>(null);
  const go = () => {
    const out: { o: Outcome; total: number }[] = [];
    let total = 0;
    for (let k = 1; k <= 20; k++) {
      const input: RefundInput = { ...clean, amount: 49, orderTotal: 60, reason: "changed_mind", customerTenureDays: 120, refundCount30d: k - 1, refundedTotal30d: total, priorRefunds90d: 0 };
      const d = decide(guarded, input, { skipFlips: true });
      out.push({ o: d.outcome, total });
      if (d.outcome === "execute") total += 49;
    }
    setRun(out);
  };
  const stop = run?.findIndex((r) => r.o !== "execute") ?? -1;
  return (
    <div>
      <h4 className="text-sm font-semibold">2. Salami slicing: 20 refunds of $49.</h4>
      <p className="mt-1 text-sm leading-relaxed text-mute">Every refund is under the limit. Exposure is cumulative, so the rolling 30-day total is what gets compared to authority.</p>
      <div className="mt-3"><Btn small onClick={go}>▶ Replay 20 refunds</Btn></div>
      {run && (
        <>
          <div className="mt-3 flex flex-wrap gap-1">
            {run.map((r, i) => (
              <span key={i} className="grid h-7 w-7 place-items-center rounded font-mono text-[10px]" style={{ background: tint(OUTCOME[r.o].color, 22), color: OUTCOME[r.o].color, border: `1px solid ${tint(OUTCOME[r.o].color, 45)}` }} title={`#${i + 1}: ${r.o} (30-day total $${r.total})`}>
                {i + 1}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-mute">
            {stop >= 0 ? <>Stopped at refund <b className="text-ink">#{stop + 1}</b> with $ {run[stop].total} already out the door: attacker kept <b className="text-ink">${run[stop].total}</b> instead of $980.</> : "Never stopped"}
          </p>
        </>
      )}
    </div>
  );
}
