"use client";
import { OUTCOME, OUTCOMES, Panel, tint } from "./shared";

const THESIS = [
  { h: "Autonomy will be a credit score, and the warrant will be its unit of account.", p: "Today “agent safety” means a system prompt and a confidence number nobody calibrated. That ends within two years, for a boring reason: insurance. Once agents move money, ship code and moderate people, someone has to underwrite the losses, and underwriters don’t price vibes. They price calibration histories." },
  { h: "1 · Confidence scores die; priced regret survives.", p: "Raw model confidence is uncalibrated and gameable. Decision layers will standardise on expected-loss tables with explicit reversibility and blast radius: the same inputs an actuary already understands." },
  { h: "2 · Actions become signed objects.", p: "The unit of agent work stops being “a tool call” and becomes a tool call plus a warrant: who authorised it, under which policy version, on what evidence. Tools will refuse unsigned calls the way browsers refuse unsigned TLS. That makes agent liability auditable and transferable." },
  { h: "3 · Autonomy is earned, per domain, and revocable.", p: "An agent gets L3 on refunds under $300 and L0 on payroll, and it drops itself a level when its Brier score slips. Platforms will publish autonomy ledgers the way they publish uptime." },
  { h: "The losers treat “ask a human” as a failure mode.", p: "The winners understand that defer and escalate are features: the cheapest action in a high-stakes world is the one you correctly didn’t take. Whoever owns the decision layer owns the trust layer, and the trust layer is where the liability, and therefore the money, will sit." },
];

