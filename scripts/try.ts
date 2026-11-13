import { decide } from "../src/core/decide";
import { PACKS, naiveRefundPack } from "../src/domains";
let bad = 0;
for (const pack of [...Object.values(PACKS)]) {
  console.log(`\n== ${pack.name}`);
  for (const sc of pack.scenarios) {
    const d = decide(pack, sc.input);
    const t = Object.entries(d.lossTable).map(([k, v]: any) => `${k.slice(0,3)}:${v === null ? "-" : Math.round(v as number)}`).join(" ");
    const ok = !sc.expected || sc.expected === d.outcome;
    if (!ok) bad++;
    console.log(`${ok ? "ok " : "BAD"} ${d.outcome.toUpperCase().padEnd(8)} exp=${(sc.expected ?? "").padEnd(8)} ${sc.id.padEnd(16)} p=${d.confidence.mid.toFixed(2)} eff=${d.confidence.effective.toFixed(2)} [${t}] flips=${d.flips.length}`);
  }
}
console.log(bad ? `\n${bad} mismatches` : "\nall scenarios match");
