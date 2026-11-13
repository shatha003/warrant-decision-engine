"use client";
import { useEffect, useId, useState } from "react";
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
    <section className={`sticker reveal ${className}`}>
      {title && (
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-[1.5px] border-dashed border-ink px-5 py-3">
          <h3 className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.01em] text-ink">
            <i aria-hidden className="inline-block h-2.5 w-2.5 rotate-45 bg-ink" />
            {title}
          </h3>
          {aside}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

/** A strip of caution tape that scrolls forever. */
export function Tape({ items, tone = "pink", reverse, dur = 38, className = "" }: { items: string[]; tone?: "pink" | "blue" | "sun" | "ink"; reverse?: boolean; dur?: number; className?: string }) {
  const bg = { pink: "var(--color-pink)", blue: "var(--color-blue)", sun: "var(--color-sun)", ink: "var(--color-ink)" }[tone];
  const fg = tone === "blue" || tone === "ink" ? "var(--color-panel)" : "var(--color-ink)";
  const run = (
    <span className="flex shrink-0 items-center">
      {items.map((t, i) => (
        <span key={i} className="flex items-center">
          <span className="display px-5 text-[26px] leading-none sm:text-[30px]">{t}</span>
          <Star className="h-5 w-5 shrink-0" />
        </span>
      ))}
    </span>
  );
  return (
    <div className={`tape py-2.5 ${className}`} style={{ background: bg, color: fg }} aria-hidden>
      <div className={`tape-track ${reverse ? "rev" : ""}`} style={{ ["--dur" as string]: `${dur}s` }}>
        {run}
        {run}
      </div>
    </div>
  );
}

export function Star({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden>
      <path d="M12 0l2.6 8.2L23 6l-6.4 6 6.4 6-8.4-2.2L12 24l-2.6-8.2L1 18l6.4-6L1 6l8.4 2.2z" fill="currentColor" />
    </svg>
  );
}

/** Rotating wax seal with text around the rim. */
export function Seal({ size = 150, center, ring = "SIGNED · SEALED · SINGLE-USE · NO WARRANT · NO ACTION · ", tone = "blue" }: { size?: number; center?: React.ReactNode; ring?: string; tone?: "blue" | "pink" | "sun" }) {
  const fill = { blue: "var(--color-blue)", pink: "var(--color-pink)", sun: "var(--color-sun)" }[tone];
  const fg = tone === "blue" ? "var(--color-panel)" : "var(--color-ink)";
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 200 200" className="spin absolute inset-0 h-full w-full">
        <defs>
          <path id={`ring${id}`} d="M100,100 m-74,0 a74,74 0 1,1 148,0 a74,74 0 1,1 -148,0" />
        </defs>
        <path
          d={Array.from({ length: 24 }, (_, i) => {
            const a = (i / 24) * Math.PI * 2;
            const r = i % 2 ? 92 : 99;
            return `${i ? "L" : "M"}${(100 + Math.cos(a) * r).toFixed(1)} ${(100 + Math.sin(a) * r).toFixed(1)}`;
          }).join("") + "Z"}
          fill={fill}
          stroke="var(--color-ink)"
          strokeWidth="2.5"
        />
        <circle cx="100" cy="100" r="60" fill="none" stroke={fg} strokeWidth="1.5" strokeDasharray="2 4" />
        <text fill={fg} fontFamily="var(--font-mono)" fontSize="13" fontWeight="700" letterSpacing="2.6">
          <textPath href={`#ring${id}`}>{ring}</textPath>
        </text>
      </svg>
      <div className="absolute inset-0 grid place-items-center" style={{ color: fg }}>
        {center}
      </div>
    </div>
  );
}

/** A word whose letters slam onto the page. Re-keys on change so it replays. */
export function SlamWord({ text, className = "", style }: { text: string; className?: string; style?: React.CSSProperties }) {
  return (
    <span key={text} className={className} style={style} aria-label={text}>
      {[...text].map((ch, i) => (
        <span key={i} aria-hidden className="slam" style={{ ["--i" as string]: i }}>
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}

/** Poster-style section opener used on every tab. */
export function TabHero({ kicker, title, accent, children }: { kicker: string; title: string; accent?: string; children?: React.ReactNode }) {
  return (
    <section className="mb-10 grid items-end gap-6 border-b-2 border-ink pb-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,44ch)]">
      <div>
        <p className="label mb-4 flex items-center gap-2">
          <Star className="h-3 w-3 text-pink" />
          {kicker}
        </p>
        <h1 className="display text-[64px] sm:text-[96px] lg:text-[120px]">
          <span className="line-mask">
            <span className="line-up overprint ink squash" data-text={title}>
              {title}
            </span>
          </span>
          {accent && (
            <span className="line-mask">
              <span className="line-up serif-i block text-[0.78em] leading-[0.95] text-refuse" style={{ ["--i" as string]: 1 }}>
                {accent}
              </span>
            </span>
          )}
        </h1>
      </div>
      {children && <div className="rise text-[15.5px] leading-relaxed text-mute [animation-delay:300ms]">{children}</div>}
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
    default: "press border-ink bg-panel text-ink hover:bg-sun font-semibold",
    primary: "press border-ink bg-ink text-panel hover:bg-blue font-bold",
    danger: "press border-ink bg-panel text-refuse hover:bg-pink hover:text-ink font-semibold",
    ghost: "border-transparent text-mute underline-offset-4 hover:text-ink hover:underline",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`whitespace-nowrap border-[1.5px] disabled:cursor-not-allowed disabled:opacity-35 ${small ? "px-2.5 py-1 text-[12px]" : "px-4 py-2 text-[14px]"} ${tones[tone]}`}
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
