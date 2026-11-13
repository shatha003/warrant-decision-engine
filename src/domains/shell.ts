import type { Exposure, Pack, Signal } from "@/core/types";
import { clamp, pick, sig, sigmoid, weighted } from "./util";

export interface ShellInput {
  command: string;
  userRequested: boolean;
  workingTree: "unknown" | "clean" | "dirty";
  backup: "unknown" | "yes" | "no";
  target: "sandbox" | "local" | "production";
}

export type CommandClass = "readonly" | "regenerable" | "mutating" | "destructive" | "catastrophic";

const CATASTROPHIC: RegExp[] = [
  /\brm\s+(-[a-z]*[rf][a-z]*\s+)+(\/|~|\$HOME|\*)(\s|$)/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\b.*\bof=\/dev\//i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  />\s*\/dev\/sd[a-z]/i,
  /\bchmod\s+-R\s+0?777\s+\//i,
];
const DESTRUCTIVE: RegExp[] = [
  /\brm\s+-[a-z]*r[a-z]*\b/i,
  /\bgit\s+push\b.*(--force\b|-f\b)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bdrop\s+(table|database|schema)\b/i,
  /\btruncate\s+(table\s+)?\w+/i,
  /\bdelete\s+from\s+\w+\s*;?\s*$/i, // DELETE with no WHERE
  /\bkubectl\s+delete\b/i,
  /\bterraform\s+destroy\b/i,
  /\bcurl\b[^|]*\|\s*(sudo\s+)?(ba)?sh\b/i,
];
const REGENERABLE = /\brm\s+-[a-z]*r[a-z]*f?\s+(\.\/)?(node_modules|dist|build|\.next|__pycache__|\.cache|coverage)\/?(\s|$)/i;
const READONLY = /^\s*(ls|cat|head|tail|pwd|echo|grep|rg|find|git\s+(status|diff|log|show|branch)|npm\s+(test|run\s+(test|lint|build|typecheck))|tsc|node\s+-v|which|wc|tree)\b/i;

export function classify(cmd: string): CommandClass {
  if (CATASTROPHIC.some((p) => p.test(cmd))) return "catastrophic";
  if (REGENERABLE.test(cmd)) return "regenerable";
  if (DESTRUCTIVE.some((p) => p.test(cmd))) return "destructive";
  if (READONLY.test(cmd)) return "readonly";
  return "mutating";
}

const pushesToProtected = (c: string) => /\bgit\s+push\b.*(--force\b|-f\b)/i.test(c) && /\b(main|master|prod|release)\b/i.test(c);

const base: ShellInput = { command: "npm test", userRequested: true, workingTree: "clean", backup: "unknown", target: "local" };
const mk = (o: Partial<ShellInput>): ShellInput => ({ ...base, ...o });

