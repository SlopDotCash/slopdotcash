import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256Hex } from "../../src/lib/sha256";
import {
  PROJECT_DISCRIMINATOR,
  PROJECT_SIZE,
  type SolanaEscrowConfig,
  type SolanaMonthlyEntry,
  solanaAccount,
  solanaAllocationRoot,
  solanaAllocationTotal,
  solanaAuthorityRotation,
  solanaDigest,
  solanaPubkey,
  solanaRpc,
  solanaUint,
  verifySolanaDeployment,
} from "./adapter";
import {
  bytes,
  concat,
  encoder,
  type Instruction,
  instructionData,
  le,
  pda,
} from "./transactions";
import { prepareSolanaWalletTransaction } from "./wallet-transactions";

const hex = (value: Uint8Array) =>
  Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("");

/** Evidence only: no signature, instruction or transaction is produced. Missing data and
 * other fault classes do not prove that an admitted recipient can never settle. */
export async function inspectSolanaMonthlyWrongSum(
  config: SolanaEscrowConfig,
  period: string,
  capture: { entries: readonly SolanaMonthlyEntry[] } | null,
) {
  if (!/^([2-9][0-9]{3})-(0[1-9]|1[0-2])$/.test(period))
    throw new Error("Invalid monthly period");
  if (!capture)
    return { status: "held", reason: "allocation-unavailable" } as const;
  const entries = capture.entries.map(
    ({ githubUserId, grossMicro, sourceDigest }) => ({
      githubUserId,
      grossMicro,
      sourceDigest,
    }),
  );
  const root = solanaAllocationRoot(entries);
  const total = solanaAllocationTotal(entries);
  const periodNumber = Number(period.replace("-", ""));
  const periodBytes = new Uint8Array(4);
  new DataView(periodBytes.buffer).setUint32(0, periodNumber, true);
  const monthAddress = pda(config.programId, [
    encoder.encode("month"),
    bytes(config.projectPda),
    periodBytes,
  ]);
  async function snapshot(minContextSlot?: number) {
    const result = (await solanaRpc(config, "getMultipleAccounts", [
      [config.projectPda, monthAddress],
      { commitment: "finalized", encoding: "base64", minContextSlot },
    ])) as { context?: { slot?: number }; value?: unknown[] };
    const slot = result?.context?.slot;
    if (
      !Number.isSafeInteger(slot) ||
      slot === undefined ||
      slot <= 0 ||
      slot < (minContextSlot ?? 0) ||
      !Array.isArray(result.value) ||
      result.value.length !== 2
    )
      throw new Error("Invalid finalized monthly snapshot");
    return {
      slot,
      project: solanaAccount(
        result.value[0],
        config.programId,
        PROJECT_SIZE,
        PROJECT_DISCRIMINATOR,
      ),
      month: solanaAccount(
        result.value[1],
        config.programId,
        109,
        "1170c1902bd6fc6b",
      ),
    };
  }
  const state = await snapshot();
  const month = new DataView(
    state.month.buffer,
    state.month.byteOffset,
    state.month.byteLength,
  );
  if (
    solanaPubkey(state.month, 8) !== config.projectPda ||
    month.getUint32(40, true) !== periodNumber ||
    state.month[108] > 1
  )
    throw new Error("Monthly account identity mismatch");
  if (hex(state.month.slice(44, 76)) !== root)
    return { status: "held", reason: "allocation-mismatch" } as const;
  const storedTotal = solanaUint(state.month, 84);
  if (storedTotal === BigInt(total))
    return { status: "held", reason: "no-wrong-sum-fault" } as const;
  if (
    storedTotal === 0n ||
    solanaUint(state.month, 76) !== 0n ||
    solanaUint(state.month, 92) !== 0n ||
    state.month[108] !== 0
  )
    return { status: "held", reason: "prior-reserve-transition" } as const;
  async function blockHash() {
    const block = (await solanaRpc(config, "getBlock", [
      state.slot,
      { commitment: "finalized", transactionDetails: "none", rewards: false },
    ])) as { blockhash?: string } | null;
    if (
      typeof block?.blockhash !== "string" ||
      bytes(block.blockhash).length !== 32
    )
      throw new Error("Finalized monthly block unavailable");
    return block.blockhash;
  }
  const blockhash = await blockHash();
  // The program's last upgrade must precede the snapshot. Current deployment verification
  // also binds Config and project roles; the verified project must equal the batched state.
  const verified = await verifySolanaDeployment({
    ...config,
    executedAtSlot: state.slot,
  });
  const latest = await snapshot(state.slot);
  if (
    hex(verified) !== hex(state.project) ||
    hex(latest.project) !== hex(state.project) ||
    hex(latest.month) !== hex(state.month) ||
    (await blockHash()) !== blockhash
  )
    throw new Error("Finalized monthly evidence changed");
  return {
    status: "provably-unsettleable" as const,
    fault: "authenticated-sum-mismatch" as const,
    genesisHash: config.genesisHash,
    programId: config.programId,
    projectPda: config.projectPda,
    monthAddress,
    owner: config.owner,
    mint: config.mint,
    identityAuthority: solanaAuthorityRotation(state.project).identityAuthority,
    codeSha256: config.codeSha256,
    upgradeAuthority: config.upgradeAuthority,
    period,
    slot: state.slot,
    blockhash,
    allocationRoot: root,
    entriesSha256: sha256Hex(JSON.stringify(entries)),
    // Solana stores neither count nor allocation digest; count describes the retained tree.
    retainedCount: entries.length,
    computedTotal: total,
    storedTotal: storedTotal.toString(),
    frozenAt: month.getBigInt64(100, true).toString(),
    expectedUnsettled: storedTotal.toString(),
    releasedGross: storedTotal.toString(),
  };
}

