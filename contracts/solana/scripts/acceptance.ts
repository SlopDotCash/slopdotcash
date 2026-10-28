/**
 * Solana leg of the section 21 acceptance runner (Solana devnet, or a loopback
 * validator as solana-localnet). Test keys sign the owner and depositor
 * transactions; the production identity attester and relayer engines bind and
 * pay through the real dispatch path, and the destination wallet co-signs its
 * own binding through the account API. Run it through
 * scripts/escrow-acceptance.ts; it lives here for the SPL dependencies.
 */
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SolanaJSONRPCError,
  SystemProgram,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  type AcceptanceNetwork,
  AcceptanceRegistry,
  type AssetEvidence,
  amountsText,
  assertSolanaTestCluster,
  type Evidence,
  type Fetcher,
  loadEvidence,
  newEvidence,
  Projection,
  reconcile,
  replayDispatch,
  requireEnv,
  runPaymentsCron,
  type ScenarioAmounts,
  type StepRecord,
  type Suite,
  saveEvidence,
  scenarioAmounts,
  sha256Text,
  solanaSeed,
  type TestActor,
  testActor,
  unitDivisor,
  untilReady,
  Waiting,
  waitPolicy,
} from "../../../scripts/escrow-acceptance/shared";
import type { EscrowDeployment } from "../../../src/lib/escrow-policy.mjs";
import { lookupAttempt } from "../../../workers/payment-executor/core";
import { PaymentSignerJournal } from "../../../workers/payment-executor/index";
import {
  completeSolanaBinding,
  createSolanaAttester,
  createSolanaExecutor,
  preflightSolanaDeployment,
  solanaTransactionStatus,
} from "../../../workers/payment-executor/solana";
import type { PaymentsWorkerEnvironment } from "../../../workers/payments/index";
import {
  readVaultTotals,
  solanaAwardId,
  solanaBase58,
  solanaConfigAddress,
  solanaMintDecimals,
} from "../adapter";

const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest();
const discriminator = (name: string) => sha256(`global:${name}`).subarray(0, 8);
const u64 = (value: bigint) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
};
const u32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
};
const i64 = (value: bigint) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigInt64LE(value);
  return bytes;
};
const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({
  pubkey,
  isWritable,
  isSigner,
});

