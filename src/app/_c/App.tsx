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
import { Seal, Star, TabHero, Tape, useSession } from "./shared";

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
    <div className="grid w-fit grid-cols-2 gap-[1.5px] border-[1.5px] border-ink bg-ink shadow-[4px_4px_0_var(--color-ink)] sm:flex" role="tablist" aria-label="Domain">
      {LIST.map((p) => {
        const on = p.id === packId;
        const lv = cals[p.id].autonomy;
        return (
          <button
            key={p.id}
            role="tab"
            aria-selected={on}
            onClick={() => selectPack(p.id)}
            className={`whitespace-nowrap px-4 py-2.5 text-left text-[14px] font-semibold transition-colors duration-200 ${on ? "bg-sun text-ink" : "bg-panel text-ink hover:bg-raised"}`}
          >
            {SHORT[p.id] ?? p.name}
            <span className={`ml-2 px-1 font-mono text-[10px] ${on ? "bg-ink text-sun" : "text-mute"}`} title={`Autonomy level ${lv}`}>
              L{lv}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-[100dvh]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-sun focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b-2 border-ink bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-[68px] max-w-[1400px] items-center gap-6 px-4 sm:px-8">
          <button onClick={() => setTab("decide")} className="group flex shrink-0 items-center gap-2" aria-label="WARRANT home">
            <Star className="spin h-6 w-6 text-pink [filter:drop-shadow(1.5px_1.5px_0_var(--color-ink))]" />
            <span className="display text-[32px] leading-none transition-[font-variation-settings] duration-500 group-hover:[font-variation-settings:'wdth'_100,'opsz'_96]">Warrant</span>
          </button>
          <nav className="scroll-thin flex h-full min-w-0 items-center gap-4 overflow-x-auto sm:ml-4 sm:gap-6" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`hl shrink-0 whitespace-nowrap px-0.5 text-[15px] font-semibold transition-colors ${tab === t.id ? "text-ink" : "text-mute hover:text-ink"}`}
              >
                {t.label}
                {t.id === "audit" && records.length > 0 && <sup className="ml-0.5 font-mono text-[10px] text-refuse">{records.length}</sup>}
              </button>
            ))}
          </nav>
          <div className="ml-auto hidden shrink-0 items-center gap-5 md:flex">
            <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
              <i className="blink inline-block h-2 w-2 bg-refuse" />
              live · {sensors === "llm" ? "llm sensors" : "offline sensors"}
            </span>
            <a href={REPO} target="_blank" rel="noreferrer" className="press border-[1.5px] border-ink bg-panel px-3 py-1.5 text-[13px] font-semibold hover:bg-sun">
              Source ↗
            </a>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-[1400px] px-4 pb-24 pt-10 sm:px-8">
        <div key={tab}>
        {tab === "decide" && (
          <>
            <section className="relative pb-4">
              <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  <p className="label mb-5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="bg-ink px-1.5 py-0.5 text-sun">Vol. 01</span>
                    <span>A decision layer for AI agents</span>
                    <span className="hidden sm:inline">· {records.length} sealed record{records.length === 1 ? "" : "s"}</span>
                  </p>
                  <h1 className="display text-[clamp(72px,14vw,212px)]">
                    <span className="line-mask">
                      <span className="line-up">
                        <span className="overprint squash" data-text="No warrant,">
                          No warrant,
                        </span>
                      </span>
                    </span>
                    <span className="line-mask">
                      <span className="line-up" style={{ ["--i" as string]: 1 }}>
                        <span className="overprint ink squash" data-text="No">
                          No
                        </span>{" "}
                        <span className="serif-i text-[1.08em] text-refuse">action.</span>
                      </span>
                    </span>
                  </h1>
                </div>
                <div className="hidden flex-col items-center gap-3 pt-6 lg:flex">
                  <div className="wobble">
                    <Seal size={210} center={<span className="display text-[86px] leading-none">W</span>} />
                  </div>
                  <span className="label max-w-[22ch] text-center">Only <b className="text-blue">execute</b> earns a seal. Everything else is a stay.</span>
                </div>
              </div>

              <div className="mt-10 grid items-end gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
                <p className="rise max-w-[54ch] text-[18px] leading-relaxed text-ink/85 [animation-delay:350ms]">
                  An AI agent proposes an action. WARRANT prices five possible responses and <mark>signs only the one it can defend</mark>. Tools refuse anything unsigned.
                </p>
                <div className="rise space-y-3 [animation-delay:450ms] lg:justify-self-end">
                  <p className="label">Pick a domain</p>
                  {domainSwitch}
                  {packId === "refund" && (
                    <button
                      onClick={() => setVariant(variant === "guarded" ? "naive" : "guarded")}
                      className={`press flex w-full items-center justify-between gap-3 border-[1.5px] border-ink px-3 py-2 text-left font-mono text-[11.5px] ${variant === "guarded" ? "bg-panel text-ink" : "bg-pink text-ink"}`}
                      title="v1 counts every attached document as independent evidence and has no injection rule"
                    >
                      <span>
                        Provenance guard: <b>{variant === "guarded" ? "ON · v2" : "OFF · v1, naive"}</b>
                      </span>
                      <span aria-hidden className={`relative inline-block h-4 w-8 border-[1.5px] border-ink ${variant === "guarded" ? "bg-blue" : "bg-panel"}`}>
                        <span className={`absolute top-[1px] h-2.5 w-2.5 bg-ink transition-[left] duration-300 ${variant === "guarded" ? "left-[15px] bg-panel" : "left-[1px]"}`} />
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </section>

            <div className="relative left-1/2 my-12 h-[150px] w-[100vw] -translate-x-1/2 sm:h-[170px]" aria-hidden>
              <div className="absolute left-[-5%] top-[30px] w-[110%] -rotate-[2.5deg]">
                <Tape items={["No warrant, no action", "Priced in regret", "Signed, sealed, single-use", "The model proposes, code authorises", "Autonomy is earned"]} tone="pink" />
              </div>
              <div className="absolute left-[-5%] top-[78px] w-[110%] rotate-[2deg] sm:top-[86px]">
                <Tape items={["Execute", "Ask", "Defer", "Escalate", "Refuse", "Execute", "Ask", "Defer", "Escalate", "Refuse"]} tone="blue" reverse dur={30} />
              </div>
            </div>

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
          <>
          <TabHero kicker="The ledger" title="On record." accent="go on, tamper.">
            Every decision and every tool call, refused ones included, is hash-chained and sealed by the server. Edit one byte and the chain snaps at that record.
          </TabHero>
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
          </>
        )}
        {tab === "autonomy" && (
          <>
            <TabHero kicker="Earned autonomy" title="Trust is" accent="a credit score.">
              The engine keeps score of every confidence it ever stated. When “90% sure” stops coming true, it demotes itself, all the way down to shadow mode.
            </TabHero>
            <div className="mb-8">{domainSwitch}</div>
            <AutonomyTab pack={pack} packs={LIST} cals={cals} cal={cal} badWeeks={calParams.badWeeks} extraCount={calParams.extra.length} addWeek={addWeek} reset={resetCal} />
          </>
        )}
        {tab === "failure" && (
          <>
            <TabHero kicker="Deliberate failure test" title="We broke it" accent="on purpose.">
              High confidence built from one poisoned source. v1 approved it at 99%. Here is what changed, and what still gets through.
            </TabHero>
            <FailureTab openInConsole={openEcho} />
          </>
        )}
        {tab === "about" && (
          <>
            <TabHero kicker="How it works" title="Allowed?" accent="not just able.">
              The layer between a proposed action and the world. The model proposes. Deterministic code decides. Only a warrant opens the tool.
            </TabHero>
            <AboutTab />
          </>
        )}
        </div>
      </main>

      <Tape items={["Simulated actuators", "Synthetic data", "Real signatures", "No warrant, no action"]} tone="sun" dur={45} />
      <footer className="overflow-hidden bg-ink text-panel">
        <div className="mx-auto max-w-[1400px] px-4 pt-10 sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <p className="max-w-[46ch] text-[15px] leading-relaxed text-panel/75">
              A deterministic decision core with signed warrants and a hash-chained audit trail. <span className="serif-i text-[1.15em] text-sun">Ask a human is a feature.</span>
            </p>
            <a href={REPO} target="_blank" rel="noreferrer" className="press border-[1.5px] border-panel bg-sun px-4 py-2 text-[14px] font-bold text-ink hover:bg-pink" style={{ boxShadow: "4px 4px 0 var(--color-panel)" }}>
              Source on GitHub ↗
            </a>
          </div>
          <p className="display outline-fill mt-6 select-none whitespace-nowrap text-[23vw] leading-[0.78] [-webkit-text-stroke-color:var(--color-panel)] [background-image:linear-gradient(var(--color-pink),var(--color-pink))] xl:text-[330px]" aria-hidden>
            Warrant
          </p>
        </div>
      </footer>
    </div>
  );
}
