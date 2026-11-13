import type { Exposure, Pack, Scenario, Signal } from "@/core/types";
import { clamp, pick, sig, sigmoid, weighted } from "./util";

export interface DeployInput {
  service: "checkout" | "search" | "admin-tool" | "docs-site";
  changedLines: number;
  ci: "unknown" | "green" | "red";
  coveragePct: number;
  approvals: number;
  canary: "unknown" | "healthy" | "degraded";
  rollbackTested: "unknown" | "yes" | "no";
  hasMigration: boolean;
  day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  hourUtc: number;
  isHotfix: boolean;
  changeFreeze: boolean;
  allRegions: boolean;
  authorTenureMonths: number;
}

const HOURLY_COST: Record<DeployInput["service"], number> = {
  checkout: 50000,
  search: 12000,
  "admin-tool": 2000,
  "docs-site": 200,
};

const base: DeployInput = {
  service: "docs-site",
  changedLines: 40,
  ci: "green",
  coveragePct: 86,
  approvals: 2,
  canary: "healthy",
  rollbackTested: "yes",
  hasMigration: false,
  day: "Tue",
  hourUtc: 14,
  isHotfix: false,
  changeFreeze: false,
  allRegions: false,
  authorTenureMonths: 30,
};
const mk = (o: Partial<DeployInput>): DeployInput => ({ ...base, ...o });