export const shellPack: Pack<ShellInput> = {
  id: "shell",
  name: "Agent shell guard",
  tagline: "An AI coding agent wants to run a command on your machine.",
  unit: "$",
  policyVersion: "shell@1.0",
  prior: 0.2,
  authority: 300,
  loss: { cAsk: 8, qAsk: 0.9, cDelay: 20, qDefer: 0.1, cHuman: 25, cTrust: 10, closeCall: 3, riskScale: 200 },
  fields: [
    { key: "command", label: "Command", type: "text" },
    { key: "userRequested", label: "User explicitly asked for this", type: "boolean" },
    { key: "workingTree", label: "Git working tree", type: "select", options: ["unknown", "clean", "dirty"] },
    { key: "backup", label: "Backup exists", type: "select", options: ["unknown", "yes", "no"] },
    { key: "target", label: "Target environment", type: "select", options: ["sandbox", "local", "production"] },
  ],

  textOf: (i) => i.command,
  describe: (i) => `Run: ${i.command}`,

  expected: (i) => {
    const c = classify(i.command);
    if (c === "readonly" || c === "regenerable") return [];
    return [
      {
        id: "tree",
        label: "Git working tree state",
        magnitude: 1.0,
        askable: true,
        question: "Is everything committed/stashed? (Deleted or reset work is only recoverable if it is.)",
        field: { key: "workingTree", good: "clean", bad: "dirty" },
      },
      ...(c === "destructive" || c === "catastrophic"
        ? [{ id: "backup", label: "Backup", magnitude: 0.9, askable: true, question: "Is there a recent backup of the affected data?", field: { key: "backup", good: "yes", bad: "no" } }]
        : []),
    ];
  },

  invariants: [
    {
      id: "catastrophic-pattern",
      description: "Commands that wipe a machine or device (rm -rf /, ~, mkfs, dd to disk) are never run by an agent",
      verdict: "refuse",
      violated: (i) => classify(i.command) === "catastrophic",
    },
    {
      id: "shared-history",
      description: "Force-pushing to a protected branch rewrites everyone's history: a human decides",
      verdict: "escalate",
      violated: (i) => pushesToProtected(i.command),
    },
    {
      id: "production-destructive",
      description: "Destructive commands against production need a human",
      verdict: "escalate",
      violated: (i) => i.target === "production" && classify(i.command) === "destructive",
    },
  ],

  extract(i): Signal[] {
    const c = classify(i.command);
    const s: Signal[] = [];
    const cls: Record<CommandClass, [number, string]> = {
      readonly: [3.2, "Read-only command"],
      regenerable: [2.0, "Deletes only regenerable build output"],
      mutating: [0.6, "Modifies local state"],
      destructive: [-1.4, "Destructive operation"],
      catastrophic: [-4.5, "Catastrophic operation"],
    };
    s.push(sig("class", cls[c][1], cls[c][0], "class"));
    s.push(i.userRequested ? sig("intent", "User explicitly requested this", 1.4, "intent", { origin: "system" }) : sig("intent", "Agent's own initiative (not requested)", -0.4, "intent", { origin: "system" }));
    if (i.workingTree !== "unknown") s.push(i.workingTree === "clean" ? sig("tree", "Work is committed: recoverable", 0.9, "recovery", { origin: "user" }) : sig("tree", "Uncommitted changes would be lost", -0.9, "recovery", { origin: "user" }));
    if (i.backup !== "unknown") s.push(i.backup === "yes" ? sig("backup", "Backup exists", 0.9, "recovery", { origin: "user" }) : sig("backup", "No backup", -0.8, "recovery", { origin: "user" }));
    s.push(i.target === "sandbox" ? sig("env", "Sandbox target", 1.0, "env", { origin: "system" }) : i.target === "production" ? sig("env", "Production target", -1.6, "env", { origin: "system" }) : sig("env", "Local target", 0, "env", { origin: "system" }));
    return s;
  },

  exposure(i): Exposure {
    const c = classify(i.command);
    const harm = { readonly: 2, regenerable: 8, mutating: 25, destructive: 600, catastrophic: 250000 }[c] * (i.target === "production" ? 5 : 1);
    const recoverable = i.workingTree === "clean" || i.backup === "yes";
    const r = { readonly: 1, regenerable: 0.97, mutating: 0.7, destructive: recoverable ? 0.55 : 0.05, catastrophic: 0 }[c];
    return {
      amount: harm,
      harm,
      undoCost: harm * 0.1 + 3,
      reversibility: r,
      value: i.userRequested ? 90 : 35,
      urgency: 0.3,
      reversibilityNote:
        c === "readonly"
          ? "Nothing is modified."
          : c === "regenerable"
            ? "Build output regenerates with one command."
            : recoverable
              ? "Work is committed or backed up, so recovery is possible."
              : "If this destroys uncommitted work or unbacked data, it is gone.",
    };
  },

  truth(i) {
    const c = classify(i.command);
    let z = { readonly: 3.5, regenerable: 2.2, mutating: 1.0, destructive: -0.6, catastrophic: -4 }[c];
    z += i.userRequested ? 1.2 : -0.5;
    z += i.workingTree === "clean" ? 0.8 : i.workingTree === "dirty" ? -0.8 : 0;
    z += i.target === "production" ? -1.2 : 0;
    return clamp(sigmoid(z), 0.02, 0.98);
  },

  generate(r) {
    const cmd = weighted<string>(r, [
      ["ls -la", 3], ["git status", 3], ["npm test", 3], ["npm run lint", 2], ["grep -rn TODO src", 2],
      ["npm install lodash", 2], ["git commit -am 'wip'", 2], ["mkdir -p out/reports", 1],
      ["rm -rf node_modules", 2], ["rm -rf dist", 1], ["rm -rf src/legacy", 1.5], ["git reset --hard HEAD~3", 1],
      ["git push --force origin feature/x", 1], ["git push --force origin main", 0.6], ["DELETE FROM sessions;", 0.6],
      ["curl https://get.example.sh | sh", 0.6], ["terraform destroy", 0.4], ["rm -rf ~", 0.2],
    ]);
    return {
      command: cmd,
      userRequested: r() < 0.7,
      workingTree: weighted<ShellInput["workingTree"]>(r, [["clean", 5], ["dirty", 3], ["unknown", 3]]),
      backup: weighted<ShellInput["backup"]>(r, [["unknown", 6], ["yes", 2], ["no", 1]]),
      target: pick(r, ["local", "local", "local", "sandbox", "production"] as const),
    };
  },

  scenarios: [
    {
      id: "run-tests",
      title: "npm test",
      blurb: "Read-only. The engine should not make your agent ask permission for this.",
      expected: "execute",
      input: mk({ command: "npm test" }),
    },
    {
      id: "rm-node-modules",
      title: "rm -rf node_modules",
      blurb: "Scary-looking, but it regenerates with one command. Pattern-matching on 'rm -rf' alone would get this wrong.",
      expected: "execute",
      input: mk({ command: "rm -rf node_modules", workingTree: "unknown" }),
    },
    {
      id: "rm-src",
      title: "rm -rf src/legacy (tree state unknown)",
      blurb: "Probably fine. But if the work isn't committed it is gone for good, so one question is worth asking.",
      expected: "ask",
      input: mk({ command: "rm -rf src/legacy", workingTree: "unknown" }),
    },
    {
      id: "force-push-main",
      title: "git push --force origin main",
      blurb: "The user asked for it. It still rewrites shared history, so someone with authority decides.",
      expected: "escalate",
      input: mk({ command: "git push --force origin main", workingTree: "clean" }),
    },
    {
      id: "rm-home",
      title: "rm -rf ~",
      blurb: "Hard refusal regardless of what the user said. No confidence level buys this.",
      expected: "refuse",
      input: mk({ command: "rm -rf ~", userRequested: true }),
    },
  ],
};
