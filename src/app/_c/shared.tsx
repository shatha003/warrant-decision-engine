"use client";
import { useEffect, useState } from "react";
import type { Outcome, Pack } from "@/core/types";
import { fmt } from "@/core/decide";

export const OUTCOME: Record<Outcome, { label: string; glyph: string; color: string; means: string; short: string }> = {
  execute: { label: "EXECUTE", glyph: "▶", color: "var(--color-execute)", short: "act", means: "Evidence is strong enough for what this costs if wrong. A signed warrant is minted." },
  ask: { label: "ASK", glyph: "?", color: "var(--color-ask)", short: "ask", means: "One cheap question to the requester would change the answer." },
  defer: { label: "DEFER", glyph: "◷", color: "var(--color-defer)", short: "wait", means: "The missing evidence arrives on its own. Waiting beats acting blind." },
  escalate: { label: "ESCALATE", glyph: "↑", color: "var(--color-escalate)", short: "human", means: "A human with authority must decide. More evidence from here won't fix it." },
  refuse: { label: "REFUSE", glyph: "✕", color: "var(--color-refuse)", short: "no", means: "Not allowed, and no amount of evidence changes that." },
};
export const OUTCOMES: Outcome[] = ["execute", "ask", "defer", "escalate", "refuse"];

export const tint = (c: string, pct = 14) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

export function Tag({ o, size = "md" }: { o: Outcome; size?: "sm" | "md" }) {
  const m = OUTCOME[o];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded font-mono font-semibold tracking-wider ${size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]"}`}
      style={{ color: m.color, background: tint(m.color, 14), border: `1px solid ${tint(m.color, 35)}` }}
    >
      <span aria-hidden>{m.glyph}</span>
      {m.label}
    </span>
  );
}

export function Panel({ title, aside, children, className = "" }: { title?: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-panel ${className}`}>
      {title && (
        <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h3 className="label">{title}</h3>
          {aside}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Btn({
  children,
  onClick,
  tone = "default",
  disabled,
  title,
  small,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "default" | "primary" | "danger" | "ghost";
  disabled?: boolean;
  title?: string;
  small?: boolean;
}) {
  const tones = {
    default: "border-line bg-raised text-ink hover:border-faint",
    primary: "border-transparent bg-ink text-bg hover:bg-white font-semibold",
    danger: "border-[color-mix(in_srgb,var(--color-refuse)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-refuse)_10%,transparent)] text-refuse hover:bg-[color-mix(in_srgb,var(--color-refuse)_18%,transparent)]",
    ghost: "border-transparent text-mute hover:text-ink",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${small ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm"} ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

export function Meter({ value, color, label, right }: { value: number; color: string; label: string; right?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="font-mono text-xs text-mute">{right ?? `${Math.round(value * 100)}`}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(2, value * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

export const money = (pack: Pick<Pack, "unit">, n: number) => fmt(pack, n);
export const pct = (p: number) => `${Math.round(p * 100)}%`;

/** sessionStorage-backed state that tolerates private windows / blocked storage. */
export function useSession<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) setV(JSON.parse(raw));
    } catch {}
    setReady(true);
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(v));
    } catch {}
  }, [key, v, ready]);
  return [v, setV];
}
