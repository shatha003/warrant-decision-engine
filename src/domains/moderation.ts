import type { Exposure, Pack, Signal } from "@/core/types";
import { clamp, pick, sig, sigmoid, weighted } from "./util";

export interface ModerationInput {
  action: "remove_post" | "suspend_account";
  category: "harassment" | "spam" | "misinformation" | "adult" | "political";
  toxicity: number; // classifier score 0..1
  spam: number; // classifier score 0..1
  selfHarm: number; // classifier score 0..1
  reports: number;
  authorAgeDays: number;
  authorStrikes: number;
  reach: number; // expected impressions
  context: "unknown" | "quote_or_satire" | "direct";
  factCheck: "unknown" | "misleading" | "accurate";
  requester: "classifier" | "user_report" | "executive" | "government";
  criticalOfCompany: boolean;
  postText: string;
}

const base: ModerationInput = {
  action: "remove_post",
  category: "harassment",
  toxicity: 0.95,
  spam: 0.05,
  selfHarm: 0.02,
  reports: 14,
  authorAgeDays: 40,
  authorStrikes: 2,
  reach: 1200,
  context: "direct",
  factCheck: "unknown",
  requester: "classifier",
  criticalOfCompany: false,
  postText: "(abusive reply directed at another user)",
};
const mk = (o: Partial<ModerationInput>): ModerationInput => ({ ...base, ...o });

