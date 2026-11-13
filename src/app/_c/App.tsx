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
import { useSession } from "./shared";

type Tab = "decide" | "audit" | "autonomy" | "failure" | "about";
type CalParams = { badWeeks: number; extra: [number, boolean][] };
const NO_CAL: CalParams = { badWeeks: 0, extra: [] };
const LIST = Object.values(PACKS);
const REPO = "https://github.com/shatha003/warrant-decision-engine";
const SHORT: Record<string, string> = { refund: "Refunds", deploy: "Deploys", moderation: "Moderation", shell: "Agent shell" };

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
    window.scrollTo({ top: 0 });
  };

  const domainSwitch = (
    <div className="grid w-fit grid-cols-2 gap-px border border-ink bg-ink sm:flex" role="tablist" aria-label="Domain">
      {LIST.map((p) => {
        const on = p.id === packId;
        const lv = cals[p.id].autonomy;
        return (
          <button
            key={p.id}
            role="tab"
            aria-selected={on}
            onClick={() => selectPack(p.id)}
            className="whitespace-nowrap px-3.5 py-2 text-left text-[13px] transition-colors"
            style={{ background: on ? "var(--color-ink)" : "var(--color-panel)", color: on ? "var(--color-panel)" : "var(--color-ink)" }}
          >
            {SHORT[p.id] ?? p.name}
            <span className="ml-2 font-mono text-[10px] opacity-70" title={`Autonomy level ${lv}`}>
              L{lv}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-[100dvh]">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-4 sm:px-8">
          <button onClick={() => setTab("decide")} className="flex shrink-0 items-center gap-2.5" aria-label="WARRANT home">
            <span aria-hidden className="relative inline-block h-[18px] w-[18px] border-2 border-ink">
              <span className="absolute inset-[3px] bg-execute" />
            </span>
            <span className="text-[15px] font-semibold tracking-[0.22em]">WARRANT</span>
          </button>
          <nav className="scroll-thin flex h-full min-w-0 gap-5 overflow-x-auto sm:ml-6" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className="shrink-0 whitespace-nowrap border-b-2 pt-0.5 text-[13.5px] transition-colors"
                style={{ borderColor: tab === t.id ? "var(--color-ink)" : "transparent", color: tab === t.id ? "var(--color-ink)" : "var(--color-mute)" }}
              >
                {t.label}
                {t.id === "audit" && records.length > 0 && <span className="ml-1.5 font-mono text-[10.5px] text-mute">{records.length}</span>}
              </button>
            ))}
          </nav>
          <a href={REPO} target="_blank" rel="noreferrer" className="ml-auto hidden shrink-0 text-[13px] text-mute underline-offset-4 hover:text-ink hover:underline md:block">
            Source
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 pb-24 pt-10 sm:px-8">
        {tab === "decide" && (
          <>
            <section className="mb-10 grid items-end gap-6 border-b border-ink pb-8 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <h1 className="text-[42px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-[56px]">No warrant, no action.</h1>
                <p className="mt-4 max-w-[56ch] text-[15.5px] leading-relaxed text-mute">
                  An AI agent proposes an action. WARRANT prices five possible responses and signs only the one it can defend. Tools refuse anything unsigned.
                </p>
              </div>
              <div className="space-y-2.5 lg:justify-self-end">
                {domainSwitch}
                {packId === "refund" && (
                  <button
                    onClick={() => setVariant(variant === "guarded" ? "naive" : "guarded")}
                    className="block w-full border px-3 py-1.5 text-left font-mono text-[11px] transition-colors lg:text-right"
                    style={{ borderColor: variant === "guarded" ? "var(--color-line)" : "var(--color-refuse)", color: variant === "guarded" ? "var(--color-mute)" : "var(--color-refuse)" }}
                    title="v1 counts every attached document as independent evidence and has no injection rule"
                  >
                    Provenance guard: <b>{variant === "guarded" ? "on (v2)" : "off (v1, naive)"}</b>
                  </button>
                )}
              </div>
            </section>
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
          <>
            <div className="mb-6">{domainSwitch}</div>
            <AutonomyTab pack={pack} packs={LIST} cals={cals} cal={cal} badWeeks={calParams.badWeeks} extraCount={calParams.extra.length} addWeek={addWeek} reset={resetCal} />
          </>
        )}
        {tab === "failure" && <FailureTab openInConsole={openEcho} />}
        {tab === "about" && <AboutTab />}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-[12.5px] text-mute sm:px-8">
          <span>WARRANT. A deterministic decision core with signed warrants and a hash-chained audit trail.</span>
          <a href={REPO} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-ink">
            Source on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