export const deployPack: Pack<DeployInput> = {
  id: "deploy",
  name: "Production deploy gate",
  tagline: "A CI agent wants to ship a build to production.",
  unit: "$",
  policyVersion: "deploy@1.4",
  prior: 0.4,
  authority: 20000,
  loss: { cAsk: 40, qAsk: 0.8, cDelay: 150, qDefer: 0.9, cHuman: 250, cTrust: 150, closeCall: 12, riskScale: 6000 },
  fields: [
    { key: "service", label: "Service", type: "select", options: ["checkout", "search", "admin-tool", "docs-site"] },
    { key: "changedLines", label: "Lines changed", type: "number", min: 0, step: 20 },
    { key: "ci", label: "CI status", type: "select", options: ["unknown", "green", "red"] },
    { key: "coveragePct", label: "Test coverage (%)", type: "number", min: 0, max: 100 },
    { key: "approvals", label: "Review approvals", type: "number", min: 0, max: 5 },
    { key: "canary", label: "Canary result", type: "select", options: ["unknown", "healthy", "degraded"] },
    { key: "rollbackTested", label: "Rollback rehearsed", type: "select", options: ["unknown", "yes", "no"] },
    { key: "hasMigration", label: "Includes DB migration", type: "boolean" },
    { key: "day", label: "Day", type: "select", options: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
    { key: "hourUtc", label: "Hour (UTC)", type: "number", min: 0, max: 23 },
    { key: "isHotfix", label: "Hotfix (urgent)", type: "boolean" },
    { key: "changeFreeze", label: "Change freeze active", type: "boolean" },
    { key: "allRegions", label: "All regions at once", type: "boolean" },
    { key: "authorTenureMonths", label: "Author tenure (months)", type: "number", min: 0 },
  ],

  describe: (i) =>
    `Deploy ${i.changedLines}-line change to ${i.service} (${i.allRegions ? "all regions" : "one region"}${i.hasMigration ? ", with DB migration" : ""})`,

  expected: (i) => [
    { id: "ci", label: "CI result", magnitude: 1.5, resolvesWithTime: true, eta: "pipeline finishes in ~8 min", field: { key: "ci", good: "green", bad: "red" } },
    ...(i.service !== "docs-site"
      ? [{ id: "canary", label: "Canary health", magnitude: 1.6, resolvesWithTime: true, eta: "30-min canary soak", field: { key: "canary", good: "healthy", bad: "degraded" } }]
      : []),
    {
      id: "rollback",
      label: "Rollback rehearsal",
      magnitude: 0.9,
      askable: true,
      question: "Has the rollback for this change been rehearsed in staging?",
      field: { key: "rollbackTested", good: "yes", bad: "no" },
    },
  ],

  invariants: [
    {
      id: "ci-red",
      description: "Never ship a build with red CI",
      verdict: "refuse",
      violated: (i) => i.ci === "red",
    },
    {
      id: "change-freeze",
      description: "Change freeze is active and this is not a declared hotfix",
      verdict: "refuse",
      violated: (i) => i.changeFreeze && !i.isHotfix,
    },
  ],

  extract(i) {
    const s: Signal[] = [];
    if (i.ci !== "unknown") s.push(i.ci === "green" ? sig("ci", "CI green", 1.5, "ci", { origin: "system" }) : sig("ci", "CI red", -3, "ci", { origin: "system" }));
    s.push(
      i.coveragePct >= 80
        ? sig("coverage", `Coverage ${i.coveragePct}%`, 0.5, "quality", { origin: "system" })
        : i.coveragePct < 50
          ? sig("coverage", `Low coverage ${i.coveragePct}%`, -0.7, "quality", { origin: "system" })
          : sig("coverage", `Coverage ${i.coveragePct}%`, 0, "quality", { origin: "system" }),
    );
    s.push(
      i.approvals >= 2
        ? sig("review", `${i.approvals} approvals`, 0.9, "review", { origin: "system" })
        : i.approvals === 1
          ? sig("review", "1 approval", 0.3, "review", { origin: "system" })
          : sig("review", "No review approvals", -1.3, "review", { origin: "system" }),
    );
    s.push(
      i.changedLines > 800
        ? sig("size", `Large change (${i.changedLines} lines)`, -0.9, "change", { origin: "system" })
        : i.changedLines < 100
          ? sig("size", `Small change (${i.changedLines} lines)`, 0.4, "change", { origin: "system" })
          : sig("size", `Medium change (${i.changedLines} lines)`, 0, "change", { origin: "system" }),
    );
    if (i.hasMigration) s.push(sig("migration", "Includes schema migration", -0.9, "change", { origin: "system" }));
    if (i.canary !== "unknown") s.push(i.canary === "healthy" ? sig("canary", "Canary healthy", 1.6, "canary", { origin: "system" }) : sig("canary", "Canary degraded", -2.6, "canary", { origin: "system" }));
    if (i.rollbackTested !== "unknown") s.push(i.rollbackTested === "yes" ? sig("rollback", "Rollback rehearsed", 0.9, "rollback", { origin: "user" }) : sig("rollback", "Rollback never rehearsed", -1.0, "rollback", { origin: "user" }));
    if (i.authorTenureMonths >= 12) s.push(sig("author", `Experienced author (${i.authorTenureMonths}mo)`, 0.4, "author", { origin: "system" }));
    if ((i.day === "Fri" && i.hourUtc >= 15) || i.day === "Sat" || i.day === "Sun") s.push(sig("timing", `Risky window (${i.day} ${i.hourUtc}:00 UTC)`, -0.9, "timing", { origin: "system", detail: "Thin on-call coverage heading into a weekend." }));
    return s;
  },

  exposure(i): Exposure {
    const hourly = HOURLY_COST[i.service];
    const outageHours = i.hasMigration ? 3 : 1.5;
    const blast = i.allRegions ? 1 : 0.2;
    const harm = hourly * outageHours * blast;
    return {
      amount: harm,
      harm,
      undoCost: hourly * 0.1 * blast + 50,
      reversibility: i.hasMigration ? 0.3 : 0.85,
      value: 600 + i.changedLines * 0.8 + (i.isHotfix ? 3000 : 0),
      urgency: i.isHotfix ? 0.9 : 0.2,
      reversibilityNote: i.hasMigration
        ? "A schema migration cannot simply be rolled back: data has moved."
        : "Rollback to the previous build takes ~5 minutes.",
    };
  },

  truth(i) {
    let z = 0.2 + (i.ci === "green" ? 1.2 : i.ci === "red" ? -3 : 0) + Math.min(i.approvals, 2) * 0.5 + (i.coveragePct - 65) / 40;
    z += i.canary === "healthy" ? 1.4 : i.canary === "degraded" ? -2.8 : 0;
    z += i.rollbackTested === "yes" ? 0.7 : i.rollbackTested === "no" ? -0.7 : 0;
    z -= i.hasMigration ? 0.8 : 0;
    z -= i.changedLines > 800 ? 1.0 : 0;
    z -= i.day === "Fri" && i.hourUtc >= 15 ? 0.9 : 0;
    return clamp(sigmoid(z), 0.02, 0.98);
  },

  generate(r) {
    return {
      service: weighted<DeployInput["service"]>(r, [["docs-site", 3], ["admin-tool", 3], ["search", 2], ["checkout", 2]]),
      changedLines: Math.round(weighted(r, [[10 + r() * 90, 5], [100 + r() * 600, 4], [800 + r() * 2000, 1.5]])),
      ci: weighted<DeployInput["ci"]>(r, [["green", 7], ["unknown", 2], ["red", 1]]),
      coveragePct: Math.round(35 + r() * 62),
      approvals: weighted(r, [[2, 6], [1, 2], [0, 1.2]]),
      canary: weighted<DeployInput["canary"]>(r, [["healthy", 5], ["unknown", 4], ["degraded", 1]]),
      rollbackTested: weighted<DeployInput["rollbackTested"]>(r, [["yes", 5], ["unknown", 3], ["no", 1.5]]),
      hasMigration: r() < 0.2,
      day: pick(r, ["Mon", "Tue", "Wed", "Thu", "Fri", "Fri", "Sat"] as const),
      hourUtc: Math.floor(r() * 24),
      isHotfix: r() < 0.1,
      changeFreeze: r() < 0.05,
      allRegions: r() < 0.35,
      authorTenureMonths: Math.floor(r() * 60),
    };
  },

  scenarios: [
    {
      id: "docs-typo",
      title: "Typo fix on the docs site",
      blurb: "Tiny, reviewed, green, trivially reversible. If the engine can't say yes to this, it is useless.",
      expected: "execute",
      input: mk({}),
    },
    {
      id: "canary-soaking",
      title: "Checkout change: canary still soaking",
      blurb: "Good signals, but the 30-min canary is the one signal that matters and it arrives by itself. Don't ask. Wait.",
      expected: "defer",
      input: mk({ service: "checkout", changedLines: 300, canary: "unknown", ci: "green", approvals: 1, authorTenureMonths: 6, coveragePct: 66 }),
    },
    {
      id: "rollback-unknown",
      title: "Search ranking tweak, rollback unverified",
      blurb: "Healthy canary, all regions, and nobody confirmed rollback works. One question to the engineer settles it.",
      expected: "ask",
      input: mk({ service: "search", allRegions: true, changedLines: 300, canary: "healthy", rollbackTested: "unknown", approvals: 1, authorTenureMonths: 6, coveragePct: 66 }),
    },
    {
      id: "friday-migration",
      title: "Friday 5pm, all regions, DB migration",
      blurb: "Every box is ticked and it's still wrong. Permanent change, weekend, no on-call depth.",
      expected: "escalate",
      input: mk({ service: "checkout", changedLines: 600, hasMigration: true, allRegions: true, day: "Fri", hourUtc: 21, canary: "healthy" }),
    },
    {
      id: "red-ci",
      title: "'Just ship it', CI is red",
      blurb: "An invariant, not a probability. No amount of urgency or confidence buys this.",
      expected: "refuse",
      input: mk({ service: "search", ci: "red", isHotfix: true }),
    },
  ],
};