export const moderationPack: Pack<ModerationInput> = {
  id: "moderation",
  name: "Content moderation",
  tagline: "A moderation agent wants to take down a post or suspend an account.",
  unit: "pts",
  policyVersion: "moderation@3.0",
  prior: -0.2,
  authority: 150,
  loss: { cAsk: 4, qAsk: 0.65, cDelay: 12, qDefer: 0.9, cHuman: 14, cTrust: 8, closeCall: 3, riskScale: 80 },
  fields: [
    { key: "action", label: "Proposed action", type: "select", options: ["remove_post", "suspend_account"] },
    { key: "category", label: "Category", type: "select", options: ["harassment", "spam", "misinformation", "adult", "political"] },
    { key: "toxicity", label: "Violation score", type: "number", min: 0, max: 1, step: 0.05 },
    { key: "spam", label: "Spam score", type: "number", min: 0, max: 1, step: 0.05 },
    { key: "selfHarm", label: "Self-harm score", type: "number", min: 0, max: 1, step: 0.05 },
    { key: "reports", label: "User reports", type: "number", min: 0 },
    { key: "authorAgeDays", label: "Author account age (d)", type: "number", min: 0, step: 5 },
    { key: "authorStrikes", label: "Prior strikes", type: "number", min: 0 },
    { key: "reach", label: "Expected reach", type: "number", min: 0, step: 500 },
    { key: "context", label: "Context (quote/satire?)", type: "select", options: ["unknown", "quote_or_satire", "direct"] },
    { key: "factCheck", label: "Fact-check verdict", type: "select", options: ["unknown", "misleading", "accurate"] },
    { key: "requester", label: "Requested by", type: "select", options: ["classifier", "user_report", "executive", "government"] },
    { key: "criticalOfCompany", label: "Criticises the company", type: "boolean" },
    { key: "postText", label: "Post text", type: "text" },
  ],

  textOf: (i) => i.postText,
  describe: (i) => `${i.action === "remove_post" ? "Remove post" : "Suspend account"} (${i.category}, reach ${i.reach.toLocaleString("en-US")})`,

  expected: (i) => [
    {
      id: "context",
      label: "Quote / satire context",
      magnitude: 1.4,
      askable: true,
      question: "Is this quoting or satirising someone else? (asked of the reviewing moderator or the author)",
      field: { key: "context", good: "direct", bad: "quote_or_satire" },
    },
    ...(i.category === "misinformation"
      ? [{ id: "factcheck", label: "Fact-check verdict", magnitude: 1.6, resolvesWithTime: true, eta: "partner fact-check ~4h", field: { key: "factCheck", good: "misleading", bad: "accurate" } }]
      : []),
  ],

  invariants: [
    {
      id: "interested-party",
      description: "Removal demanded by an interested party for criticism of the company is not a policy violation",
      verdict: "refuse",
      violated: (i) => (i.requester === "executive" || i.requester === "government") && i.criticalOfCompany,
    },
    {
      id: "self-harm",
      description: "Possible self-harm content goes to the safety team, never to automated takedown",
      verdict: "escalate",
      violated: (i) => i.selfHarm >= 0.6,
    },
    {
      id: "political-speech",
      description: "Political speech is never auto-moderated",
      verdict: "escalate",
      violated: (i) => i.category === "political",
    },
  ],

  extract(i) {
    const s: Signal[] = [];
    const main = i.category === "spam" ? i.spam : i.toxicity;
    s.push(
      main >= 0.9
        ? sig("classifier", `Classifier ${Math.round(main * 100)}%`, 2.2, "classifier", { origin: "system" })
        : main >= 0.7
          ? sig("classifier", `Classifier ${Math.round(main * 100)}%`, 1.0, "classifier", { origin: "system" })
          : main < 0.4
            ? sig("classifier", `Classifier only ${Math.round(main * 100)}%`, -1.4, "classifier", { origin: "system" })
            : sig("classifier", `Classifier ${Math.round(main * 100)}%`, 0, "classifier", { origin: "system" }),
    );
    s.push(
      i.reports >= 10
        ? sig("reports", `${i.reports} user reports`, 1.2, "crowd", { origin: "system" })
        : i.reports >= 3
          ? sig("reports", `${i.reports} user reports`, 0.5, "crowd", { origin: "system" })
          : sig("reports", `${i.reports} user reports`, -0.3, "crowd", { origin: "system" }),
    );
    if (i.authorStrikes >= 2) s.push(sig("strikes", `${i.authorStrikes} prior strikes`, 0.8, "author", { origin: "system" }));
    if (i.authorAgeDays < 7) s.push(sig("newacct", "Brand-new account", 0.4, "author", { origin: "system" }));
    if (i.context === "quote_or_satire") s.push(sig("context", "Likely quote / satire", -1.6, "context", { origin: "user" }));
    if (i.context === "direct") s.push(sig("context", "Directly addressed to a person", 0.7, "context", { origin: "user" }));
    if (i.category === "misinformation" && i.factCheck !== "unknown")
      s.push(i.factCheck === "misleading" ? sig("factcheck", "Fact-checkers: misleading", 2.0, "factcheck", { origin: "system" }) : sig("factcheck", "Fact-checkers: accurate", -2.4, "factcheck", { origin: "system" }));
    return s;
  },

  exposure(i): Exposure {
    const suspend = i.action === "suspend_account";
    const harm = (suspend ? 220 : 80) + i.reach / 150;
    return {
      amount: harm,
      harm,
      undoCost: suspend ? 40 : 10,
      reversibility: suspend ? 0.5 : 0.7,
      value: 12 + i.reach / 90 + i.toxicity * 40,
      urgency: i.reach > 50000 ? 0.8 : 0.3,
      reversibilityNote: suspend
        ? "A wrongful suspension damages trust even if the appeal is granted."
        : "A wrongly removed post can be restored on appeal within minutes.",
    };
  },

  truth(i) {
    const main = i.category === "spam" ? i.spam : i.toxicity;
    let z = -1.65 + main * 3.4 + Math.min(i.reports, 20) * 0.08 + i.authorStrikes * 0.35;
    z += i.context === "quote_or_satire" ? -2 : i.context === "direct" ? 0.4 : 0;
    return clamp(sigmoid(z), 0.02, 0.98);
  },

  generate(r) {
    const category = weighted<ModerationInput["category"]>(r, [["harassment", 4], ["spam", 4], ["misinformation", 2], ["adult", 1.5], ["political", 1]]);
    const hot = r() < 0.45;
    return {
      action: r() < 0.15 ? "suspend_account" : "remove_post",
      category,
      toxicity: clamp(hot ? 0.7 + r() * 0.3 : r() * 0.8, 0, 1),
      spam: category === "spam" ? clamp(0.6 + r() * 0.4, 0, 1) : r() * 0.3,
      selfHarm: r() < 0.05 ? 0.6 + r() * 0.4 : r() * 0.2,
      reports: Math.floor(r() * (hot ? 30 : 6)),
      authorAgeDays: Math.floor(r() * 900),
      authorStrikes: weighted(r, [[0, 6], [1, 2], [3, 1.4]]),
      reach: Math.round(weighted(r, [[200 + r() * 2000, 6], [3000 + r() * 30000, 3], [60000 + r() * 400000, 1]])),
      context: weighted<ModerationInput["context"]>(r, [["direct", 5], ["unknown", 4], ["quote_or_satire", 1.5]]),
      factCheck: weighted<ModerationInput["factCheck"]>(r, [["unknown", 5], ["misleading", 2], ["accurate", 1]]),
      requester: pick(r, ["classifier", "classifier", "user_report", "user_report", "executive"] as const),
      criticalOfCompany: r() < 0.08,
      postText: "(synthetic)",
    };
  },

  scenarios: [
    {
      id: "clear-spam",
      title: "Obvious crypto spam",
      blurb: "99% spam, brand-new account, ten reports, tiny reach, trivially restorable.",
      expected: "execute",
      input: mk({ category: "spam", spam: 0.99, toxicity: 0.1, authorAgeDays: 1, authorStrikes: 0, reports: 12, reach: 300, context: "direct" }),
    },
    {
      id: "maybe-satire",
      title: "Harsh, but is it satire?",
      blurb: "High toxicity score, few reports. One question about context decides it.",
      expected: "ask",
      input: mk({ toxicity: 0.75, reports: 3, authorStrikes: 0, authorAgeDays: 600, context: "unknown", reach: 900 }),
    },
    {
      id: "fact-check",
      title: "Viral claim awaiting the fact-checker",
      blurb: "The partner fact-check lands in a few hours. Taking it down now would be a coin-flip with a megaphone.",
      expected: "defer",
      input: mk({ category: "misinformation", toxicity: 0.72, reports: 6, authorStrikes: 0, context: "direct", reach: 2500 }),
    },
    {
      id: "viral-suspend",
      title: "Suspend a 2M-reach account",
      blurb: "Plausibly justified. But suspending is expensive to get wrong and exceeds what this engine may decide alone.",
      expected: "escalate",
      input: mk({ action: "suspend_account", reach: 2_000_000, toxicity: 0.93, reports: 40, authorStrikes: 3 }),
    },
    {
      id: "ceo-critic",
      title: "'Take down this post about the CEO'",
      blurb: "Requested by an executive; the post just criticises the company. The classifier barely cares. The rule does.",
      expected: "refuse",
      input: mk({ requester: "executive", criticalOfCompany: true, toxicity: 0.35, reports: 1, authorStrikes: 0, context: "direct", reach: 80000, category: "harassment" }),
    },
  ],
};
