import { PACKS } from "../src/domains";
import { buildHistory, calibrate } from "../src/ledger/calibration";
for (const p of Object.values(PACKS)) {
  for (const w of [0, 1, 2, 3]) {
    const c = calibrate(buildHistory(p, w));
    console.log(p.id.padEnd(11), "weeks", w, "n", c.n, "brier", c.brier.toFixed(3), "ece", c.ece.toFixed(3), "L" + c.autonomy, `exec ${c.executeCount} wrong ${c.executeWrong}`);
  }
}