export function AboutTab() {
  return (
    <div className="space-y-5">
      <Panel>
        <p className="label">the question</p>
        <h2 className="mt-1 max-w-3xl text-2xl font-semibold leading-tight tracking-tight">Not “can the agent call the tool?” but “is it <i>allowed</i> to, right now, on this evidence, at this price of being wrong?”</h2>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-mute">
          WARRANT is the layer between a proposed action and the world. It prices every option in expected regret, picks the cheapest, and only an <span style={{ color: OUTCOME.execute.color }}>execute</span> produces a cryptographic warrant that tools will accept.
        </p>
      </Panel>

      <Panel title="Architecture · inputs → signals → decision → audit">
        <Architecture />
      </Panel>

      <Panel title="Five outcomes, five different triggers">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="label">
                <th className="pb-2 pr-4 font-normal">outcome</th>
                <th className="pb-2 pr-4 font-normal">formal trigger</th>
                <th className="pb-2 font-normal">in plain words</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {(
                [
                  ["execute", "E[loss(execute)] is minimal, within authority, P(correct) ≥ 60%, and clearly cheaper than a human", "Evidence is strong enough for what this costs if wrong."],
                  ["ask", "EVOI(answer) > cost of asking, and the missing info is askable", "One cheap question would change the answer."],
                  ["defer", "Missing info resolves with time, and delay < regret of acting now", "Waiting beats acting blind or interrupting someone."],
                  ["escalate", "Over authority, conflicting signals, close call, or a rule demands a human", "A human with authority decides."],
                  ["refuse", "A hard invariant is violated, or acting is catastrophic and no info helps", "Not allowed. More evidence won’t change that."],
                ] as const
              ).map(([o, t, w]) => (
                <tr key={o} className="border-t border-line">
                  <td className="py-2.5 pr-4 font-mono text-xs font-semibold" style={{ color: OUTCOME[o].color }}>{OUTCOME[o].glyph} {o}</td>
                  <td className="py-2.5 pr-4 text-mute">{t}</td>
                  <td className="py-2.5 text-mute">{w}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Design principles">
          <ul className="space-y-3 text-sm leading-relaxed text-mute">
            <li><b className="text-ink">The model never decides.</b> LLMs are sensors that emit typed signals. The decision core is pure, deterministic TypeScript: same input, same bytes. That is what makes replay and audit mean something.</li>
            <li><b className="text-ink">LLMs may add doubt, never remove it.</b> The pre-mortem’s output is clamped to ≤ 0 inside the core. A jailbroken model can only make the system more cautious. Property-tested.</li>
            <li><b className="text-ink">A gate, not an advisor.</b> The actuator verifies an HMAC warrant bound to the exact action, policy version and expiry. Change one byte → void.</li>
            <li><b className="text-ink">Correlated evidence counts once.</b> Signals sharing a provenance group collapse to a single vote.</li>
            <li><b className="text-ink">Reversibility sets the bar.</b> Cheaply-undone actions are judged on the estimate; permanent ones on the pessimistic bound.</li>
            <li><b className="text-ink">Autonomy is earned.</b> Miscalibration shrinks authority automatically.</li>
          </ul>
        </Panel>
        <Panel title="Out of scope (on purpose)">
          <ul className="space-y-2 text-sm leading-relaxed text-mute">
            <li>• Real payments, deploys or takedowns. Actuators are simulated; the warrant mechanism is real.</li>
            <li>• Learned loss models. Costs are explicit, human-readable parameters per domain (that is the point).</li>
            <li>• Multi-tenant auth, key rotation, and a durable database. The audit chain is client-held and server-sealed; swap in Postgres behind the same record format.</li>
            <li>• Synthetic history. The outcomes behind the calibration charts are generated by a hidden ground-truth model; the engine under test is the real one.</li>
            <li>• Defending against a compromised signer or fully-forged independent sources: see the Failure test.</li>
          </ul>
          <p className="label mt-5">AI usage</p>
          <p className="mt-1 text-sm leading-relaxed text-mute">Built with Claude Code. At runtime an LLM (via Vercel AI Gateway) is optional: a structured-output pre-mortem and a free-text extractor, both subordinate to the deterministic core. The app runs with no API key.</p>
        </Panel>
      </div>

      <Panel title="Two-year thesis">
        <div className="max-w-3xl space-y-4">
          {THESIS.map((t, i) => (
            <div key={i} className={i === 0 ? "border-l-2 pl-4" : ""} style={i === 0 ? { borderColor: OUTCOME.execute.color } : undefined}>
              <h4 className={i === 0 ? "text-xl font-semibold leading-snug" : "text-sm font-semibold"}>{t.h}</h4>
              <p className="mt-1 text-sm leading-relaxed text-mute">{t.p}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Architecture() {
  const box = (x: number, y: number, w: number, h: number, title: string, lines: string[], color = "var(--color-line)") => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="8" fill="var(--color-raised)" stroke={color} strokeWidth="1.2" />
      <text x={x + 12} y={y + 20} fontSize="12" fontWeight="600" fill="var(--color-ink)" fontFamily="var(--font-sans)">{title}</text>
      {lines.map((l, i) => (
        <text key={i} x={x + 12} y={y + 38 + i * 14} fontSize="10" fill="var(--color-mute)" fontFamily="var(--font-mono)">{l}</text>
      ))}
    </g>
  );
  const arrow = (x1: number, y1: number, x2: number, y2: number) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-faint)" strokeWidth="1.2" markerEnd="url(#arr)" />;
  return (
    <div className="overflow-x-auto">
      <svg viewBox="0 0 980 360" className="min-w-[860px]" role="img" aria-label="Architecture: proposal flows through sensors into the pure decision core, then to the actuator and audit ledger">
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="var(--color-faint)" />
          </marker>
        </defs>
        {box(10, 120, 140, 84, "Proposal", ["action + context", "from any agent", "POST /api/decide"])}
        {arrow(150, 162, 190, 162)}
        {box(190, 20, 220, 150, "SENSORS (signals)", ["rule extractors      deterministic", "history lookups      system", "LLM extractor        cap 0.55", "LLM pre-mortem       DOUBT-ONLY", "provenance groups    collapse"], "var(--color-ask)")}
        {box(190, 190, 220, 80, "Missing-info map", ["what we expected but lack", "askable? / arrives with time?"])}
        {arrow(410, 100, 450, 140)}
        {arrow(410, 230, 450, 190)}
        <rect x="450" y="20" width="270" height="250" rx="10" fill="none" stroke="var(--color-execute)" strokeWidth="1.5" strokeDasharray="5 4" />
        <text x="462" y="40" fontSize="10" fill="var(--color-execute)" fontFamily="var(--font-mono)">DECISION CORE · pure · no I/O · no LLM</text>
        {["G0 invariants → refuse | escalate", "G1 authority + confidence floor", "G2 belief: log-odds, intervals", "G3 expected-loss table ×5 options", "G4 value of information", "G5 argmin · margin · flip distances"].map((t, i) => (
          <g key={t}>
            <rect x="466" y={54 + i * 34} width="238" height="28" rx="5" fill="var(--color-raised)" stroke="var(--color-line)" />
            <text x="476" y={72 + i * 34} fontSize="10.5" fill="var(--color-ink)" fontFamily="var(--font-mono)">{t}</text>
          </g>
        ))}
        {arrow(720, 100, 770, 70)}
        {arrow(720, 190, 770, 230)}
        {box(770, 20, 200, 100, "Decision payload", ["outcome · confidence {lo,mid,hi}", "risk · reversibility · evidence", "missing info · flips · trace"])}
        {box(770, 150, 200, 70, "WARRANT (execute only)", ["HMAC · action hash", "policy ver · expiry · single-use"], "var(--color-execute)")}
        {box(770, 250, 200, 90, "Actuator", ["verifies warrant, then acts", "no warrant → 403", "tampered action → 403"], "var(--color-refuse)")}
        {arrow(870, 220, 870, 250)}
        {box(450, 290, 270, 56, "Audit ledger", ["hash-chained · server-sealed · replayable"], "var(--color-defer)")}
        {arrow(585, 270, 585, 290)}
        {box(190, 290, 220, 56, "Calibration ledger", ["Brier · ECE → autonomy L0..L3"], "var(--color-escalate)")}
        <line x1="450" y1="318" x2="410" y2="318" stroke="var(--color-faint)" markerEnd="url(#arr)" />
        <path d="M300 290 C300 280, 380 276, 450 250" fill="none" stroke="var(--color-faint)" strokeDasharray="3 3" markerEnd="url(#arr)" />
        <text x="12" y="320" fontSize="10" fill="var(--color-faint)" fontFamily="var(--font-mono)">outcomes feed calibration → autonomy shrinks authority in G1</text>
      </svg>
    </div>
  );
}
