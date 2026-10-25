/**
 * PRD section 21 escrow acceptance runner (issue #902).
 *
 *   bun scripts/escrow-acceptance.ts <network> <evidence-directory> [--suite extended]
 *
 * Networks: base-sepolia, ethereum-sepolia, robinhood-testnet, solana-devnet,
 * and solana-localnet (loopback validator only). Mainnet chain ids and the
 * Solana mainnet genesis are refused before any key signs. RPC URLs, contract
 * addresses and test keys come from environment variables; see
 * docs/escrow-acceptance-runbook.md. The run is resumable: it saves every
 * signed transaction before broadcast, and exits with code 75 while it waits
 * for a binding delay or finality. Rerun the same command to continue.
 * `--suite extended` runs the #902 scenarios that section 21 does not cover
 * (private bounty, monthly commitment, walletless lifecycle, interrupted send,
 * failed recipient, frozen fee destination) in a separate evidence directory.
 */
import { resolve } from "node:path";
import { runEvm } from "./escrow-acceptance/evm";
import { runEvmExtended } from "./escrow-acceptance/evm-extended";
import {
  type Evidence,
  evidencePath,
  isAcceptanceNetwork,
  SUITES,
  type Suite,
  WAITING_EXIT_CODE,
} from "./escrow-acceptance/shared";

const [network, directory, flag, suiteName] = process.argv.slice(2);
const suite = (flag === "--suite" ? suiteName : "section-21") as Suite;
if (
  !network ||
  !directory ||
  !isAcceptanceNetwork(network) ||
  (flag !== undefined && flag !== "--suite") ||
  !SUITES.includes(suite)
) {
  console.error(
    "Usage: bun scripts/escrow-acceptance.ts <base-sepolia|ethereum-sepolia|robinhood-testnet|solana-devnet|solana-localnet> <evidence-directory> [--suite section-21|extended]",
  );
  process.exit(2);
}
const out = resolve(directory);
// The Solana legs need the program's SPL dependencies from contracts/solana.
const solanaLeg =
  suite === "extended"
    ? "../contracts/solana/scripts/acceptance-extended.ts"
    : "../contracts/solana/scripts/acceptance.ts";
type SolanaLeg = (network: string, directory: string) => Promise<Evidence>;
const evidence: Evidence = network.startsWith("solana-")
  ? await (
      (await import(solanaLeg)) as {
        runSolana: SolanaLeg;
        runSolanaExtended: SolanaLeg;
      }
    )[suite === "extended" ? "runSolanaExtended" : "runSolana"](network, out)
  : suite === "extended"
    ? await runEvmExtended(network, out)
    : await runEvm(network, out);
console.log(
  JSON.stringify(
    {
      network: evidence.network,
      suite: evidence.suite,
      status: evidence.status,
      waiting: evidence.waiting,
      assets: evidence.assets.map((asset) => ({
        address: asset.address,
        decimals: asset.decimals,
        status: asset.status,
      })),
      scenarios: Object.fromEntries(
        Object.entries(evidence.scenarios ?? {}).map(([name, entry]) => [
          name,
          entry.reason ? `${entry.status}: ${entry.reason}` : entry.status,
        ]),
      ),
      deviations: evidence.deviations,
      errors: evidence.errors,
      evidence: evidencePath(out),
    },
    null,
    2,
  ),
);
process.exit(
  evidence.status === "passed"
    ? 0
    : evidence.status === "waiting"
      ? WAITING_EXIT_CODE
      : 1,
);
