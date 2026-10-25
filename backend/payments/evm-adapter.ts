import {
  type EvmEscrowConfig,
  verifyPayment,
  verifyReserve,
} from "../../contracts/evm/adapter";
import type { PaymentChain } from "../../src/lib/payments/contracts";
import type { D1TransactionalDatabase as D1Database } from "../d1";
import type { PaymentChainAdapter } from "./ledger";
/** Deployment configuration must come from the reviewed project manifest, including its chain. */
export function evmPaymentAdapter(
  db: D1Database,
  config: EvmEscrowConfig & {
    projectId: string;
    network: string;
    chain: PaymentChain;
  },
): PaymentChainAdapter {
  return {
    deployment: {
      projectId: config.projectId,
      network: config.network,
      vault: config.vault,
    },
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
        chain: config.chain,
        vault: config.vault,
      };
    },
  };
}
