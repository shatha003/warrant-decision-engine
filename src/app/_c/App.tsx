"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PACKS, naiveRefundPack } from "@/domains";
import { buildHistory, calibrate, type Calibration } from "@/ledger/calibration";
import type { AuditRecord } from "@/ledger/audit";
import { AboutTab } from "./AboutTab";
import { AuditTab } from "./AuditTab";
import { AutonomyTab } from "./AutonomyTab";
import { Console, type Input } from "./Console";
import { FailureTab } from "./FailureTab";
import { OUTCOME, useSession } from "./shared";

type Tab = "decide" | "audit" | "autonomy" | "failure" | "about";
type CalParams = { badWeeks: number; extra: [number, boolean][] };
const NO_CAL: CalParams = { badWeeks: 0, extra: [] };
const LIST = Object.values(PACKS);

const TABS: { id: Tab; label: string }[] = [
  { id: "decide", label: "Decide" },
  { id: "audit", label: "Audit" },
  { id: "autonomy", label: "Autonomy" },
  { id: "failure", label: "Failure test" },
  { id: "about", label: "How it works" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("decide");
  const [packId, setPackId] = useState("refund");
  const [variant, setVariant] = useState<"guarded" | "naive">("guarded");
  const basePack = PACKS[packId];
  const pack = packId === "refund" && variant === "naive" ? naiveRefundPack : basePack;

  const [input, setInputState] = useState<Input>(basePack.scenarios[0].input as Input);
  const [scenarioId, setScenarioId] = useState<string | null>(basePack.scenarios[0].id);
  const [stakeScale, setStakeScale] = useState(1);
  const [sensors, setSensors] = useState<"offline" | "llm">("offline");
  const [llmAvailable, setLlmAvailable] = useState(false);

  const [records, setRecords] = useSession<AuditRecord[]>("warrant.records.v1", []);
  const [calAll, setCalAll] = useSession<Record<string, CalParams>>("warrant.cal.v1", {});
  const [tamper, setTamper] = useState<{ seq: number; original: AuditRecord } | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => {
        setLlmAvailable(!!j.llmAvailable);
        if (j.mode === "llm") setSensors("llm");
      })
      .catch(() => {});
  }, []);

  const calParams = calAll[packId] ?? NO_CAL;
  const cals = useMemo(() => {
    const out: Record<string, Calibration> = {};
    for (const p of LIST) {
      const params = calAll[p.id] ?? NO_CAL;
      const h = buildHistory(p, params.badWeeks);
      for (const [pr, ok] of params.extra) h.push({ p: pr, correct: ok, decided: "user" });
      out[p.id] = calibrate(h);
    }
    return out;
  }, [calAll]);
  const cal = cals[packId];

  const selectPack = useCallback((id: string) => {
    const p = PACKS[id];
    setPackId(id);
    setVariant("guarded");
    setInputState(p.scenarios[0].input as Input);
    setScenarioId(p.scenarios[0].id);
    setStakeScale(1);
  }, []);

  const pickScenario = useCallback(
    (id: string) => {
      const s = basePack.scenarios.find((x) => x.id === id);
      if (!s) return;
      setInputState(s.input as Input);
      setScenarioId(id);
      setStakeScale(1);
    },
    [basePack],
  );

  const addRecord = useCallback((r: AuditRecord) => setRecords((rs) => [...rs, r]), [setRecords]);
  const tip = records.length ? records[records.length - 1] : null;

  const recordOutcome = (p: number, correct: boolean) => setCalAll((c) => ({ ...c, [packId]: { ...(c[packId] ?? NO_CAL), extra: [...(c[packId]?.extra ?? []), [p, correct] as [number, boolean]] } }));
  const addWeek = () => setCalAll((c) => ({ ...c, [packId]: { ...(c[packId] ?? NO_CAL), badWeeks: Math.min(6, (c[packId]?.badWeeks ?? 0) + 1) } }));
  const resetCal = () => setCalAll((c) => ({ ...c, [packId]: NO_CAL }));

  const doTamper = (seq: number) => {
    const r = records.find((x) => x.seq === seq);
    if (!r || tamper) return;
    setTamper({ seq, original: r });
    setRecords((rs) =>
      rs.map((x) => {
        if (x.seq !== seq) return x;
        const body = JSON.parse(JSON.stringify(x.body));
        if (body.decision) body.decision.outcome = "execute";
        return { ...x, body };
      }),
    );
  };
  const restore = () => {
    if (!tamper) return;
    setRecords((rs) => rs.map((x) => (x.seq === tamper.seq ? tamper.original : x)));
    setTamper(null);
  };

  const openEcho = (v: "guarded" | "naive") => {
    const p = PACKS.refund;
    setPackId("refund");
    setVariant(v);
    const s = p.scenarios.find((x) => x.id === "echo-chamber")!;
    setInputState(s.input as Input);
    setScenarioId(s.id);
    setStakeScale(1);
    setTab("decide");
  };

  return (
    <div className="mx-auto min-h-screen max-w-[1480px] px-4 pb-24 sm:px-6">
      <header className="sticky top-0 z-30 -mx-4 border-b border-line bg-bg/85 px-4 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 py-3">
          <div className="flex items-baseline gap-3">
            <h1 className="font-mono text-lg font-bold tracking-[0.28em]">WARRANT</h1>
            <p className="hidden text-xs text-mute md:block">an AI that has to earn the right to act</p>
          </div>
          <nav className="scroll-thin flex max-w-full gap-1 overflow-x-auto" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className="relative shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors"
                style={{ color: tab === t.id ? "var(--color-ink)" : "var(--color-mute)", background: tab === t.id ? "var(--color-raised)" : "transparent" }}
              >
                {t.label}
                {t.id === "audit" && records.length > 0 && <span className="ml-1.5 rounded bg-line px-1 font-mono text-[10px] text-mute">{records.length}</span>}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 font-mono text-[10px] text-faint">
            {(["execute", "ask", "defer", "escalate", "refuse"] as const).map((o) => (
              <span key={o} className="hidden items-center gap-1 lg:flex" style={{ color: OUTCOME[o].color }}>
                {OUTCOME[o].glyph} {o}
              </span>
            ))}
          </div>
        </div>
        {(tab === "decide" || tab === "autonomy") && (
          <div className="flex flex-wrap items-center gap-2 pb-3">
            {LIST.map((p) => {
              const on = p.id === packId;
              const lv = cals[p.id].autonomy;
              return (
                <button
                  key={p.id}
                  onClick={() => selectPack(p.id)}
                  className="rounded-md border px-3 py-1.5 text-left transition-colors hover:border-faint"
                  style={{ borderColor: on ? "var(--color-ink)" : "var(--color-line)", background: on ? "var(--color-raised)" : "transparent" }}
                >
                  <span className="text-[13px] font-medium">{p.name}</span>
                  <span className="ml-2 font-mono text-[10px]" style={{ color: ["var(--color-refuse)", "var(--color-defer)", "var(--color-ask)", "var(--color-execute)"][lv] }}>L{lv}</span>
                </button>
              );
            })}
            {packId === "refund" && tab === "decide" && (
              <button
                onClick={() => setVariant(variant === "guarded" ? "naive" : "guarded")}
                className="ml-auto rounded-md border px-3 py-1.5 font-mono text-[11px]"
                style={{ borderColor: variant === "guarded" ? "var(--color-line)" : "var(--color-refuse)", color: variant === "guarded" ? "var(--color-mute)" : "var(--color-refuse)" }}
                title="v1 sums every document as independent evidence and has no injection rule"
              >
                provenance guard: <b>{variant === "guarded" ? "ON (v2)" : "OFF (v1 naive)"}</b>
              </button>
            )}
          </div>
        )}
      </header>

      <main className="pt-5">
        {tab === "decide" && (
          <>
            <p className="mb-5 max-w-3xl text-sm leading-relaxed text-mute">
              <b className="text-ink">{pack.name}.</b> {pack.tagline} Pick a scenario, edit the case, and watch the engine price <i>execute · ask · defer · escalate · refuse</i>. Only “execute” earns a signed warrant.
            </p>
            <Console
              pack={pack}
              packId={packId}
              variant={variant}
              input={input}
              setInput={(fn) => setInputState((c) => fn(c))}
              scenarioId={scenarioId}
              pickScenario={pickScenario}
              stakeScale={stakeScale}
              setStakeScale={setStakeScale}
              autonomy={cal.autonomy}
              cal={cal}
              calParams={calParams}
              sensors={sensors}
              setSensors={setSensors}
              llmAvailable={llmAvailable}
              tip={tip}
              addRecord={addRecord}
              recordOutcome={recordOutcome}
              goAutonomy={() => setTab("autonomy")}
            />
          </>
        )}
        {tab === "audit" && (
          <AuditTab
            records={records}
            clear={() => {
              setRecords([]);
              setTamper(null);
            }}
            tamper={doTamper}
            tamperedSeq={tamper?.seq ?? null}
            restore={restore}
            pack={pack}
          />
        )}
        {tab === "autonomy" && (
          <AutonomyTab pack={pack} packs={LIST} cals={cals} cal={cal} badWeeks={calParams.badWeeks} extraCount={calParams.extra.length} addWeek={addWeek} reset={resetCal} />
        )}
        {tab === "failure" && <FailureTab openInConsole={openEcho} />}
        {tab === "about" && <AboutTab />}
      </main>

      <footer className="mt-16 border-t border-line pt-6 font-mono text-[11px] text-faint">
        WARRANT · deterministic decision core · {LIST.length} domains · hash-chained audit · built for The Decision Engine challenge
      </footer>
    </div>
  );
}