/** Fresh evidence and an existing authority attestation produce only an unsigned owner plan.
 * No caller-selected amount, private key, signing method or broadcast path is accepted. */
export async function prepareSolanaMonthlyWrongSumRelease(
  config: SolanaEscrowConfig,
  period: string,
  capture: { entries: readonly SolanaMonthlyEntry[] } | null,
  attestation: string,
) {
  const evidence = await inspectSolanaMonthlyWrongSum(config, period, capture);
  if (evidence.status !== "provably-unsettleable")
    throw new Error(`Monthly release held: ${evidence.reason}`);
  if (!/^[0-9a-f]{128}$/i.test(attestation))
    throw new Error("Invalid monthly release attestation");
  const signature = Uint8Array.from(attestation.match(/../g) ?? [], (value) =>
    Number.parseInt(value, 16),
  );
  const periodBytes = new Uint8Array(4);
  new DataView(periodBytes.buffer).setUint32(
    0,
    Number(period.replace("-", "")),
    true,
  );
  const signed = concat(
    encoder.encode("slop-monthly-release-v1"),
    bytes(config.programId),
    bytes(config.projectPda),
    periodBytes,
    solanaDigest(evidence.allocationRoot),
    le(BigInt(evidence.storedTotal)),
    le(BigInt(evidence.expectedUnsettled)),
    le(BigInt(evidence.releasedGross)),
    solanaDigest(config.networkDomain),
  );
  if (
    !ed25519.verify(signature, signed, bytes(evidence.identityAuthority), {
      zip215: false,
    })
  )
    throw new Error("Monthly release authority mismatch");
  // Reuse the existing native Ed25519 layout: key at16, signature at48, message at112.
  const offsets = new Uint8Array(16);
  offsets[0] = 1;
  const view = new DataView(offsets.buffer);
  [48, 65535, 16, 65535, 112, signed.length, 65535].forEach((value, index) => {
    view.setUint16(2 + index * 2, value, true);
  });
  const instructions: Instruction[] = [
    {
      program: "Ed25519SigVerify111111111111111111111111111",
      accounts: [],
      data: concat(
        offsets,
        bytes(evidence.identityAuthority),
        signature,
        signed,
      ),
    },
    {
      program: config.programId,
      accounts: [
        { key: evidence.owner, write: false },
        { key: config.projectPda, write: true },
        { key: evidence.monthAddress, write: true },
        { key: "Sysvar1nstructions1111111111111111111111111", write: false },
      ],
      data: instructionData(
        "release_monthly_reserve",
        periodBytes,
        le(BigInt(evidence.expectedUnsettled)),
        le(BigInt(evidence.releasedGross)),
      ),
    },
  ];
  // Existing wallet preparation obtains a fresh lifetime/fee and simulates the exact
  // unsigned message against finalized state. The program rechecks it at execution.
  const plan = await prepareSolanaWalletTransaction(
    config,
    evidence.owner,
    instructions,
  );
  return { evidence, requiredSigner: evidence.owner, instructions, ...plan };
}