/** Instructions of the reviewed slop_escrow program, in its IDL account order. */
export function escrow(programId: PublicKey) {
  const pda = (...seeds: Buffer[]) =>
    PublicKey.findProgramAddressSync(seeds, programId)[0];
  const ix = (
    name: string,
    keys: ReturnType<typeof meta>[],
    ...args: Buffer[]
  ) =>
    new TransactionInstruction({
      programId,
      keys,
      data: Buffer.concat([discriminator(name), ...args]),
    });
  return {
    /** The last seed is the purpose: 0 ordinary awards, 1 private bounties. */
    project: (owner: PublicKey, projectId: Buffer, purpose = 0) =>
      pda(
        Buffer.from("project"),
        owner.toBuffer(),
        projectId,
        Buffer.from([purpose]),
      ),
    month: (project: PublicKey, period: number) =>
      pda(Buffer.from("month"), project.toBuffer(), u32(period)),
    vault: (project: PublicKey) =>
      pda(Buffer.from("vault"), project.toBuffer()),
    config: () => new PublicKey(solanaConfigAddress(programId.toBase58())),
    award: (project: PublicKey, awardId: Buffer) =>
      pda(Buffer.from("award"), project.toBuffer(), awardId),
    origin: (project: PublicKey, source: Buffer) =>
      pda(Buffer.from("origin"), project.toBuffer(), source),
    binding: (project: PublicKey, actor: bigint) =>
      pda(Buffer.from("wallet"), project.toBuffer(), u64(actor)),
    veto: (project: PublicKey, actor: bigint, version: bigint) =>
      pda(Buffer.from("veto"), project.toBuffer(), u64(actor), u64(version)),
    initializeConfig: (
      authority: PublicKey,
      identity: PublicKey,
      fees: PublicKey,
      rotation: PublicKey,
    ) =>
      ix(
        "initialize_config",
        [
          meta(authority, true, true),
          meta(pda(Buffer.from("config")), true),
          meta(programId),
          meta(
            PublicKey.findProgramAddressSync(
              [programId.toBuffer()],
              new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
            )[0],
          ),
          meta(SystemProgram.programId),
        ],
        identity.toBuffer(),
        fees.toBuffer(),
        rotation.toBuffer(),
      ),
    initialize: (input: {
      owner: PublicKey;
      project: PublicKey;
      mint: PublicKey;
      vault: PublicKey;
      config: PublicKey;
      projectId: Buffer;
      network: Buffer;
      identity: PublicKey;
      fees: PublicKey;
      bindingDelay: bigint;
      rotationDelay: bigint;
      purpose?: number;
    }) =>
      ix(
        "initialize",
        [
          meta(input.owner, true, true),
          meta(input.project, true),
          meta(input.mint),
          meta(input.vault, true),
          meta(TOKEN_PROGRAM_ID),
          meta(SystemProgram.programId),
          meta(input.config),
        ],
        input.projectId,
        input.network,
        input.identity.toBuffer(),
        input.fees.toBuffer(),
        i64(input.bindingDelay),
        i64(input.rotationDelay),
        Buffer.from([input.purpose ?? 0]),
      ),
    deposit: (input: {
      depositor: PublicKey;
      project: PublicKey;
      mint: PublicKey;
      source: PublicKey;
      vault: PublicKey;
      amount: bigint;
    }) =>
      ix(
        "deposit",
        [
          meta(input.depositor, false, true),
          meta(input.project, true),
          meta(input.mint),
          meta(input.source, true),
          meta(input.vault, true),
          meta(TOKEN_PROGRAM_ID),
        ],
        u64(input.amount),
      ),
    commit: (input: {
      owner: PublicKey;
      project: PublicKey;
      vault: PublicKey;
      awardId: Buffer;
      source: Buffer;
      actor: bigint;
      gross: bigint;
      bounty?: boolean;
    }) =>
      ix(
        input.bounty ? "commit_bounty" : "commit",
        [
          meta(input.owner, true, true),
          meta(input.project, true),
          meta(input.vault),
          meta(
            pda(Buffer.from("origin"), input.project.toBuffer(), input.source),
            true,
          ),
          meta(
            pda(Buffer.from("award"), input.project.toBuffer(), input.awardId),
            true,
          ),
          meta(SystemProgram.programId),
        ],
        input.awardId,
        input.source,
        u64(input.actor),
        u64(input.gross),
      ),
    withdraw: (input: {
      owner: PublicKey;
      project: PublicKey;
      mint: PublicKey;
      vault: PublicKey;
      destination: PublicKey;
      gross: bigint;
    }) =>
      ix(
        "withdraw",
        [
          meta(input.owner, false, true),
          meta(input.project, true),
          meta(input.mint),
          meta(input.vault, true),
          meta(input.destination, true),
          meta(TOKEN_PROGRAM_ID),
        ],
        u64(input.gross),
      ),
    /** The owner proposes a replacement identity authority for one project. */
    proposeAuthorityRotation: (input: {
      owner: PublicKey;
      project: PublicKey;
      next: PublicKey;
    }) =>
      ix(
        "propose_authority_rotation",
        [
          meta(input.owner, false, true),
          meta(input.project, true),
          meta(new PublicKey(solanaConfigAddress(programId.toBase58()))),
        ],
        input.next.toBuffer(),
      ),
    /** The Config rotation authority confirms the pending proposal. */
    confirmAuthorityRotation: (input: {
      rotationAuthority: PublicKey;
      project: PublicKey;
    }) =>
      ix("confirm_authority_rotation", [
        meta(input.rotationAuthority, false, true),
        meta(new PublicKey(solanaConfigAddress(programId.toBase58()))),
        meta(input.project, true),
      ]),
    /** Anyone executes a confirmed proposal after its rotation delay. */
    executeAuthorityRotation: (project: PublicKey) =>
      ix("execute_authority_rotation", [meta(project, true)]),
    claimFees: (input: {
      project: PublicKey;
      mint: PublicKey;
      vault: PublicKey;
      feeAccount: PublicKey;
    }) =>
      ix("claim_fees", [
        meta(input.project, true),
        meta(input.mint),
        meta(input.vault, true),
        meta(input.feeAccount, true),
        meta(TOKEN_PROGRAM_ID),
      ]),
    setMonthlyCommitment: (
      owner: PublicKey,
      project: PublicKey,
      cap: bigint,
      enabled: boolean,
    ) =>
      ix(
        "set_monthly_commitment",
        [meta(owner, false, true), meta(project, true)],
        u64(cap),
        Buffer.from([enabled ? 1 : 0]),
      ),
    bindWallet: (input: {
      payer: PublicKey;
      identity: PublicKey;
      destination: PublicKey;
      project: PublicKey;
      actor: bigint;
      network: Buffer;
      expectedVersion: bigint;
      claimDigest: Buffer;
      expiresAt: bigint;
    }) =>
      ix(
        "bind_wallet",
        [
          meta(input.payer, true, true),
          meta(input.identity, false, true),
          meta(input.destination, false, true),
          meta(input.project),
          meta(
            pda(
              Buffer.from("wallet"),
              input.project.toBuffer(),
              u64(input.actor),
            ),
            true,
          ),
          meta(SystemProgram.programId),
        ],
        u64(input.actor),
        input.network,
        u64(input.expectedVersion),
        input.claimDigest,
        i64(input.expiresAt),
      ),
    /** `awardId` names the unpaid award whose commit period extends the veto window. */
    vetoBinding: (input: {
      owner: PublicKey;
      project: PublicKey;
      actor: bigint;
      version: bigint;
      awardId?: Buffer;
    }) =>
      ix(
        "veto_binding",
        [
          meta(input.owner, true, true),
          meta(input.project),
          meta(
            pda(
              Buffer.from("wallet"),
              input.project.toBuffer(),
              u64(input.actor),
            ),
            true,
          ),
          meta(
            pda(
              Buffer.from("veto"),
              input.project.toBuffer(),
              u64(input.actor),
              u64(input.version),
            ),
            true,
          ),
          // Anchor reads the program ID as "no account" for an optional account.
          meta(
            input.awardId
              ? pda(
                  Buffer.from("award"),
                  input.project.toBuffer(),
                  input.awardId,
                )
              : programId,
          ),
          meta(SystemProgram.programId),
        ],
        u64(input.actor),
        u64(input.version),
      ),
    /**
     * The Ed25519 program check of the identity authority's signature over
     * `message`, then commit_monthly. `signedMessage` lets a run present a
     * signature over other bytes than the instruction arguments.
     */
    commitMonthly: (input: {
      payer: PublicKey;
      project: PublicKey;
      vault: PublicKey;
      period: number;
      root: Buffer;
      total: bigint;
      frozenAt: bigint;
      authority: PublicKey;
      signature: Uint8Array;
      signedMessage: Uint8Array;
    }) => {
      const offsets = Buffer.alloc(16);
      offsets[0] = 1;
      [48, 65535, 16, 65535, 112, input.signedMessage.length, 65535].forEach(
        (value, index) => {
          offsets.writeUInt16LE(value, 2 + index * 2);
        },
      );
      return [
        new TransactionInstruction({
          programId: new PublicKey(
            "Ed25519SigVerify111111111111111111111111111",
          ),
          keys: [],
          data: Buffer.concat([
            offsets,
            input.authority.toBuffer(),
            Buffer.from(input.signature),
            Buffer.from(input.signedMessage),
          ]),
        }),
        ix(
          "commit_monthly",
          [
            meta(input.payer, true, true),
            meta(input.project, true),
            meta(input.vault),
            meta(
              pda(
                Buffer.from("month"),
                input.project.toBuffer(),
                u32(input.period),
              ),
              true,
            ),
            meta(new PublicKey("Sysvar1nstructions1111111111111111111111111")),
            meta(SystemProgram.programId),
          ],
          u32(input.period),
          input.root,
          u64(input.total),
          i64(input.frozenAt),
        ),
      ];
    },
    pay: (input: {
      project: PublicKey;
      awardId: Buffer;
      actor: bigint;
      version: bigint;
      mint: PublicKey;
      vault: PublicKey;
      destination: PublicKey;
      /** The on-chain binding version, when a run presents another expected version. */
      bindingVersion?: bigint;
    }) =>
      ix(
        "pay",
        [
          meta(input.project, true),
          meta(
            pda(Buffer.from("award"), input.project.toBuffer(), input.awardId),
            true,
          ),
          meta(
            pda(
              Buffer.from("wallet"),
              input.project.toBuffer(),
              u64(input.actor),
            ),
            true,
          ),
          meta(input.mint),
          meta(input.vault, true),
          meta(input.destination, true),
          meta(TOKEN_PROGRAM_ID),
          meta(
            pda(
              Buffer.from("veto"),
              input.project.toBuffer(),
              u64(input.actor),
              u64(input.bindingVersion ?? input.version),
            ),
          ),
        ],
        u64(input.version),
      ),
  };
}

