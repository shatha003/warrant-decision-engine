import { describe, expect, it } from "vitest";
import { decide } from "@/core/decide";
import { mapContext, outcomeAt } from "@/core/map";
import { PACKS } from "@/domains";
import { rng } from "@/domains/util";

describe("decision map agrees with the decision engine at the case's own coordinates", () => {
  for (const pack of Object.values(PACKS)) {
    it(`${pack.id}: scenarios + 150 random cases`, () => {
      const r = rng(77);
      const cases = [...pack.scenarios.map((s) => s.input), ...Array.from({ length: 150 }, () => pack.generate(r))];
      for (const input of cases) {
        for (const autonomy of [3, 1, 0] as const) {
          const state = { autonomy };
          const d = decide(pack, input, { state, skipFlips: true });
          const signals = [...pack.extract(input)];
          const ctx = mapContext(pack, input, signals, pack.exposure(input), state);
          const at = outcomeAt(pack, ctx, state, d.confidence.mid, 1);
          // d.outcome additionally reflects the conflict term baked into belief; map must still agree on the verdict
          expect(at).toBe(d.outcome);
        }
      }
    });
  }
});
