/**
 * Read-only Base USDC payout verifier. It queries the fixed public RPC
 * authorities, requires two to agree on canonical inclusion, and proves the
 * exact source debit and recipient credits of one confirmed transaction. It
 * never reads a key, signs, broadcasts, or writes a cycle record.
 */

import { isEvmTransactionHash } from "../src/lib/evm-funding";
import {
  assertConfirmedUsdcSettlementTransfer,
  EVM_SETTLEMENT_VERIFIER_VERSION,
  type EvmSettlementNetwork,
  type ExpectedEvmTransfer,
  isEvmSettlementNetwork,
  MAX_EVM_SETTLEMENT_TRANSFERS,
} from "../src/lib/evm-settlement";
import { isFundingAddress } from "../src/lib/funding-address.mjs";
import {
  EVM_FUNDING_RPC_AUTHORITIES,
  type EvmAuthorityVerification,
  type FetchLike,
  fetchEvmReceiptContext,
  requireEvmRpcQuorum,
} from "./verify-funding-evm";

const USAGE =
  "Usage: verify-settlement-evm.ts --network base --transaction <0x-hash> --source <0x-address> --transfers <0x-recipient:amount-minor[,...]>";

const CLI_ARGUMENTS = new Set([
  "--network",
  "--transaction",
  "--source",
  "--transfers",
]);

export function parseEvmSettlementArguments(argv: readonly string[]) {
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !name ||
      !CLI_ARGUMENTS.has(name) ||
      !value ||
      value.startsWith("--") ||
      parsed.has(name)
    ) {
      throw new TypeError(USAGE);
    }
    parsed.set(name, value);
  }
  return {
    network: parsed.get("--network") ?? null,
    transactionHash: parsed.get("--transaction") ?? null,
    source: parsed.get("--source") ?? null,
    transfers: parsed.get("--transfers") ?? null,
  };
}

/** Parses `recipient:amountMinor` pairs; repeated recipients stay separate. */
export function parseEvmSettlementTransfers(
  value: string,
): ExpectedEvmTransfer[] {
  const entries = value.split(",");
  if (entries.length > MAX_EVM_SETTLEMENT_TRANSFERS) {
    throw new TypeError(
      `--transfers accepts at most ${MAX_EVM_SETTLEMENT_TRANSFERS} entries`,
    );
  }
  return entries.map((entry, index) => {
    const match = /^(0x[0-9a-f]{40}):([1-9]\d{0,39})$/u.exec(entry);
    if (!match) {
      throw new TypeError(
        `--transfers entry ${index} is not <lowercase-0x-address>:<integer>`,
      );
    }
    return { recipient: match[1], amountMinor: match[2] };
  });
}

async function verifyWithAuthority(
  input: {
    network: EvmSettlementNetwork;
    source: string;
    transactionHash: string;
    transfers: readonly ExpectedEvmTransfer[];
  },
  authority: string,
  authorityIndex: number,
  fetchImpl: FetchLike,
): Promise<EvmAuthorityVerification> {
  const context = await fetchEvmReceiptContext(
    input,
    authority,
    authorityIndex,
    fetchImpl,
    "slop-settlement",
  );
  const verified = assertConfirmedUsdcSettlementTransfer(
    context.receipt,
    input.network,
    input.transactionHash,
    input.source,
    input.transfers,
    context.finalizedBlock,
    context.receiptBlock,
  );
  return {
    authority: context.authority,
    finalizedBlock: context.finalizedBlock,
    verified: { ...verified, blockTime: context.blockTime },
  };
}

export async function verifySettlementEvm(input: {
  fetchImpl?: FetchLike;
  network: EvmSettlementNetwork;
  source: string;
  transactionHash: string;
  transfers: readonly ExpectedEvmTransfer[];
}) {
  if (
    !isEvmSettlementNetwork(input.network) ||
    !isEvmTransactionHash(input.transactionHash) ||
    !isFundingAddress(input.network, input.source)
  ) {
    throw new TypeError("network, transaction hash, or source is invalid");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const settled = await Promise.allSettled(
    EVM_FUNDING_RPC_AUTHORITIES[input.network].map((authority, index) =>
      verifyWithAuthority(input, authority, index, fetchImpl),
    ),
  );
  let results: EvmAuthorityVerification[];
  try {
    results = requireEvmRpcQuorum(settled);
  } catch (error) {
    // Surface why authorities refused; a bare quorum failure hides a mismatch.
    const reasons = new Set(
      settled.flatMap((result) =>
        result.status === "rejected" && result.reason instanceof Error
          ? [result.reason.message]
          : [],
      ),
    );
    throw new TypeError(
      `${error instanceof Error ? error.message : "quorum failed"}${reasons.size > 0 ? `: ${[...reasons].join("; ")}` : ""}`,
      { cause: error },
    );
  }
  const first = results[0];
  const confirmations = Math.min(
    ...results.map(({ verified }) => verified.confirmations),
  );
  return {
    state: "verified-on-chain" as const,
    finality: { kind: "confirmations" as const, confirmations },
    verifier: {
      version: EVM_SETTLEMENT_VERIFIER_VERSION,
      checkedAt: new Date().toISOString(),
      evidenceUrl: `https://basescan.org/tx/${input.transactionHash}`,
    },
    settlement: {
      network: input.network,
      source: input.source,
      transfers: input.transfers.map(({ recipient, amountMinor }) => ({
        recipient,
        amountMinor,
      })),
      totalMinor: input.transfers
        .reduce((total, transfer) => total + BigInt(transfer.amountMinor), 0n)
        .toString(),
    },
    chainEvidence: {
      ...first.verified,
      confirmations,
      authorities: results.map(({ authority, finalizedBlock }) => ({
        authority,
        finalizedBlockHash: finalizedBlock.hash,
        finalizedBlockNumber: Number(finalizedBlock.number),
      })),
    },
  };
}

if (import.meta.main) {
  try {
    const { network, transactionHash, source, transfers } =
      parseEvmSettlementArguments(process.argv.slice(2));
    if (
      !network ||
      !isEvmSettlementNetwork(network) ||
      !transactionHash ||
      !source ||
      !transfers
    ) {
      throw new TypeError(USAGE);
    }
    process.stdout.write(
      `${JSON.stringify(
        await verifySettlementEvm({
          network,
          transactionHash,
          source,
          transfers: parseEvmSettlementTransfers(transfers),
        }),
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    // error-policy:J1 command boundary exposes a non-zero, actionable failure.
    process.stderr.write(
      `[Slop] Base settlement verification refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
