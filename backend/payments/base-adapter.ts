import {
  type BaseEscrowConfig,
  verifyPayment,
  verifyReserve,
} from "../../contracts/evm/adapter";
import type { D1Database } from "../trace/cloudflare-persistence";
import type { PaymentChainAdapter } from "./ledger";
/** Deployment configuration must come from the reviewed project manifest. */
export function basePaymentAdapter(
  db: D1Database,
  config: BaseEscrowConfig & { projectId: string; network: string },
): PaymentChainAdapter {
  return {
    async verifyFinalized(input) {
      const result = await (input.kind === "reserved"
        ? verifyReserve
        : verifyPayment)(
        config,
        input.transactionId,
        input.eventIndex,
        input.obligationId,
      );
      let sourceDigest = result.sourceDigest?.replace(/^0x/, "");
      if (input.kind === "paid") {
        const obligation = await db
          .prepare(
            "SELECT source_digest FROM payment_obligations WHERE id=? AND network=? AND vault=?",
          )
          .bind(result.obligationId, config.network, config.vault)
          .first<{ source_digest: string }>();
        if (!obligation)
          throw new Error("Reservation must be indexed before payout");
        sourceDigest = obligation.source_digest;
      }
      if (!sourceDigest) throw new Error("Missing immutable allocation source");
      return {
        ...result,
        kind: input.kind,
        sourceDigest,
        projectId: config.projectId,
        network: config.network,
        chain: "base",
        vault: config.vault,
      };
    },
  };
}
