"use client";
import { useEffect, useState } from "react";
import type { Outcome, Pack } from "@/core/types";
import { fmt } from "@/core/decide";

export const OUTCOME: Record<Outcome, { label: string; glyph: string; color: string; means: string; short: string; stamp: string }> = {
  execute: { label: "EXECUTE", glyph: "▶", color: "var(--color-execute)", short: "act", stamp: "AUTHORISED", means: "Evidence is strong enough for what this costs if wrong. A signed warrant is minted." },
  ask: { label: "ASK", glyph: "?", color: "var(--color-ask)", short: "ask", stamp: "HELD · QUESTION", means: "One cheap question to the requester would change the answer." },
  defer: { label: "DEFER", glyph: "◷", color: "var(--color-defer)", short: "wait", stamp: "HELD · WAIT", means: "The missing evidence arrives on its own. Waiting beats acting blind." },
  escalate: { label: "ESCALATE", glyph: "↑", color: "var(--color-escalate)", short: "human", stamp: "REFERRED", means: "A human with authority must decide. More evidence from here won't fix it." },
  refuse: { label: "REFUSE", glyph: "✕", color: "var(--color-refuse)", short: "no", stamp: "DENIED", means: "Not allowed, and no amount of evidence changes that." },
};
export const OUTCOMES: Outcome[] = ["execute", "ask", "defer", "escalate", "refuse"];

export const tint = (c: string, pct = 14) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

const ink = (a: number) => `color-mix(in srgb, var(--color-ink) ${a}%, transparent)`;

/** Each outcome is a territory with its own engraved texture (mirrors the canvas patterns in DecisionMap). */
export const TEXTURE: Record<Outcome, string> = {
  execute: `color-mix(in srgb, var(--color-execute) 28%, var(--color-panel))`,
  ask: `radial-gradient(${ink(70)} 0.8px, transparent 1.15px) 0 0 / 5px 5px, var(--color-panel)`,
  defer: `repeating-linear-gradient(0deg, ${ink(55)} 0 1px, transparent 1px 4px), var(--color-panel)`,
  escalate: `repeating-linear-gradient(45deg, ${ink(70)} 0 1px, transparent 1px 4.5px), var(--color-panel)`,
  refuse: `repeating-linear-gradient(45deg, var(--color-refuse) 0 1px, transparent 1px 4px), repeating-linear-gradient(-45deg, var(--color-refuse) 0 1px, transparent 1px 4px), var(--color-panel)`,
};

export function Swatch({ o, size = 10 }: { o: Outcome; size?: number }) {
  return <i aria-hidden className="inline-block shrink-0 border border-ink/45" style={{ width: size, height: size, background: TEXTURE[o] }} />;
}

export function Tag({ o, size = "md" }: { o: Outcome; size?: "sm" | "md" }) {
  const m = OUTCOME[o];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap font-mono font-semibold tracking-[0.08em] ${size === "sm" ? "text-[10px]" : "text-[11px]"}`} style={{ color: m.color }}>
      <Swatch o={o} size={size === "sm" ? 9 : 11} />
      {m.label}
    </span>
  );
}

export function Panel({ title, aside, children, className = "" }: { title?: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`border border-line bg-panel ${className}`}>
      {title && (
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-3">
          <h3 className="text-[14px] font-semibold tracking-tight text-ink">{title}</h3>
          {aside}
        </header>
      )}
      <div className="p-5">{children}</div>
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
    default: "border-ink/25 bg-panel text-ink hover:border-ink",
    primary: "border-ink bg-ink text-panel hover:bg-[#2c2e35] font-medium",
    danger: "border-refuse/45 bg-panel text-refuse hover:border-refuse",
    ghost: "border-transparent text-mute hover:text-ink",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`whitespace-nowrap border transition-[color,background,border-color,transform] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35 ${small ? "px-2.5 py-1 text-[12px]" : "px-4 py-2 text-[13.5px]"} ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

/** A bar on a hairline baseline (no filled track). */
export function Meter({ value, color, label, right }: { value: number; color: string; label: string; right?: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="font-mono text-xs text-ink">{right ?? `${Math.round(value * 100)}`}</span>
      </div>
      <div className="relative h-2">
        <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
        <div className="absolute top-0 h-2 transition-[width] duration-500" style={{ width: `${Math.max(1, value * 100)}%`, background: color }} />
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