/** Reuses each signed step. An expired signature with unknown outcome stays pending. */
export class SolanaChain {
  readonly connection: Connection;
  constructor(
    readonly rpcUrl: string,
    private readonly persist: () => Promise<void>,
  ) {
    this.connection = new Connection(rpcUrl, "confirmed");
  }
  async tokenBalance(
    account: PublicKey,
    commitment: "confirmed" | "finalized" = "confirmed",
  ) {
    const info = await this.connection
      .getTokenAccountBalance(account, commitment)
      .catch(async (error) => {
        if (
          error instanceof SolanaJSONRPCError &&
          error.code === -32602 &&
          (await this.connection.getAccountInfo(account, commitment)) === null
        )
          return null;
        throw error;
      });
    return info ? BigInt(info.value.amount) : 0n;
  }
  /** Simulates instructions that must fail and returns the program error and logs. */
  async mustFail(
    payer: Keypair,
    instructions: TransactionInstruction[],
    cosigners: Keypair[] = [],
  ) {
    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({
      feePayer: payer.publicKey,
      recentBlockhash: blockhash,
    }).add(...instructions);
    tx.sign(payer, ...cosigners);
    const result = await this.connection.simulateTransaction(tx);
    if (!result.value.err)
      throw new Error("Simulated transaction succeeded but must fail");
    return {
      error: JSON.stringify(result.value.err),
      logs: (result.value.logs ?? []).filter((line) =>
        /Error|error/.test(line),
      ),
    };
  }
  async send(
    steps: Record<string, StepRecord>,
    key: string,
    signers: Keypair[],
    instructions: TransactionInstruction[],
    expect: "success" | "reverted" = "success",
  ): Promise<StepRecord> {
    let record: StepRecord | undefined = steps[key];
    if (record && !record.status) {
      const status = (
        await this.connection.getSignatureStatuses([record.transactionId], {
          searchTransactionHistory: true,
        })
      ).value[0];
      if (!status) {
        const height = await this.connection.getBlockHeight("finalized");
        if (height > (record.lastValidBlockHeight ?? 0)) {
          // Expiry prevents a later send; it does not prove an earlier send
          // never landed. Deposits are not idempotent, so retain the evidence.
          throw new Waiting(
            `${key}: ${record.transactionId} expired with an unknown outcome; reconcile its finalized receipt before continuing`,
          );
        }
      }
    }
    if (!record) {
      const latest = await this.connection.getLatestBlockhash("finalized");
      const tx = new Transaction({
        feePayer: signers[0].publicKey,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      }).add(...instructions);
      tx.sign(...signers);
      if (!tx.signature) throw new Error(`${key}: unsigned transaction`);
      record = {
        transactionId: solanaBase58(tx.signature),
        raw: tx.serialize().toString("base64"),
        from: signers[0].publicKey.toBase58(),
        lastValidBlockHeight: latest.lastValidBlockHeight,
      };
      steps[key] = record;
      await this.persist();
    }
    for (let i = 0; i < 60; i++) {
      const status = (
        await this.connection.getSignatureStatuses([record.transactionId], {
          searchTransactionHistory: true,
        })
      ).value[0];
      if (
        status &&
        (status.confirmationStatus === "confirmed" ||
          status.confirmationStatus === "finalized")
      ) {
        record.status = status.err ? "reverted" : "success";
        record.block = String(status.slot);
        await this.persist();
        if (record.status !== expect)
          throw new Error(
            `${key}: ${record.transactionId} ${record.status} ${JSON.stringify(status.err)}`,
          );
        return record;
      }
      if (!status && i % 10 === 0)
        await this.connection
          .sendRawTransaction(Buffer.from(record.raw ?? "", "base64"), {
            skipPreflight: expect === "reverted",
            maxRetries: 0,
          })
          .catch((error) => {
            if (expect === "success" && i === 0) throw error;
          });
      await Bun.sleep(1000);
    }
    throw new Waiting(`${key}: ${record.transactionId} is not confirmed yet`);
  }
  async waitFinalized(signature: string) {
    const status = (
      await this.connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (status?.confirmationStatus !== "finalized")
      throw new Waiting(`${signature} waits for finality`);
  }
  /** Token balance changes of one transaction, from its finalized metadata. */
  async tokenDeltas(signature: string) {
    const tx = await this.connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx?.meta) throw new Waiting(`${signature} metadata unavailable`);
    const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
    const deltas = new Map<string, bigint>();
    for (const entry of tx.meta.postTokenBalances ?? [])
      deltas.set(
        keys[entry.accountIndex].toBase58(),
        BigInt(entry.uiTokenAmount.amount),
      );
    for (const entry of tx.meta.preTokenBalances ?? []) {
      const key = keys[entry.accountIndex].toBase58();
      deltas.set(
        key,
        (deltas.get(key) ?? 0n) - BigInt(entry.uiTokenAmount.amount),
      );
    }
    return deltas;
  }
}

/**
 * Local validator only (scripts/escrow-acceptance/local.ts): funds the test
 * keys with SOL, writes the deployment Config with the upgrade authority, and
 * creates a 6-decimal and a 9-decimal test mint with 1,000 units for each
 * holder. Refuses any cluster other than a loopback validator.
 */
