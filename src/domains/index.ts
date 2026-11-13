import type { Pack } from "@/core/types";
import { makeRefundPack, type RefundVariant } from "./refund";
import { deployPack } from "./deploy";
import { moderationPack } from "./moderation";
import { shellPack } from "./shell";

export const refundPack = makeRefundPack("guarded");
export const naiveRefundPack = makeRefundPack("naive");

/** Add a domain = write one Pack and list it here. */
export const PACKS: Record<string, Pack<any>> = {
  refund: refundPack,
  deploy: deployPack,
  moderation: moderationPack,
  shell: shellPack,
};

export function getPack(id: string, variant?: RefundVariant): Pack<any> | undefined {
  if (id === "refund" && variant === "naive") return naiveRefundPack;
  return PACKS[id];
}

export { makeRefundPack, deployPack, moderationPack, shellPack };
