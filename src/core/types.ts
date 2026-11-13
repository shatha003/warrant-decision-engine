/**
 * WARRANT core types.
 * This directory is PURE: no I/O, no LLM imports, no clock, no randomness.
 * Same input -> byte-identical decision. That is what makes replay and audit meaningful.
 */

export const OUTCOMES = ["execute", "ask", "defer", "escalate", "refuse"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export type Origin =
  | "rule" //        deterministic extractor
  | "system" //      looked up from trusted records
  | "user" //        supplied by the requester (answers to `ask`)
  | "llm" //         LLM extractor: capped reliability
  | "premortem"; //  LLM red-team: DOUBT-ONLY (can never support the action)

/** One piece of evidence. `llr` is a log-likelihood ratio: >0 supports "this action is correct". */
export interface Signal {
  id: string;
  label: string;
  llr: number;
  /** 0..1 how much we trust the source of this signal */
  reliability: number;
  /** 0..1 how fresh it is (stale evidence widens uncertainty) */
  freshness: number;
  /**
   * Provenance group. Signals sharing a group are NOT independent: they collapse to one vote.
   * (This is the fix for the "Echo Chamber" failure test.)
   */
  group: string;
  origin: Origin;
  detail?: string;
}

/** Evidence the pack *expects* to have. If absent, it is missing information. */
export interface ExpectedSignal {
  id: string;
  label: string;
  /** Typical |llr| this evidence would carry: how much uncertainty its absence leaves behind. */
  magnitude: number;
  /** Requester (or context) can supply it right now -> candidate for `ask` */
  askable?: boolean;
  /** Will arrive by itself with time -> candidate for `defer` */
  resolvesWithTime?: boolean;
  question?: string;
  /** Input field that answers this (so the UI can resolve it for real). `good` supports the action, `bad` contradicts it. */
  field?: { key: string; good: string; bad: string };
  /** When does it arrive? shown to humans + used as re-evaluation trigger */
  eta?: string;
}

/** What is at stake if we act. All money-like values share one unit (pack.unit). */
export interface Exposure {
  /** Quantity used for authority limits (may be cumulative, e.g. rolling refund total). */
  amount: number;
  /** Cost if the action turns out to be wrong, before reversibility. */
  harm: number;
  /** Cost to undo the action if it's reversible. */
  undoCost: number;
  /** 0..1: 0 = permanent, 1 = trivially undone. */
  reversibility: number;
  /** Cost of NOT acting when the action was in fact correct. */
  value: number;
  /** 0..1: how time-critical. Kills `defer` when high. */
  urgency: number;
  /** Plain-english reversibility note for the UI. */
  reversibilityNote: string;
}

export interface LossParams {
  /** friction of asking the requester a question */
  cAsk: number;
  /** probability an answer fully resolves the askable uncertainty */
  qAsk: number;
  /** cost of delay at urgency=1 (scaled by urgency) */
  cDelay: number;
  /** probability that waiting resolves the time-resolvable uncertainty */
  qDefer: number;
  /** cost of routing to a human */
  cHuman: number;
  /** cost of refusing (trust damage), paid even if refusal was right */
  cTrust: number;
  /** execute must beat the runner-up by at least this much, else it's a "close call" -> escalate */
  closeCall: number;
  /** scale used to squash expected loss into a 0..1 risk score */
  riskScale: number;
}

export interface Invariant<I> {
  id: string;
  description: string;
  verdict: "refuse" | "escalate";
  violated: (input: I, ctx: { signals: Signal[]; exposure: Exposure }) => boolean;
  explain?: (input: I) => string;
}

export interface Scenario<I> {
  id: string;
  title: string;
  blurb: string;
  input: I;
  /** What a sane human would do. Used for tests + the "expected" chip in the UI. */
  expected?: Outcome;
  tags?: string[];
}

export interface Pack<I = any> {
  id: string;
  name: string;
  tagline: string;
  unit: string; // "$", "pts"
  policyVersion: string;
  /** log-odds prior that a random proposal in this domain is correct */
  prior: number;
  /** autonomous authority (in `amount` units) at full autonomy */
  authority: number;
  loss: LossParams;
  /** Evidence this domain wants for THIS input. Absent evidence = missing information. */
  expected: (input: I) => ExpectedSignal[];
  invariants: Invariant<I>[];
  /** deterministic sensors */
  extract: (input: I) => Signal[];
  exposure: (input: I) => Exposure;
  /** human summary of the proposed action (shown in UI and hashed into the warrant) */
  describe: (input: I) => string;
  /** hidden ground truth for the synthetic history (calibration ledger). Returns P(correct). */
  truth: (input: I) => number;
  /** random case generator for history (takes a uniform rng) */
  generate: (rng: () => number) => I;
  scenarios: Scenario<I>[];
  /** free text in the input that LLM sensors may read (always treated as DATA, never instructions) */
  textOf?: (input: I) => string;
  /** form fields for the UI editor */
  fields: FieldSpec[];
}

export type FieldSpec =
  | { key: string; label: string; type: "number"; min?: number; max?: number; step?: number }
  | { key: string; label: string; type: "boolean" }
  | { key: string; label: string; type: "select"; options: string[] }
  | { key: string; label: string; type: "text" };

export type AutonomyLevel = 0 | 1 | 2 | 3;

export interface EngineState {
  autonomy: AutonomyLevel;
}

export interface Belief {
  /** point estimate P(action correct) */
  mid: number;
  lo: number;
  hi: number;
  /** reversibility-weighted pessimistic probability actually used for execute */
  effective: number;
  logOdds: number;
  spread: number;
  /** share of uncertainty an answer from the requester could resolve */
  askableShare: number;
  /** share of uncertainty that time will resolve */
  timeShare: number;
  conflict: number;
}

export interface MissingInfo {
  id: string;
  label: string;
  askable: boolean;
  resolvesWithTime: boolean;
  question?: string;
  eta?: string;
  magnitude: number;
  field?: { key: string; good: string; bad: string };
}

export type LossTable = Record<Outcome, number | null>; // null = not applicable

export interface Flip {
  kind: "signal" | "missing" | "scale";
  change: string; // "If <X> were <Y>"
  to: Outcome;
  /** machine-readable counterfactual so the UI can apply it */
  patch:
    | { type: "remove" | "reverse"; signalId: string }
    | { type: "supply"; signalId: string; sign: 1 | -1; field?: { key: string; value: string } }
    | { type: "scale"; factor: number };
}

export interface TraceStep {
  gate: "G0" | "G1" | "G2" | "G3" | "G4" | "G5";
  title: string;
  detail: string;
  /** which direction this step pushed */
  effect?: "pass" | "block" | "info";
}

export interface Decision {
  outcome: Outcome;
  /** engine would have said this, but autonomy level forced shadow mode */
  shadowed?: Outcome;
  confidence: { lo: number; mid: number; hi: number; effective: number };
  riskScore: number; // 0..1
  reversibility: { value: number; note: string };
  exposure: Exposure;
  evidenceUsed: (Signal & { effective: number; collapsedInto?: string })[];
  missingInfo: MissingInfo[];
  lossTable: LossTable;
  evoi: number;
  margin: number;
  runnerUp: Outcome | null;
  flips: Flip[];
  trace: TraceStep[];
  headline: string;
  reason: string;
  /** For `defer`: when to re-evaluate. For `ask`: the questions. */
  nextStep: string | null;
  policyVersion: string;
  autonomy: AutonomyLevel;
  packId: string;
  action: string;
}