export async function prepareLocalnet(input: {
  rpcUrl: string;
  programId: string;
  upgradeAuthority: string;
  identity: string;
  feeRecipient: string;
  rotationAuthority: string;
  fund: string[];
  holders: string[];
}): Promise<string[]> {
  const connection = new Connection(input.rpcUrl, "confirmed");
  assertSolanaTestCluster(
    "solana-localnet",
    await connection.getGenesisHash(),
    input.rpcUrl,
  );
  for (const address of input.fund) {
    const signature = await connection.requestAirdrop(
      new PublicKey(address),
      100_000_000_000,
    );
    await connection.confirmTransaction(signature, "confirmed");
  }
  const authority = Keypair.fromSeed(
    Buffer.from(input.upgradeAuthority, "hex"),
  );
  const program = escrow(new PublicKey(input.programId));
  const tx = new Transaction().add(
    program.initializeConfig(
      authority.publicKey,
      new PublicKey(input.identity),
      new PublicKey(input.feeRecipient),
      new PublicKey(input.rotationAuthority),
    ),
  );
  await sendAndConfirmTransaction(connection, tx, [authority], {
    commitment: "finalized",
    preflightCommitment: "confirmed",
  });
  const mints: string[] = [];
  for (const decimals of [6, 9]) {
    const confirm = {
      commitment: "finalized",
      preflightCommitment: "confirmed",
    } as const;
    const mint = await createMint(
      connection,
      authority,
      authority.publicKey,
      null,
      decimals,
      undefined,
      confirm,
    );
    for (const holder of input.holders) {
      const owner = Keypair.fromSeed(Buffer.from(holder, "hex")).publicKey;
      const account = await getOrCreateAssociatedTokenAccount(
        connection,
        authority,
        mint,
        owner,
        false,
        "confirmed",
        confirm,
      );
      await mintTo(
        connection,
        authority,
        mint,
        account.address,
        authority,
        1000n * 10n ** BigInt(decimals),
        [],
        confirm,
      );
    }
    mints.push(mint.toBase58());
  }
  return mints;
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/**
 * The keys, cluster identity, program Config and evidence file of one Solana
 * run. Nothing signs before the genesis hash is a test cluster and the Config
 * identity authority is the configured identity test key.
 */
export async function openSolanaRun(
  network: AcceptanceNetwork,
  directory: string,
  suite: Suite,
) {
  if (network !== "solana-devnet" && network !== "solana-localnet")
    throw new Error(`${network} is not a Solana test cluster`);
  const rpcUrl = requireEnv("ESCROW_ACCEPTANCE_RPC_URL");
  const programId = new PublicKey(requireEnv("ESCROW_ACCEPTANCE_PROGRAM_ID"));
  const codeSha256 = requireEnv("ESCROW_ACCEPTANCE_PROGRAM_CODE_SHA256");
  const upgradeAuthority =
    requireEnv("ESCROW_ACCEPTANCE_PROGRAM_UPGRADE_AUTHORITY") === "none"
      ? null
      : new PublicKey(
          requireEnv("ESCROW_ACCEPTANCE_PROGRAM_UPGRADE_AUTHORITY"),
        ).toBase58();
  if (!/^[0-9a-f]{64}$/.test(codeSha256))
    throw new Error(
      "ESCROW_ACCEPTANCE_PROGRAM_CODE_SHA256 must be 64 hex characters",
    );
  const keys = {
    owner: Keypair.fromSeed(solanaSeed("ESCROW_ACCEPTANCE_OWNER_KEY")),
    depositor: Keypair.fromSeed(solanaSeed("ESCROW_ACCEPTANCE_DEPOSITOR_KEY")),
    relayer: Keypair.fromSeed(solanaSeed("ESCROW_ACCEPTANCE_RELAYER_KEY")),
    registered: Keypair.fromSeed(solanaSeed("ESCROW_ACCEPTANCE_ACTOR_A_KEY")),
    walletless: Keypair.fromSeed(solanaSeed("ESCROW_ACCEPTANCE_ACTOR_B_KEY")),
  };
  const identitySeed = solanaSeed("ESCROW_ACCEPTANCE_IDENTITY_KEY");
  const relayerSeed = solanaSeed("ESCROW_ACCEPTANCE_RELAYER_KEY");
  const identity = Keypair.fromSeed(identitySeed);
  const addresses = [...Object.values(keys), identity].map((k) =>
    k.publicKey.toBase58(),
  );
  if (new Set(addresses).size !== addresses.length)
    throw new Error("Every test role needs its own key");
  const bindingDelay = BigInt(
    process.env.ESCROW_ACCEPTANCE_BINDING_DELAY_SECONDS ?? "0",
  );
  const rotationDelay = BigInt(
    process.env.ESCROW_ACCEPTANCE_ROTATION_DELAY_SECONDS ?? "0",
  );
  // The project registry refuses a Solana deployment whose rotation notice
  // reaches four binding delays (assertEscrowPolicy), so stop before signing.
  if (bindingDelay > 0n && rotationDelay >= 4n * bindingDelay)
    throw new Error(
      "ESCROW_ACCEPTANCE_ROTATION_DELAY_SECONDS must be shorter than four binding delays",
    );

  // Cluster identity first: nothing signs before the genesis hash is a test cluster.
  const connection = new Connection(rpcUrl, "confirmed");
  const genesisHash = await connection.getGenesisHash();
  assertSolanaTestCluster(network, genesisHash, rpcUrl);
  const program = escrow(programId);
  const configInfo = await connection.getAccountInfo(
    program.config(),
    "finalized",
  );
  if (!configInfo?.owner.equals(programId))
    throw new Error("Escrow Config is missing for this program");
  const configIdentity = new PublicKey(configInfo.data.subarray(8, 40));
  const feeRecipient = new PublicKey(configInfo.data.subarray(40, 72));
  const rotationAuthority = new PublicKey(configInfo.data.subarray(72, 104));
  if (!configIdentity.equals(identity.publicKey))
    throw new Error(
      "ESCROW_ACCEPTANCE_IDENTITY_KEY is not the Config identity authority",
    );
  // The deployed bytes must be the reviewed ones before any key signs.
  const programInfo = await connection.getAccountInfo(programId, "finalized");
  const programData = programInfo
    ? await connection.getAccountInfo(
        new PublicKey(programInfo.data.subarray(4, 36)),
        "finalized",
      )
    : null;
  const deployed = programData
    ? createHash("sha256").update(programData.data.subarray(45)).digest("hex")
    : null;
  if (deployed !== codeSha256)
    throw new Error(
      `Deployed program bytes ${deployed} differ from ESCROW_ACCEPTANCE_PROGRAM_CODE_SHA256`,
    );
  const networkDomain = sha256Text(`slop-escrow-acceptance:${network}`);

  let evidence = await loadEvidence(directory);
  const persist = async () => {
    if (evidence) await saveEvidence(directory, evidence);
  };
  const chain = new SolanaChain(rpcUrl, persist);
  const roles = {
    programId: programId.toBase58(),
    owner: keys.owner.publicKey.toBase58(),
    refundDestination: keys.owner.publicKey.toBase58(),
    depositor: keys.depositor.publicKey.toBase58(),
    identityAuthority: identity.publicKey.toBase58(),
    relayer: keys.relayer.publicKey.toBase58(),
    feeRecipient: feeRecipient.toBase58(),
    rotationAuthority: rotationAuthority.toBase58(),
  };
  if (!evidence) {
    evidence = newEvidence({
      network,
      rpcUrl,
      suite,
      chain: {
        genesisHash,
        programCodeSha256: codeSha256,
        upgradeAuthority: upgradeAuthority ?? "none",
        bindingDelaySeconds: bindingDelay.toString(),
        rotationDelaySeconds: rotationDelay.toString(),
        networkDomain,
      },
      roles,
      actors: {
        registered: keys.registered.publicKey.toBase58(),
        walletless: keys.walletless.publicKey.toBase58(),
      },
      runId: process.env.ESCROW_ACCEPTANCE_RUN_ID,
    });
    await persist();
  } else if (
    evidence.network !== network ||
    (evidence.suite ?? "section-21") !== suite ||
    evidence.chain.genesisHash !== genesisHash ||
    JSON.stringify(evidence.roles) !== JSON.stringify(roles)
  )
    throw new Error(
      "The evidence directory belongs to another cluster, suite, program or key set",
    );
  const run = evidence;
  run.status = "running";
  run.waiting = null;
  return {
    network,
    rpcUrl,
    programId,
    codeSha256,
    upgradeAuthority,
    keys,
    identity,
    identitySeed,
    relayerSeed,
    bindingDelay,
    rotationDelay,
    connection,
    genesisHash,
    program,
    feeRecipient,
    rotationAuthority,
    networkDomain,
    chain,
    run,
    persist,
  };
}
export type SolanaRun = Awaited<ReturnType<typeof openSolanaRun>>;

/**
 * The local backend of one run, as evmServices: projection, registry and the
 * production identity attester and relayer, each with its own journal. On
 * devnet they are the hosted executor worker's routing, in process.
 */
export function solanaServices(
  ctx: SolanaRun,
  directory: string,
  projects: () => {
    projectId: string;
    effectiveCycle: string;
    deployment: EscrowDeployment;
  }[],
  rpcUrl = ctx.rpcUrl,
) {
  const { network, genesisHash } = ctx;
  const projection = new Projection(directory);
  // The dispatcher finds each vault in the project registry, as in
  // production; only the signer roles keep a pinned deployment list.
  const registry = new AcceptanceRegistry(directory);
  const env: PaymentsWorkerEnvironment = {
    PAYMENTS_DB: projection.db,
    REGISTRY_DB: registry.db,
    PAYMENT_NETWORKS: JSON.stringify([network]),
    PAYMENT_RPC_URLS: JSON.stringify({ [network]: rpcUrl }),
    PAYMENT_SOLANA_GENESIS: JSON.stringify({ [network]: genesisHash }),
  };
  let pinnedDeployments = "[]";
  const refresh = () => {
    pinnedDeployments = JSON.stringify(registry.record(projects()));
  };
  const attesterJournal = projection.journal("attester");
  const relayerJournal = projection.journal("relayer");
  const solanaSigner = (seed: Uint8Array) => ({
    address: solanaBase58(ed25519.getPublicKey(seed)),
    async signMessage(message: Uint8Array) {
      return ed25519.sign(message, seed);
    },
  });
  const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
  const signers = (): { attester: Fetcher; relayer: Fetcher } => {
    if (network === "solana-devnet") {
      // The hosted executor worker's routing, in process, with test seeds.
      const hosted = (role: "attester" | "relayer", seed: Uint8Array) => {
        let instance: PaymentSignerJournal | undefined;
        instance = new PaymentSignerJournal(
          { storage: role === "attester" ? attesterJournal : relayerJournal },
          {
            get PAYMENTS_DB() {
              return env.PAYMENTS_DB;
            },
            get PAYMENT_DEPLOYMENTS() {
              return pinnedDeployments;
            },
            get PAYMENT_RPC_URLS() {
              return env.PAYMENT_RPC_URLS;
            },
            SIGNER_ROLE: role,
            CHAIN_FAMILY: "solana",
            TEST_SOLANA_SIGNER_SEED: hex(seed),
            JOURNAL: {
              idFromName: (name: string) => name,
              get: () => {
                if (!instance) throw new Error("Signer journal not ready");
                return instance;
              },
            },
          },
        );
        return instance;
      };
      return {
        attester: hosted("attester", ctx.identitySeed),
        relayer: hosted("relayer", ctx.relayerSeed),
      };
    }
    // A loopback validator has its own genesis, which only the local-chain
    // flag admits; the hosted wrapper never forwards that flag.
    const engine = (seed: Uint8Array, journal: typeof attesterJournal) => ({
      get PAYMENTS_DB() {
        return env.PAYMENTS_DB;
      },
      get PAYMENT_DEPLOYMENTS() {
        return pinnedDeployments;
      },
      get PAYMENT_RPC_URLS() {
        return env.PAYMENT_RPC_URLS;
      },
      SOLANA_SIGNER: solanaSigner(seed),
      JOURNAL: journal,
      ALLOW_LOCAL_TEST_CHAIN: true,
      LOCAL_SOLANA_GENESIS: genesisHash,
    });
    const service = (
      handle: (path: string, body: Record<string, unknown>) => Promise<unknown>,
    ): Fetcher => ({
      async fetch(request) {
        const body = (await request.json()) as Record<string, unknown>;
        try {
          return Response.json(
            await handle(new URL(request.url).pathname, body),
          );
        } catch {
          return Response.json(
            { error: "execution_pending_or_rejected" },
            { status: 409 },
          );
        }
      },
    });
    const identityEngine = engine(ctx.identitySeed, attesterJournal);
    const relayerEngine = engine(ctx.relayerSeed, relayerJournal);
    return {
      attester: service(async (path, body) => {
        const { transaction, ...binding } = body as never as Parameters<
          ReturnType<typeof createSolanaAttester>["submit"]
        >[0] & { transaction?: string };
        if (path === "/v1/complete-bind")
          return completeSolanaBinding(
            identityEngine,
            binding,
            String(transaction),
          );
        if (path === "/v1/pay")
          return createSolanaAttester(identityEngine).submit(binding);
        throw new Error("Not found");
      }),
      relayer: service(async (path, body) => {
        if (path === "/v1/pay")
          return createSolanaExecutor(relayerEngine).submit(body as never);
        if (path === "/v1/attempt-status") {
          const result = await lookupAttempt(
            { PAYMENTS_DB: env.PAYMENTS_DB, JOURNAL: relayerJournal },
            body as never,
          );
          if (!result.transactionId) return result;
          const config = await preflightSolanaDeployment(
            relayerEngine,
            body as never,
          );
          return {
            ...result,
            submitted:
              (await solanaTransactionStatus({ config }, result)) !== null,
          };
        }
        throw new Error("Not found");
      }),
    };
  };
  const services = {
    projection,
    registry,
    env,
    refresh,
    attesterJournal,
    relayerJournal,
    pinned: () => pinnedDeployments,
    ...signers(),
    deps: { solanaAttester: undefined as unknown as Fetcher },
    restart() {
      Object.assign(services, signers());
      services.deps.solanaAttester = services.attester;
      env.SOLANA_PAYMENT_EXECUTOR = services.relayer;
    },
  };
  services.restart();
  return services;
}

/**
 * Registers the actor's wallet through the account API, then co-signs the
 * attester's prepared binding with the destination wallet, as a contributor
 * does in the browser. Returns the binding transaction once one exists.
 */
export async function cosignSolanaBinding(input: {
  projection: Projection;
  actor: TestActor;
  seed: Uint8Array;
  obligationId: string;
  deps: { solanaAttester: Fetcher };
}) {
  const prepared = await input.projection.api(
    input.actor,
    "/wallets/solana-bind/prepare",
    { obligationId: input.obligationId },
    input.deps,
  );
  let transactionId = String(prepared.transactionId);
  if (typeof prepared.transaction === "string") {
    const raw = Buffer.from(prepared.transaction, "base64");
    const signature = ed25519.sign(raw.subarray(129), input.seed);
    raw.set(signature, 65);
    const completed = await input.projection.api(
      input.actor,
      "/wallets/solana-bind/complete",
      { obligationId: input.obligationId, transaction: raw.toString("base64") },
      input.deps,
    );
    transactionId = String(completed.transactionId);
  }
  return transactionId;
}

/** The escrow deployment an admin revision records in project.json for one project. */
export function solanaDeploymentRecord(
  ctx: SolanaRun,
  project: PublicKey,
  mint: PublicKey,
  bindingDelay: bigint,
  deploymentTransaction: string | null = null,
): Omit<EscrowDeployment, "deploymentTransaction"> & {
  deploymentTransaction: string | null;
} {
  return {
    network: ctx.network as EscrowDeployment["network"],
    vault: ctx.program.vault(project).toBase58(),
    programId: ctx.programId.toBase58(),
    upgradeAuthority: ctx.upgradeAuthority,
    projectPda: project.toBase58(),
    networkDomain: ctx.networkDomain,
    asset: mint.toBase58(),
    owner: ctx.keys.owner.publicKey.toBase58(),
    identityAuthority: ctx.identity.publicKey.toBase58(),
    feeRecipient: ctx.feeRecipient.toBase58(),
    rotationAuthority: ctx.rotationAuthority.toBase58(),
    deploymentTransaction,
    sourceCommit: ctx.run.sourceCommit,
    codeSha256: ctx.codeSha256,
    bindingDelaySeconds: bindingDelay.toString(),
    rotationDelaySeconds: ctx.rotationDelay.toString(),
    factory: null,
    factoryCodeSha256: null,
    registrar: null,
  };
}

export async function runSolana(
  network: AcceptanceNetwork,
  directory: string,
): Promise<Evidence> {
  const ctx = await openSolanaRun(network, directory, "section-21");
  const { rpcUrl, programId, keys, identity } = ctx;
  const { bindingDelay, rotationDelay, connection, program, run, persist } =
    ctx;
  const { feeRecipient, networkDomain, chain } = ctx;
  const mints = requireEnv("ESCROW_ACCEPTANCE_ASSETS")
    .split(",")
    .map((value) => new PublicKey(value.trim()));
  // A resume must keep every recorded asset. Otherwise an omitted asset stays
  // unfinished while the run reports passed.
  if (mints.length < run.assets.length)
    throw new Error("Asset list changed since the run started");
  const divisor = unitDivisor();
  if (network === "solana-localnet") {
    const note =
      "solana-localnet runs the executor engines with the local-chain flag, as contracts/solana/integration/executor.e2e.mjs does; solana-devnet uses the hosted PaymentSignerJournal routing.";
    if (!run.deviations.includes(note)) run.deviations.push(note);
  }
  const services = solanaServices(ctx, directory, () =>
    run.assets
      .filter((a) => a.vault)
      .map((a) => ({
        projectId: a.projectId,
        effectiveCycle: run.startedAt.slice(0, 7),
        deployment: a.deployment as unknown as EscrowDeployment,
      })),
  );
  const { projection, env, relayerJournal, deps } = services;
  const refreshDeployments = services.refresh;
  const relayer = services.relayer;
  const policyWait = waitPolicy();
  const deadline = Date.now() + policyWait.maxWaitMs;
  const report = (reason: string) =>
    console.log(`[${network}] waiting: ${reason}`);
  const ready = <T>(step: () => Promise<T>) =>
    untilReady(step, policyWait, deadline, report);

  try {
    // The payments Worker finds vaults only in the project registry, which
    // names registry networks only. The executor admits a loopback validator
    // only as solana-localnet and checks that name against the obligation,
    // so no solana-localnet vault can reach dispatch. Stop before signing.
    if (network === "solana-localnet")
      throw new Error(
        "The project registry has no solana-localnet network, so the payments Worker cannot dispatch a solana-localnet vault",
      );
    for (const [index, mint] of mints.entries()) {
      // Classic SPL Token mints only; the adapter refuses other owners.
      const decimals = await solanaMintDecimals({ rpcUrl }, mint.toBase58());
      const amounts = scenarioAmounts(decimals, divisor);
      let entry = run.assets[index];
      if (!entry) {
        const projectIdBytes = sha256(
          `slop-escrow-acceptance:${run.runId}:${network}:${mint.toBase58()}`,
        );
        const project = program.project(keys.owner.publicKey, projectIdBytes);
        entry = {
          address: mint.toBase58(),
          decimals,
          referenceStablecoin:
            network === "solana-devnet" &&
            mint.toBase58() === "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
          amounts: amountsText(amounts),
          projectId: `acceptance-${run.runId.slice(0, 8)}-${index}`,
          onchainProjectId: projectIdBytes.toString("hex"),
          vault: null,
          // The escrow deployment an admin revision records in project.json;
          // the initialize-project transaction fills deploymentTransaction.
          deployment: {
            ...solanaDeploymentRecord(ctx, project, mint, bindingDelay),
          },
          steps: {},
          checks: {},
          status: "pending",
        };
        run.assets.push(entry);
        await persist();
      } else if (entry.address !== mint.toBase58())
        throw new Error("Asset list changed since the run started");
      if (entry.status === "passed") continue;
      await runAsset(index, entry, amounts, mint);
    }
    if (!run.assets.some((a) => a.decimals !== 6))
      throw new Error(
        "Section 21 needs a mint without six decimals in ESCROW_ACCEPTANCE_ASSETS",
      );
    if (!run.assets.some((a) => a.referenceStablecoin)) {
      const note = `No asset is Circle devnet USDC (4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU); this run is not USDC evidence.`;
      if (!run.deviations.includes(note)) run.deviations.push(note);
    }
    if (!run.assets.every((a) => a.amounts.fullScale === true)) {
      const note =
        "ESCROW_ACCEPTANCE_UNIT_DIVISOR scaled the section 21 figures down; the run is not at 1,000-unit scale.";
      if (!run.deviations.includes(note)) run.deviations.push(note);
    }
    run.status = "passed";
  } catch (error) {
    if (error instanceof Waiting) {
      run.status = "waiting";
      run.waiting = {
        reason: error.message,
        until: error.until?.toISOString() ?? null,
      };
    } else {
      run.status = "failed";
      run.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  await persist();
  return run;

  async function runAsset(
    index: number,
    entry: AssetEvidence,
    amounts: ScenarioAmounts,
    mint: PublicKey,
  ) {
    const steps = entry.steps;
    const project = new PublicKey(String(entry.deployment.projectPda));
    const vault = new PublicKey(String(entry.deployment.vault));
    const ata = (owner: PublicKey) =>
      getAssociatedTokenAddressSync(mint, owner);
    const feeAccount = ata(feeRecipient);
    const send = (
      key: string,
      signers: Keypair[],
      instructions: TransactionInstruction[],
      expect?: "success" | "reverted",
    ) => ready(() => chain.send(steps, key, signers, instructions, expect));

    // 1. A fresh project and vault for this run and mint.
    await send(
      "initialize-project",
      [keys.owner],
      [
        program.initialize({
          owner: keys.owner.publicKey,
          project,
          mint,
          vault,
          config: program.config(),
          projectId: Buffer.from(entry.onchainProjectId, "hex"),
          network: Buffer.from(networkDomain, "hex"),
          identity: identity.publicKey,
          fees: feeRecipient,
          bindingDelay,
          rotationDelay,
        }),
        createAssociatedTokenAccountIdempotentInstruction(
          keys.owner.publicKey,
          feeAccount,
          feeRecipient,
          mint,
        ),
      ],
    );
    if (!entry.vault) {
      entry.vault = vault.toBase58();
      entry.deployment.deploymentTransaction =
        steps["initialize-project"].transactionId;
      await persist();
    }
    refreshDeployments();

    // 2. Fund 1,000 units: 900 from the owner and 100 from a third party.
    for (const [role, signer, amount] of [
      ["owner", keys.owner, amounts.ownerDeposit],
      ["third-party", keys.depositor, amounts.thirdPartyDeposit],
    ] as const) {
      const source = ata(signer.publicKey);
      if (!steps[`deposit-${role}`]) {
        const held = await chain.tokenBalance(source);
        if (held < amount)
          throw new Error(
            `${role} ${signer.publicKey.toBase58()} holds ${held} of ${mint.toBase58()}; it needs ${amount} base units`,
          );
      }
      const record = await send(
        `deposit-${role}`,
        [signer],
        [
          program.deposit({
            depositor: signer.publicKey,
            project,
            mint,
            source,
            vault,
            amount,
          }),
        ],
      );
      if (!entry.checks[`deposited-${role}`]) {
        const deltas = await chain.tokenDeltas(record.transactionId);
        if (
          deltas.get(vault.toBase58()) !== amount ||
          deltas.get(source.toBase58()) !== -amount
        )
          throw new Error(
            `deposit-${role}: token movement differs from ${amount}`,
          );
        entry.checks[`deposited-${role}`] = {
          depositor: signer.publicKey.toBase58(),
          amount: amount.toString(),
        };
      }
    }

    // 3. Approve 100 for the registered actor and 50 for the walletless actor.
    const actors = {
      registered: testActor("registered", index),
      walletless: testActor("walletless", index),
    };
    const awards = {} as Record<
      "registered" | "walletless",
      { id: string; gross: bigint; net: bigint; fee: bigint }
    >;
    for (const [role, gross, net, fee] of [
      ["registered", amounts.awardA, amounts.netA, amounts.feeA],
      ["walletless", amounts.awardB, amounts.netB, amounts.feeB],
    ] as const) {
      const source = sha256(`${entry.onchainProjectId}:award:${role}`);
      const id = solanaAwardId(project.toBase58(), source.toString("hex"));
      awards[role] = { id, gross, net, fee };
      await send(
        `commit-${role}`,
        [keys.owner],
        [
          program.commit({
            owner: keys.owner.publicKey,
            project,
            vault,
            awardId: Buffer.from(id, "hex"),
            source,
            actor: BigInt(actors[role].githubUserId),
            gross,
          }),
        ],
      );
    }
    entry.checks.awards = Object.fromEntries(
      Object.entries(awards).map(([role, award]) => [
        role,
        {
          obligationId: award.id,
          githubUserId: actors[role as "registered"].githubUserId,
          gross: award.gross.toString(),
          net: award.net.toString(),
          fee: award.fee.toString(),
        },
      ]),
    );
    const withdrawIx = (gross: bigint) =>
      program.withdraw({
        owner: keys.owner.publicKey,
        project,
        mint,
        vault,
        destination: ata(keys.owner.publicKey),
        gross,
      });
    if (!entry.checks.reservedNotWithdrawable)
      entry.checks.reservedNotWithdrawable = {
        attemptedGross: (amounts.withdrawGross + 1n).toString(),
        ...(await chain.mustFail(keys.owner, [
          withdrawIx(amounts.withdrawGross + 1n),
        ])),
      };
    await persist();

    // 4-5. Register, co-sign the binding, and let the cron dispatch.
    for (const role of ["registered", "walletless"] as const)
      await payThroughDispatch(
        entry,
        role,
        actors[role],
        awards[role],
        project,
        mint,
        vault,
      );

    // 6. Replay dispatch: no second attempt, no second transfer.
    if (!entry.checks.replay) {
      const balances = async () => ({
        registered: (
          await chain.tokenBalance(ata(keys.registered.publicKey))
        ).toString(),
        walletless: (
          await chain.tokenBalance(ata(keys.walletless.publicKey))
        ).toString(),
        vault: (await chain.tokenBalance(vault)).toString(),
      });
      const before = await balances();
      const dispatch = await replayDispatch(projection, [
        awards.registered.id,
        awards.walletless.id,
      ]);
      const paid = entry.checks["paid-registered"] as {
        attemptId: string;
        claimId: string;
        claimDigest: string;
        version: string;
      };
      const service = await relayer.fetch(
        new Request("https://payments-executor.internal/v1/pay", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": paid.attemptId,
          },
          body: JSON.stringify({
            obligationId: awards.registered.id,
            network,
            vault: vault.toBase58(),
            githubUserId: actors.registered.githubUserId,
            claimId: paid.claimId,
            claimDigest: paid.claimDigest,
            destination: keys.registered.publicKey.toBase58(),
            idempotencyKey: paid.attemptId,
          }),
        }),
      );
      const serviceResult = (await service.json()) as {
        transactionId?: string;
      };
      if (
        service.status !== 200 ||
        serviceResult.transactionId !== steps["pay-registered"].transactionId
      )
        throw new Error("Executor replay did not return the original payment");
      const journaled = await relayerJournal.get<{ raw: string }>(
        `solana:relayer:${network}:${paid.attemptId}`,
      );
      let rebroadcast: string;
      try {
        rebroadcast = `accepted as ${await connection.sendRawTransaction(Buffer.from(journaled?.raw ?? "", "base64"))}`;
      } catch (error) {
        rebroadcast = (error instanceof Error ? error.message : String(error))
          .replace(/\s+/g, " ")
          .trim();
      }
      const payIx = program.pay({
        project,
        awardId: Buffer.from(awards.registered.id, "hex"),
        actor: BigInt(actors.registered.githubUserId),
        version: BigInt(paid.version),
        mint,
        vault,
        destination: ata(keys.registered.publicKey),
      });
      const simulated = await chain.mustFail(keys.depositor, [payIx]);
      const mined = await send(
        "replay-pay-onchain",
        [keys.depositor],
        [payIx],
        "reverted",
      );
      const after = await balances();
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new Error("Balances changed during replay");
      entry.checks.replay = {
        dispatch,
        executorReplay: {
          status: service.status,
          transactionId: serviceResult.transactionId,
        },
        rebroadcastSignedPayment: rebroadcast,
        simulatedSecondPayment: simulated,
        minedSecondPayment: {
          transactionId: mined.transactionId,
          status: mined.status,
        },
        balancesBefore: before,
        balancesAfter: after,
      };
      await persist();
    }

    // 7. Withdraw the 850 free units: the rest to the owner, 2% kept in the vault as
    // an accrued fee.
    const withdrawal = await send(
      "withdraw-unused",
      [keys.owner],
      [withdrawIx(amounts.withdrawGross)],
    );
    if (!entry.checks.withdrawal) {
      const deltas = await chain.tokenDeltas(withdrawal.transactionId);
      const ownerDelta = deltas.get(ata(keys.owner.publicKey).toBase58());
      const vaultDelta = deltas.get(vault.toBase58());
      entry.checks.withdrawal = {
        gross: amounts.withdrawGross.toString(),
        fee: String(amounts.withdrawGross + (vaultDelta ?? 0n)),
        net: String(ownerDelta),
        destination: ata(keys.owner.publicKey).toBase58(),
      };
      if (
        ownerDelta !== amounts.withdrawGross - amounts.withdrawFee ||
        vaultDelta !== -ownerDelta
      )
        throw new Error("Withdrawal did not keep ceil(gross / 50) as the fee");
      await persist();
    }
    if (!entry.checks.overWithdrawal)
      entry.checks.overWithdrawal = {
        attemptedGross: "1",
        ...(await chain.mustFail(keys.owner, [withdrawIx(1n)])),
      };

    // 8. Anyone claims the accrued payout and withdrawal fees to the fee recipient.
    const accrued = amounts.feeA + amounts.feeB + amounts.withdrawFee;
    const claim = await send(
      "claim-fees",
      [keys.depositor],
      [program.claimFees({ project, mint, vault, feeAccount })],
    );
    if (!entry.checks.feeClaim) {
      const deltas = await chain.tokenDeltas(claim.transactionId);
      const feeDelta = deltas.get(feeAccount.toBase58());
      entry.checks.feeClaim = {
        amount: String(feeDelta),
        feeAccount: feeAccount.toBase58(),
      };
      if (feeDelta !== accrued || deltas.get(vault.toBase58()) !== -accrued)
        throw new Error(`Fee claim moved ${feeDelta}, not ${accrued}`);
      await persist();
    }

    // 9. The cached vault_snapshots row equals the finalized chain counters.
    await ready(() => chain.waitFinalized(claim.transactionId));
    for (let tick = 0; tick < 3; tick++) await runPaymentsCron(env);
    const totals = await readVaultTotals({
      rpcUrl,
      network,
      projectPda: project.toBase58(),
      programId: programId.toBase58(),
    });
    const vaultBalance = await chain.tokenBalance(vault, "finalized");
    const result = await reconcile(
      projection,
      entry.projectId,
      totals,
      {
        totalDeposited: amounts.totalDeposit.toString(),
        totalPaid: (amounts.netA + amounts.netB).toString(),
        totalPayoutFees: (amounts.feeA + amounts.feeB).toString(),
        totalGrossWithdrawn: amounts.withdrawGross.toString(),
        totalWithdrawalFees: amounts.withdrawFee.toString(),
        freeBalance: "0",
        reservedPrincipal: null,
        reservedFees: null,
        accruedFees: "0",
        reserved: "0",
      },
      vault.toBase58(),
    );
    entry.checks.reconciliation = {
      ...result,
      vaultTokenBalance: vaultBalance.toString(),
    };
    if (result.mismatches.length)
      throw new Error(`Reconciliation failed: ${result.mismatches.join("; ")}`);
    if (vaultBalance !== 0n)
      throw new Error(`Vault still holds ${vaultBalance} base units`);
    entry.status = "passed";
    await persist();
  }

  async function payThroughDispatch(
    entry: AssetEvidence,
    role: "registered" | "walletless",
    actor: TestActor,
    award: { id: string; net: bigint; fee: bigint },
    project: PublicKey,
    mint: PublicKey,
    vault: PublicKey,
  ) {
    const key = `paid-${role}`;
    if (entry.checks[key]) return;
    if (role === "walletless" && !entry.checks["paid-registered"])
      throw new Error("Walletless actor must register after the first payment");
    const wallet = keys[role];
    const seed =
      role === "registered"
        ? solanaSeed("ESCROW_ACCEPTANCE_ACTOR_A_KEY")
        : solanaSeed("ESCROW_ACCEPTANCE_ACTOR_B_KEY");
    const claim = await projection.registerWallet(
      actor,
      "solana",
      wallet.publicKey.toBase58(),
      async (message) =>
        base64(ed25519.sign(new TextEncoder().encode(message), seed)),
      deps,
    );
    await ready(async () => {
      const errors = await runPaymentsCron(env);
      const obligation = projection.obligation(award.id);
      if (obligation?.state === "paid") return;
      // The relayer refuses until the wallet co-signs its binding; the
      // contributor then signs the attester's prepared transaction.
      const attempt = projection.attempts(award.id)[0];
      const bindingInfo = await connection.getAccountInfo(
        program.binding(project, BigInt(actor.githubUserId)),
        "confirmed",
      );
      if (attempt && !bindingInfo && !entry.steps[`bind-${role}`]) {
        const transactionId = await cosignSolanaBinding({
          projection,
          actor,
          seed,
          obligationId: award.id,
          deps,
        });
        entry.steps[`bind-${role}`] = {
          transactionId,
          from: identity.publicKey.toBase58(),
          note: "Prepared by the identity attester and co-signed by the destination wallet through the account API",
        };
        await persist();
      }
      throw new Waiting(
        `${role} award not paid yet${bindingInfo ? " (binding on chain; delays or finality pending)" : ""}${errors.length ? ` (cron: ${[...new Set(errors)].slice(0, 3).join(" | ")})` : ""}`,
      );
    });
    const obligation = projection.obligation(award.id);
    const attempt = projection
      .attempts(award.id)
      .find((a) => a.transaction_id === obligation?.paid_transaction);
    if (!obligation?.paid_transaction || !attempt)
      throw new Error(`${role}: paid obligation has no recorded attempt`);
    const deltas = await chain.tokenDeltas(obligation.paid_transaction);
    const destination = getAssociatedTokenAddressSync(
      mint,
      wallet.publicKey,
    ).toBase58();
    // The fee stays in the vault until claim_fees: only the net leaves it.
    if (
      deltas.get(destination) !== award.net ||
      deltas.get(vault.toBase58()) !== -award.net
    )
      throw new Error(
        `${role}: payment moved ${deltas.get(destination)} from ${deltas.get(vault.toBase58())}, not ${award.net}`,
      );
    const binding = await connection.getAccountInfo(
      program.binding(project, BigInt(actor.githubUserId)),
      "finalized",
    );
    const version = binding ? binding.data.readBigUInt64LE(144) : 0n;
    const bindStep = entry.steps[`bind-${role}`];
    if (bindStep) {
      const status = (
        await connection.getSignatureStatuses([bindStep.transactionId], {
          searchTransactionHistory: true,
        })
      ).value[0];
      bindStep.status = status && !status.err ? "success" : "reverted";
      bindStep.block = status ? String(status.slot) : undefined;
    }
    entry.steps[`pay-${role}`] = {
      transactionId: obligation.paid_transaction,
      from: keys.relayer.publicKey.toBase58(),
      status: "success",
      note: "Submitted by the relayer engine through dispatchPayment",
    };
    entry.checks[key] = {
      obligationId: award.id,
      githubUserId: actor.githubUserId,
      claimId: claim.claimId,
      claimDigest: claim.claimDigest,
      attemptId: attempt.id,
      version: version.toString(),
      net: award.net.toString(),
      fee: award.fee.toString(),
      destinationDelta: String(deltas.get(destination)),
      vaultDelta: String(deltas.get(vault.toBase58())),
      ledgerState: obligation.state,
      outbox: projection.outbox(award.id),
    };
    await persist();
  }
}
