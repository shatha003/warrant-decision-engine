# WARRANT

**A decision layer that decides whether an AI is *allowed* to act, and proves it.**
Built for the DOO Builders League challenge *The Decision Engine*.

Given a proposed action and its context, WARRANT returns one of **execute · ask · defer · escalate · refuse** with
confidence (interval), risk, reversibility, the evidence used, what's missing, the minimal changes that would flip the
outcome, and a tamper-evident audit record. Only `execute` produces a cryptographic **warrant**; the actuator refuses to move without one.

- Live demo: https://warrant-nfqjiwkwn-shatha11s-projects.vercel.app
- Video (90s): _add your Loom URL here_
- Failure test: [`docs/FAILURE_TEST.md`](docs/FAILURE_TEST.md) · Thesis: [`docs/THESIS.md`](docs/THESIS.md)

## Run it (zero config)

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 82 tests
npm run build && npm start
```

No API key needed. Optional: copy `.env.example` → `.env.local` and set `AI_GATEWAY_API_KEY` + `WARRANT_MODE=llm`
to enable LLM sensors. Set `WARRANT_SECRET` in any real deployment (a fixed demo secret is used otherwise).

## The idea in one paragraph

The decision is **not made by a model**. LLMs are *sensors* that emit typed signals. A pure, deterministic TypeScript
core turns signals into a belief (log-odds, with an uncertainty interval, correlated sources collapsed), prices the
expected loss of all five outcomes from explicit per-domain cost tables, adds a value-of-information test (is one question
worth more than it costs?), and picks the cheapest, unless a hard invariant forbids it. Same input → same bytes, which
is what makes replay and audit meaningful.

## Architecture

```
proposal ─► SENSORS ─► DECISION CORE (pure, no I/O, no LLM) ─► decision + audit record
            rules        G0 invariants → refuse/escalate              │
            history      G1 authority + confidence floor              ├─► WARRANT (execute only)
            LLM extract  G2 belief: log-odds, intervals, collapse     │      HMAC · action hash · policy ver · expiry · single-use
            LLM premortem G3 expected loss × 5 options                ▼
            (doubt-only) G4 value of information               ACTUATOR verifies → acts / 403
                         G5 argmin · margin · flip distances
outcomes ─► CALIBRATION LEDGER (Brier, ECE) ─► autonomy L0–L3 ─► shrinks authority in G1
```

| Path | Role |
|---|---|
| `src/core/` | pure engine: `belief`, `loss`, `decide`, `flip`, `map` |
| `src/domains/` | domain packs: refund, deploy, moderation, shell (22 scenarios) |
| `src/warrant/` | canonical hashing, HMAC warrants, verification |
| `src/ledger/` | hash-chained, server-sealed audit log; calibration + autonomy |
| `src/sensors/` | LLM sensors (AI SDK 7, structured output, doubt-only) |
| `src/server/`, `src/app/api/` | `/api/decide`, `/execute`, `/verify`, `/calibration`, `/health` |
| `src/app/_c/` | the console UI |

## Design decisions worth reading

1. **The model never decides.** It senses. The core is testable and replayable.
2. **LLMs may add doubt, never remove it.** Pre-mortem output is clamped to ≤ 0 inside the core; a jailbroken model can only make the system more cautious (property-tested).
3. **A gate, not an advisor.** The actuator verifies an HMAC warrant bound to the exact action, policy version and expiry; no warrant, a tampered action, a replayed warrant, or an expired one → 403 (all exercised in the UI and `tests/security.test.ts`).
4. **Correlated evidence counts once.** Signals sharing a provenance group collapse to one vote. This is the Echo Chamber fix.
5. **Reversibility sets the bar.** Cheap-to-undo actions are judged on the estimate, permanent ones on the pessimistic bound.
6. **Autonomy is earned.** A calibration ledger measures stated confidence against outcomes; drift demotes the engine L3 → L0 (shadow mode) automatically.
7. **Invariants beat confidence.** Refuse beats escalate beats everything.

## Add a domain

A domain is a `Pack` (see `src/core/types.ts`): `fields`, `extract(input) → signals`, `expected(input)` (what evidence
*should* exist), `exposure(input)`, `loss` table, `invariants`, `authority`, `scenarios`, and a hidden `truth()` for
calibration. Register it in `src/domains/index.ts`; the UI, API, audit, flips and calibration pick it up.

## Tests

`core` (goldens, determinism, monotonicity, per-domain safety properties) · `security` (warrants, forged/re-hashed audit
chains) · `failure` (the Echo Chamber ladder, authority cap, salami) · `map` (decision map pinned to the real engine).
`npm run e2e` (against a running server) exercises valid/missing/replayed/tampered warrants and chain forgery over HTTP.

## What breaks / out of scope

See [`docs/FAILURE_TEST.md`](docs/FAILURE_TEST.md). In short: genuinely independent forged evidence still executes (capped by authority); slow-drip abuse outside the rolling window isn't caught; calibration needs labelled outcomes; loss tables are human judgment.
**Out of scope on purpose:** real payments/deploys/takedowns (actuators are simulated; the warrant mechanism is real), learned loss models, multi-tenant auth and key rotation, a durable DB (the audit chain is client-held and server-sealed, so swap Postgres in behind the same record format). History behind the calibration charts is **synthetic**, generated by a hidden ground-truth model; the engine being measured is the real one.

## AI usage

Built with Claude Code. At runtime an LLM (via Vercel AI Gateway) is optional: a structured-output pre-mortem and a
free-text extractor, both subordinate to the deterministic core. Disabled, the app is fully functional.
