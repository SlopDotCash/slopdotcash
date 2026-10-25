/**
 * Solana leg of the extended #902 acceptance suite (Solana devnet). The same
 * scenarios as scripts/escrow-acceptance/evm-extended.ts, each in its own
 * project of the reviewed program, with the section 21 role keys:
 *
 * - bounty: a 100-unit private bounty pays 75 and 25 with no other fee;
 * - monthly: the owner's monthly switch and cap, the 72-hour cutoff window, a
 *   changed allocation, a manual award and payment before the freeze, and the
 *   permissionless commitment through the production executor
 *   (freezeSolanaMonthly, /v1/commit-monthly), with no double reservation;
 * - walletless-lifecycle: no payment without a wallet, wrong-network and
 *   stale-version rejection, replacement, owner veto (refused at the deployed
 *   zero binding delay; exercised in a project with a review delay) and
 *   recovery with immediate payment;
 * - interrupted-send, failed-recipient and frozen-fee-destination: payment
 *   through the production payments Worker cron and executor, with a lost
 *   broadcast answer, a frozen recipient token account and a frozen fee
 *   token account (the test mint's freeze authority is the owner test key).
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createFreezeAccountInstruction,
  createThawAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  type AcceptanceNetwork,
  type Evidence,
  extendedAmounts,
  FaultRpc,
  openMonthlyPeriod,
  requireEnv,
  runPaymentsCron,
  runScenarios,
  type ScenarioEvidence,
  scenarioActor,
  sha256Text,
  solanaSeed,
  type TestActor,
  unitDivisor,
  untilReady,
  Waiting,
  waitPolicy,
} from "../../../scripts/escrow-acceptance/shared";
import type { EscrowDeployment } from "../../../src/lib/escrow-policy.mjs";
import { preflightSolanaDeployment } from "../../../workers/payment-executor/solana";
import { freezeSolanaMonthly } from "../../../workers/payment-executor/solana-monthly";
import {
  solanaAllocationRoot,
  solanaAllocationTotal,
  solanaAwardId,
  solanaBase58,
  solanaMintDecimals,
  solanaMonthlyMessage,
} from "../adapter";
import {
  cosignSolanaBinding,
  openSolanaRun,
  solanaDeploymentRecord,
  solanaServices,
} from "./acceptance";

const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest();
const text = (value: bigint) => value.toString();
type Figures = ReturnType<ReturnType<typeof extendedAmounts>["award"]>;
type Award = Figures & {
  id: string;
  source: Buffer;
  actor: TestActor;
};

export async function runSolanaExtended(
  network: AcceptanceNetwork,
  directory: string,
): Promise<Evidence> {
  const ctx = await openSolanaRun(network, directory, "extended");
  const { keys, identity, chain, connection, program, run, persist } = ctx;
  // The payments Worker cannot dispatch a solana-localnet vault (see the
  // runbook's known blockers). A local validator therefore runs only the
  // key-recovery scenario, which needs no registry or dispatch.
  const localOnly = network === "solana-localnet";
  if (network !== "solana-devnet" && !localOnly)
    throw new Error("The extended suite runs on solana-devnet");
  if (localOnly) {
    const note =
      "solana-localnet runs only the key-recovery scenario; the other scenarios need payments Worker dispatch, which a local validator cannot reach.";
    if (!run.deviations.includes(note)) run.deviations.push(note);
  }
  const bountyMints = requireEnv("ESCROW_ACCEPTANCE_ASSETS")
    .split(",")
    .map((value) => new PublicKey(value.trim()));
  const scenarioMint = new PublicKey(
    requireEnv("ESCROW_ACCEPTANCE_SCENARIO_ASSET"),
  );
  const freezable = new PublicKey(
    requireEnv("ESCROW_ACCEPTANCE_BLOCKABLE_ASSET"),
  );
  const reviewDelay = BigInt(
    process.env.ESCROW_ACCEPTANCE_REVIEW_DELAY_SECONDS ?? "0",
  );
  const divisor = unitDivisor();
  const policyWait = waitPolicy();
  const deadline = Date.now() + policyWait.maxWaitMs;
  const report = (reason: string) =>
    console.log(`[${network}] waiting: ${reason}`);
  const ready = <T>(step: () => Promise<T>) =>
    untilReady(step, policyWait, deadline, report);
  if (ctx.bindingDelay !== 0n)
    throw new Error(
      "The extended suite expects the deployed zero binding delay (ESCROW_ACCEPTANCE_BINDING_DELAY_SECONDS)",
    );
  if (divisor !== 1n) {
    const note =
      "ESCROW_ACCEPTANCE_UNIT_DIVISOR scaled the scenario figures down; amounts are not at full scale.";
    if (!run.deviations.includes(note)) run.deviations.push(note);
  }
  // Destination wallets are derived in memory from the second actor seed.
  const actorSeed = solanaSeed("ESCROW_ACCEPTANCE_ACTOR_B_KEY");
  const walletSeed = (label: string) =>
    sha256(
      Buffer.concat([
        Buffer.from(actorSeed),
        Buffer.from(`slop-acceptance-wallet:${label}`),
      ]),
    );
  const wallet = (label: string) => Keypair.fromSeed(walletSeed(label));
  const ata = (mint: PublicKey, owner: PublicKey) =>
    getAssociatedTokenAddressSync(mint, owner);
  const network32 = Buffer.from(ctx.networkDomain, "hex");
  const amountsFor = async (mint: PublicKey) =>
    extendedAmounts(
      await solanaMintDecimals({ rpcUrl: ctx.rpcUrl }, mint.toBase58()),
      divisor,
    );
  const expectEqual = (what: string, actual: unknown, expected: unknown) => {
    if (String(actual) !== String(expected))
      throw new Error(`${what}: ${actual}, expected ${expected}`);
  };
  const send = (
    entry: ScenarioEvidence,
    key: string,
    signers: Keypair[],
    instructions: TransactionInstruction[],
    expect?: "success" | "reverted",
  ) => ready(() => chain.send(entry.steps, key, signers, instructions, expect));
  /** The program or token error a simulation reports, by name when it has one. */
  const failure = async (
    payer: Keypair,
    instructions: TransactionInstruction[],
    cosigners: Keypair[] = [],
  ) => {
    const result = await chain.mustFail(payer, instructions, cosigners);
    const coded = result.logs
      .map((line) => /Error Code: (\w+)/.exec(line)?.[1])
      .find(Boolean);
    return (
      coded ?? result.logs.find((line) => /rror/.test(line)) ?? result.error
    );
  };
  const expectFailure = async (
    entry: ScenarioEvidence,
    key: string,
    expected: string | RegExp,
    payer: Keypair,
    instructions: TransactionInstruction[],
    cosigners: Keypair[] = [],
  ) => {
    if (entry.checks[key]) return;
    const error = await failure(payer, instructions, cosigners);
    if (
      typeof expected === "string" ? error !== expected : !expected.test(error)
    )
      throw new Error(`${key}: failed with ${error}, expected ${expected}`);
    entry.checks[key] = { error };
    await persist();
  };
  const state = async (project: PublicKey) => {
    const info = await connection.getAccountInfo(project, "confirmed");
    if (!info) throw new Error(`Project ${project.toBase58()} missing`);
    const d = info.data;
    return {
      reserved: d.readBigUInt64LE(200),
      deposited: d.readBigUInt64LE(208),
      paid: d.readBigUInt64LE(216),
      payoutFees: d.readBigUInt64LE(224),
      withdrawnGross: d.readBigUInt64LE(232),
      withdrawalFees: d.readBigUInt64LE(240),
      bindingDelay: d.readBigInt64LE(249),
      purpose: d[306],
      monthlyCap: d.readBigUInt64LE(307),
      monthlyEnabled: d[315] === 1,
      accruedFees: d.readBigUInt64LE(316),
      monthlyOutstanding: d.readBigUInt64LE(324),
    };
  };
  const printable = (value: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        typeof v === "bigint" ? text(v) : v,
      ]),
    );
  const binding = async (project: PublicKey, actor: TestActor) => {
    const info = await connection.getAccountInfo(
      program.binding(project, BigInt(actor.githubUserId)),
      "confirmed",
    );
    if (!info) return null;
    return {
      destination: new PublicKey(info.data.subarray(112, 144)).toBase58(),
      version: info.data.readBigUInt64LE(144),
      boundAt: info.data.readBigInt64LE(152),
    };
  };
  /** A confirmed slot's block time becomes readable shortly after confirmation. */
  const slotTime = async (slot: string | undefined) => {
    for (let i = 0; i < 30; i++) {
      const time = await connection
        .getBlockTime(Number(slot))
        .catch(() => null);
      if (time) return BigInt(time);
      await Bun.sleep(2000);
    }
    throw new Waiting(`block time of slot ${slot} unavailable`);
  };

  /** The owner's own project and vault for one scenario, initialized once. */
  const projectFor = async (
    entry: ScenarioEvidence,
    name: string,
    mint: PublicKey,
    options: { bounty?: boolean; bindingDelay?: bigint } = {},
  ) => {
    const projectId = sha256(
      `slop-escrow-acceptance:${run.runId}:${network}:${name}:${mint.toBase58()}`,
    );
    const purpose = options.bounty ? 1 : 0;
    const project = program.project(keys.owner.publicKey, projectId, purpose);
    const vault = program.vault(project);
    await send(
      entry,
      `${name}:initialize`,
      [keys.owner],
      [
        program.initialize({
          owner: keys.owner.publicKey,
          project,
          mint,
          vault,
          config: program.config(),
          projectId,
          network: network32,
          identity: identity.publicKey,
          fees: ctx.feeRecipient,
          bindingDelay: options.bindingDelay ?? 0n,
          rotationDelay: ctx.rotationDelay,
          purpose,
        }),
        createAssociatedTokenAccountIdempotentInstruction(
          keys.owner.publicKey,
          ata(mint, ctx.feeRecipient),
          ctx.feeRecipient,
          mint,
        ),
      ],
    );
    entry.vaults[name] = vault.toBase58();
    entry.checks[`${name}:project`] = project.toBase58();
    if (!entry.assets.includes(mint.toBase58()))
      entry.assets.push(mint.toBase58());
    return { project, vault, mint };
  };
  type Project = Awaited<ReturnType<typeof projectFor>>;
  const deposit = async (
    entry: ScenarioEvidence,
    name: string,
    p: Project,
    amount: bigint,
  ) => {
    const source = ata(p.mint, keys.owner.publicKey);
    if (!entry.steps[`${name}:deposit`]) {
      const held = await chain.tokenBalance(source);
      if (held < amount)
        throw new Error(
          `owner holds ${held} of ${p.mint.toBase58()}; ${name} needs ${amount} base units`,
        );
    }
    const record = await send(
      entry,
      `${name}:deposit`,
      [keys.owner],
      [
        program.deposit({
          depositor: keys.owner.publicKey,
          project: p.project,
          mint: p.mint,
          source,
          vault: p.vault,
          amount,
        }),
      ],
    );
    if (!entry.checks[`${name}:deposited`]) {
      const deltas = await chain.tokenDeltas(record.transactionId);
      expectEqual(`${name} deposit`, deltas.get(p.vault.toBase58()), amount);
      entry.checks[`${name}:deposited`] = text(amount);
    }
  };
  const award = (
    p: Project,
    label: string,
    actor: TestActor,
    figures: Figures,
  ): Award => {
    const source = sha256(`${p.project.toBase58()}:${label}`);
    return {
      id: solanaAwardId(p.project.toBase58(), source.toString("hex")),
      source,
      actor,
      ...figures,
    };
  };
  const commitIx = (p: Project, item: Award, bounty = false) =>
    program.commit({
      owner: keys.owner.publicKey,
      project: p.project,
      vault: p.vault,
      awardId: Buffer.from(item.id, "hex"),
      source: item.source,
      actor: BigInt(item.actor.githubUserId),
      gross: item.gross,
      bounty,
    });
  const commit = (
    entry: ScenarioEvidence,
    key: string,
    p: Project,
    item: Award,
    bounty = false,
  ) => send(entry, key, [keys.owner], [commitIx(p, item, bounty)]);
  const bindIx = (
    p: Project,
    actor: TestActor,
    destination: Keypair,
    expectedVersion: bigint,
    networkDomain = network32,
  ) =>
    program.bindWallet({
      payer: identity.publicKey,
      identity: identity.publicKey,
      destination: destination.publicKey,
      project: p.project,
      actor: BigInt(actor.githubUserId),
      network: networkDomain,
      expectedVersion,
      claimDigest: sha256(
        `${p.project.toBase58()}:${actor.githubUserId}:${destination.publicKey.toBase58()}`,
      ),
      expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
    });
  /** The attester and the destination wallet both sign the binding. */
  const bind = async (
    entry: ScenarioEvidence,
    key: string,
    p: Project,
    actor: TestActor,
    destination: Keypair,
    expectedVersion: bigint,
  ) => {
    const record = await send(
      entry,
      key,
      [identity, destination],
      [bindIx(p, actor, destination, expectedVersion)],
    );
    const bound = await binding(p.project, actor);
    if (!bound || bound.version < expectedVersion + 1n)
      throw new Error(`${key}: binding version ${bound?.version}`);
    return record;
  };
  const payIx = (
    p: Project,
    item: Award,
    version: bigint,
    owner: PublicKey,
    bindingVersion?: bigint,
  ) => [
    createAssociatedTokenAccountIdempotentInstruction(
      keys.relayer.publicKey,
      ata(p.mint, owner),
      owner,
      p.mint,
    ),
    program.pay({
      project: p.project,
      awardId: Buffer.from(item.id, "hex"),
      actor: BigInt(item.actor.githubUserId),
      version,
      mint: p.mint,
      vault: p.vault,
      destination: ata(p.mint, owner),
      bindingVersion,
    }),
  ];
  const pay = async (
    entry: ScenarioEvidence,
    key: string,
    p: Project,
    item: Award,
    version: bigint,
    owner: PublicKey,
  ) => {
    const record = await send(
      entry,
      key,
      [keys.relayer],
      payIx(p, item, version, owner),
    );
    const deltas = await chain.tokenDeltas(record.transactionId);
    expectEqual(
      `${key} destination`,
      deltas.get(ata(p.mint, owner).toBase58()),
      item.net,
    );
    // The fee stays in the vault until claim_fees.
    expectEqual(`${key} vault`, deltas.get(p.vault.toBase58()), -item.net);
    return record;
  };
  const claimIx = (p: Project) =>
    program.claimFees({
      project: p.project,
      mint: p.mint,
      vault: p.vault,
      feeAccount: ata(p.mint, ctx.feeRecipient),
    });
  const claim = async (
    entry: ScenarioEvidence,
    key: string,
    p: Project,
    expected: bigint,
  ) => {
    const record = await send(entry, key, [keys.depositor], [claimIx(p)]);
    const deltas = await chain.tokenDeltas(record.transactionId);
    expectEqual(
      `${key} fee account`,
      deltas.get(ata(p.mint, ctx.feeRecipient).toBase58()),
      expected,
    );
    return record;
  };

  // ---- 5. identity key recovery --------------------------------------------
  /**
   * The owner proposes a replacement identity authority for one project, the
   * Config rotation authority confirms it and anyone executes it after the
   * project's rotation delay. The old key can no longer bind, a binding made
   * before the rotation still pays, and the new key binds a destination that
   * pays. The rotation is per project, so no other project changes.
   */
  async function keyRecovery(entry: ScenarioEvidence) {
    if (!process.env.ESCROW_ACCEPTANCE_ROTATION_AUTHORITY_KEY)
      throw new Error(
        "ESCROW_ACCEPTANCE_ROTATION_AUTHORITY_KEY is required for the key-recovery scenario",
      );
    const rotation = Keypair.fromSeed(
      solanaSeed("ESCROW_ACCEPTANCE_ROTATION_AUTHORITY_KEY"),
    );
    if (!rotation.publicKey.equals(ctx.rotationAuthority))
      throw new Error(
        "ESCROW_ACCEPTANCE_ROTATION_AUTHORITY_KEY is not the Config rotation authority",
      );
    // The replacement key signs bindings only; the relayer pays their rent.
    const recovery = wallet("recovery-identity");
    const p = await projectFor(entry, "recovery", scenarioMint);
    const amounts = await amountsFor(scenarioMint);
    await deposit(entry, "recovery", p, 150n * amounts.unit);
    const actors = [0, 1].map((n) => scenarioActor(6, n));
    const items = [
      award(p, "recovery-existing", actors[0], amounts.award(100n)),
      award(p, "recovery-new", actors[1], amounts.award(50n)),
    ];
    const wallets = actors.map((_, n) => wallet(`recovery:${n}`));
    for (const [n, item] of items.entries())
      await commit(entry, `recovery:commit-${n}`, p, item);
    // The binding that exists before the key is lost.
    await bind(entry, "recovery:bind-existing", p, actors[0], wallets[0], 0n);
    const authorities = async () => {
      const info = await connection.getAccountInfo(p.project, "confirmed");
      if (!info) throw new Error("Recovery project missing");
      return {
        identity: new PublicKey(info.data.subarray(104, 136)).toBase58(),
        pending: new PublicKey(info.data.subarray(257, 289)).toBase58(),
        effectiveAt: info.data.readBigInt64LE(289),
        confirmed: info.data[297] === 1,
      };
    };
    await send(
      entry,
      "recovery:propose",
      [keys.owner],
      [
        program.proposeAuthorityRotation({
          owner: keys.owner.publicKey,
          project: p.project,
          next: recovery.publicKey,
        }),
      ],
    );
    await send(
      entry,
      "recovery:confirm",
      [keys.relayer, rotation],
      [
        program.confirmAuthorityRotation({
          rotationAuthority: rotation.publicKey,
          project: p.project,
        }),
      ],
    );
    if (!entry.steps["recovery:execute"]) {
      const pending = await authorities();
      const now = BigInt(Math.floor(Date.now() / 1000));
      if (pending.effectiveAt > now)
        throw new Waiting(
          "recovery: the identity rotation waits for the project rotation delay",
          new Date(Number(pending.effectiveAt) * 1000),
        );
    }
    await send(
      entry,
      "recovery:execute",
      [keys.relayer],
      [program.executeAuthorityRotation(p.project)],
    );
    if (!entry.checks.rotation) {
      const after = await authorities();
      expectEqual(
        "rotated identity authority",
        after.identity,
        recovery.publicKey.toBase58(),
      );
      expectEqual(
        "pending identity authority",
        after.pending,
        PublicKey.default.toBase58(),
      );
      entry.checks.rotation = {
        previous: identity.publicKey.toBase58(),
        current: after.identity,
        rotationAuthority: rotation.publicKey.toBase58(),
        rotationDelaySeconds: text(ctx.rotationDelay),
      };
      await persist();
    }
    // The old key can no longer bind.
    await expectFailure(
      entry,
      "recovery:old-key-refused",
      "ConstraintHasOne",
      identity,
      [bindIx(p, actors[1], wallets[1], 0n)],
      [wallets[1]],
    );
    // The binding made by the old key still pays after the rotation.
    const existing = await pay(
      entry,
      "recovery:pay-existing",
      p,
      items[0],
      1n,
      wallets[0].publicKey,
    );
    // The new key binds; the relayer pays the binding account rent.
    await send(
      entry,
      "recovery:bind-new",
      [keys.relayer, recovery, wallets[1]],
      [
        program.bindWallet({
          payer: keys.relayer.publicKey,
          identity: recovery.publicKey,
          destination: wallets[1].publicKey,
          project: p.project,
          actor: BigInt(actors[1].githubUserId),
          network: network32,
          expectedVersion: 0n,
          claimDigest: sha256(
            `${p.project.toBase58()}:${actors[1].githubUserId}:${wallets[1].publicKey.toBase58()}`,
          ),
          expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
        }),
      ],
    );
    const fresh = await pay(
      entry,
      "recovery:pay-new",
      p,
      items[1],
      1n,
      wallets[1].publicKey,
    );
    const totals = await state(p.project);
    expectEqual(
      "recovery paid",
      totals.paid,
      items.reduce((sum, item) => sum + item.net, 0n),
    );
    expectEqual("recovery reserved", totals.reserved, 0n);
    entry.checks.payments = {
      existingBinding: {
        githubUserId: actors[0].githubUserId,
        boundBy: identity.publicKey.toBase58(),
        paidAfterRotation: existing.transactionId,
        net: text(items[0].net),
      },
      newBinding: {
        githubUserId: actors[1].githubUserId,
        boundBy: recovery.publicKey.toBase58(),
        paid: fresh.transactionId,
        net: text(items[1].net),
      },
    };
    entry.checks.totals = printable(totals);
    await persist();
  }

  // ---- 1. private bounty ---------------------------------------------------
  async function bounty(entry: ScenarioEvidence) {
    for (const [index, mint] of bountyMints.entries()) {
      const name = `bounty-${index}`;
      const amounts = await amountsFor(mint);
      const p = await projectFor(entry, name, mint, { bounty: true });
      expectEqual(`${name} purpose`, (await state(p.project)).purpose, 1);
      await deposit(entry, name, p, amounts.bounty.deposit);
      const actor = scenarioActor(0, index);
      const item: Award = {
        ...award(p, "bounty", actor, amounts.award(100n)),
        fee: amounts.bounty.fee,
        net: amounts.bounty.researcher,
      };
      await expectFailure(
        entry,
        `${name}:ordinary-award-refused`,
        "WrongPurpose",
        keys.owner,
        [commitIx(p, item)],
      );
      await expectFailure(
        entry,
        `${name}:inexact-split-refused`,
        "InvalidAmount",
        keys.owner,
        [commitIx(p, { ...item, gross: item.gross - 2n }, true)],
      );
      await commit(entry, `${name}:commit`, p, item, true);
      const researcher = wallet(`${name}:researcher`);
      await bind(entry, `${name}:bind`, p, actor, researcher, 0n);
      await pay(entry, `${name}:pay`, p, item, 1n, researcher.publicKey);
      const claimed = await claim(
        entry,
        `${name}:claim-fees`,
        p,
        amounts.bounty.fee,
      );
      const after = await state(p.project);
      expectEqual(`${name} paid`, after.paid, amounts.bounty.researcher);
      expectEqual(`${name} fees`, after.payoutFees, amounts.bounty.fee);
      for (const field of [
        "reserved",
        "accruedFees",
        "withdrawnGross",
        "withdrawalFees",
      ] as const)
        expectEqual(`${name} ${field}`, after[field], 0);
      expectEqual(
        `${name} vault balance`,
        await chain.tokenBalance(p.vault),
        0,
      );
      await expectFailure(
        entry,
        `${name}:nothing-left-to-withdraw`,
        "InsufficientFreeBalance",
        keys.owner,
        [
          program.withdraw({
            owner: keys.owner.publicKey,
            project: p.project,
            mint,
            vault: p.vault,
            destination: ata(mint, keys.owner.publicKey),
            gross: 1n,
          }),
        ],
      );
      entry.checks[name] = {
        mint: mint.toBase58(),
        project: p.project.toBase58(),
        gross: text(item.gross),
        researcherReceived: text(amounts.bounty.researcher),
        slopFeeClaimed: text(amounts.bounty.fee),
        feeAccount: ata(mint, ctx.feeRecipient).toBase58(),
        feeClaimTransaction: claimed.transactionId,
        researcher: researcher.publicKey.toBase58(),
        state: printable(after),
      };
      await persist();
    }
  }

  // ---- 2. monthly commitment -----------------------------------------------
  async function monthly(entry: ScenarioEvidence) {
    const mint = scenarioMint;
    const amounts = await amountsFor(mint);
    const p = await projectFor(entry, "monthly", mint);
    const projectId = `acceptance-${run.runId.slice(0, 8)}-monthly`;
    const deployment = {
      ...solanaDeploymentRecord(
        ctx,
        p.project,
        mint,
        0n,
        entry.steps["monthly:initialize"].transactionId,
      ),
    } as EscrowDeployment;
    const services = solanaServices(ctx, join(directory, "monthly"), () => [
      { projectId, effectiveCycle: run.startedAt.slice(0, 7), deployment },
    ]);
    services.refresh();
    await deposit(entry, "monthly", p, 500n * amounts.unit);
    const cap = 300n * amounts.unit;
    const actors = [0, 1, 2].map((n) => scenarioActor(1, n));
    const items = [
      award(p, "monthly-x", actors[0], amounts.award(100n)),
      award(p, "monthly-y", actors[1], amounts.award(100n)),
      award(p, "monthly-z", actors[2], amounts.award(50n)),
    ];
    const entries = (list: Award[]) =>
      list.map((item) => ({
        githubUserId: item.actor.githubUserId,
        grossMicro: text(item.gross),
        sourceDigest: item.source.toString("hex"),
      }));
    // A finalized slot always has its block time; the program only needs frozen_at <= now.
    const now = async () =>
      BigInt(
        (await connection.getBlockTime(
          await connection.getSlot("finalized"),
        )) ?? 0,
      );
    const periods =
      (entry.checks.periods as ReturnType<typeof openMonthlyPeriod>) ??
      openMonthlyPeriod(await now());
    entry.checks.periods = periods;
    const message = (
      period: string,
      list: ReturnType<typeof entries>,
      frozenAt: bigint,
    ) =>
      solanaMonthlyMessage(
        ctx.programId.toBase58(),
        p.project.toBase58(),
        period,
        solanaAllocationRoot(list),
        solanaAllocationTotal(list),
        text(frozenAt),
        ctx.networkDomain,
      );
    const commitMonthlyIx = (
      period: string,
      list: ReturnType<typeof entries>,
      frozenAt: bigint,
      signedList = list,
    ) => {
      const signed = message(period, signedList, frozenAt);
      return program.commitMonthly({
        payer: keys.depositor.publicKey,
        project: p.project,
        vault: p.vault,
        period: Number(period.replace("-", "")),
        root: Buffer.from(solanaAllocationRoot(list), "hex"),
        total: BigInt(solanaAllocationTotal(list)),
        frozenAt,
        authority: identity.publicKey,
        signature: ed25519.sign(signed, ctx.identitySeed),
        signedMessage: signed,
      });
    };
    const full = entries(items);
    const simulated = async (period: string, list = full, signedList = list) =>
      failure(
        keys.depositor,
        commitMonthlyIx(period, list, (await now()) - 30n, signedList),
      );
    const setMonthly = (key: string, value: bigint, enabled: boolean) =>
      send(
        entry,
        key,
        [keys.owner],
        [
          program.setMonthlyCommitment(
            keys.owner.publicKey,
            p.project,
            value,
            enabled,
          ),
        ],
      );
    if (!entry.checks.offAtCreation) {
      expectEqual(
        "monthly enabled at creation",
        (await state(p.project)).monthlyEnabled,
        false,
      );
      entry.checks.offAtCreation = {
        monthlyEnabled: false,
        error: await simulated(periods.open),
      };
      expectEqual(
        "commit while off",
        (entry.checks.offAtCreation as { error: string }).error,
        "MonthlyDisabled",
      );
    }
    await expectFailure(
      entry,
      "zero-cap-refused",
      "InvalidAmount",
      keys.owner,
      [program.setMonthlyCommitment(keys.owner.publicKey, p.project, 0n, true)],
    );
    await setMonthly("monthly:on", cap, true);
    if (!entry.checks.window) {
      entry.checks.window = {
        period: periods.open,
        nextPeriod: periods.next,
        nextPeriodError: await simulated(periods.next),
        closedPeriod: periods.closed,
        closedPeriodError: await simulated(periods.closed),
      };
      const window = entry.checks.window as Record<string, string>;
      expectEqual("next period", window.nextPeriodError, "MonthlyWindowClosed");
      expectEqual(
        "closed period",
        window.closedPeriodError,
        "MonthlyWindowClosed",
      );
    }
    const edited = entries([
      items[0],
      { ...items[1], gross: 120n * amounts.unit },
      items[2],
    ]);
    if (!entry.checks["edited-allocation-refused"]) {
      entry.checks["edited-allocation-refused"] = {
        error: await simulated(periods.open, edited, full),
      };
      expectEqual(
        "edited allocation",
        (entry.checks["edited-allocation-refused"] as { error: string }).error,
        "InvalidAttestation",
      );
    }
    await setMonthly("monthly:cap-lowered", 200n * amounts.unit, true);
    if (!entry.checks["over-cap-refused"]) {
      entry.checks["over-cap-refused"] = {
        error: await simulated(periods.open),
      };
      expectEqual(
        "over cap",
        (entry.checks["over-cap-refused"] as { error: string }).error,
        "MonthlyCapExceeded",
      );
    }
    await setMonthly("monthly:cap-restored", cap, true);
    await setMonthly("monthly:opt-out", cap, false);
    if (!entry.checks["opted-out-refused"]) {
      entry.checks["opted-out-refused"] = {
        error: await simulated(periods.open),
      };
      expectEqual(
        "opted out",
        (entry.checks["opted-out-refused"] as { error: string }).error,
        "MonthlyDisabled",
      );
    }
    await setMonthly("monthly:opt-in", cap, true);
    // Manual path first: the owner commits and pays the first award itself.
    const wallets = actors.map((_, n) => wallet(`monthly:${n}`));
    const manual = await commit(entry, "monthly:manual-commit-x", p, items[0]);
    await bind(entry, "monthly:bind-x", p, actors[0], wallets[0], 0n);
    await pay(
      entry,
      "monthly:manual-pay-x",
      p,
      items[0],
      1n,
      wallets[0].publicKey,
    );
    // The production attester freezes the allocation at one finalized slot.
    await ready(() => chain.waitFinalized(manual.transactionId));
    const config = await preflightSolanaDeployment(
      {
        PAYMENT_DEPLOYMENTS: services.pinned(),
        PAYMENT_RPC_URLS: services.env.PAYMENT_RPC_URLS,
      },
      { network, vault: p.vault.toBase58() },
    );
    const plan = (list: ReturnType<typeof entries>, frozenAt?: string) => ({
      request: {
        projectId,
        period: periods.open,
        network: network as EscrowDeployment["network"],
        snapshotSha256: sha256Text(JSON.stringify(list)),
      },
      deployment,
      allocationRoot: solanaAllocationRoot(list),
      messageHex: frozenAt
        ? Buffer.from(message(periods.open, list, BigInt(frozenAt))).toString(
            "hex",
          )
        : "",
      family: "solana" as const,
      totalGrossBase: solanaAllocationTotal(list),
      ...(frozenAt ? { frozenAt } : {}),
      entries: list,
    });
    // A changed award for the manually committed source is refused at the freeze.
    if (!entry.checks["changed-manual-award-refused"]) {
      const changed = entries([
        { ...items[0], gross: 110n * amounts.unit },
        items[1],
        items[2],
      ]);
      let refusal = "accepted";
      try {
        await freezeSolanaMonthly(config, plan(changed));
      } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
      }
      if (!/already consumed/.test(refusal))
        throw new Error(`Changed manual award: ${refusal}`);
      entry.checks["changed-manual-award-refused"] = { error: refusal };
      await persist();
    }
    const frozenAt =
      (entry.checks.frozenAt as string) ??
      (await freezeSolanaMonthly(config, plan(full)));
    entry.checks.frozenAt = frozenAt;
    const authorization = {
      plan: plan(full, frozenAt),
      signatureHex: Buffer.from(
        ed25519.sign(
          message(periods.open, full, BigInt(frozenAt)),
          ctx.identitySeed,
        ),
      ).toString("hex"),
    };
    const submit = async () => {
      const response = await services.relayer.fetch(
        new Request("https://payments-executor.internal/v1/commit-monthly", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(authorization),
        }),
      );
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok)
        throw new Waiting(`monthly executor refused: ${JSON.stringify(body)}`);
      return body;
    };
    const month = program.month(
      p.project,
      Number(periods.open.replace("-", "")),
    );
    const monthState = async () => {
      const info = await connection.getAccountInfo(month, "confirmed");
      if (!info) return null;
      return {
        committed: info.data.readBigUInt64LE(76),
        total: info.data.readBigUInt64LE(84),
        released: info.data.readBigUInt64LE(92),
        frozenAt: info.data.readBigInt64LE(100),
      };
    };
    const submissions = (entry.checks.submissions as unknown[]) ?? [];
    entry.checks.submissions = submissions;
    if (!entry.checks.automatic) {
      if (entry.checks.monthlyReservedBefore === undefined) {
        if (await monthState())
          throw new Error(
            "This monthly allocation started without a saved reserve baseline. Preserve this evidence and use a new run to prove the complete allocation.",
          );
        entry.checks.monthlyReservedBefore = text(
          (await state(p.project)).reserved,
        );
        await persist();
      }
      const reservedBefore = BigInt(
        entry.checks.monthlyReservedBefore as string,
      );
      await ready(async () => {
        const result = await submit();
        submissions.push(result);
        await persist();
        if (result.alreadyCommitted === true) return;
        // Between admission and the last leaf the owner cannot commit by hand.
        const m = await monthState();
        if (
          m &&
          m.committed < m.total &&
          !entry.checks["manual-commit-while-outstanding-refused"]
        ) {
          const blocked = await failure(keys.owner, [
            commitIx(
              p,
              award(p, "monthly-late", actors[2], amounts.award(50n)),
            ),
          ]);
          entry.checks["manual-commit-while-outstanding-refused"] = {
            error: blocked,
          };
          expectEqual(
            "manual commit while outstanding",
            blocked,
            "MonthlyOutstanding",
          );
        }
        throw new Waiting("monthly allocation settles leaf by leaf");
      });
      const m = await monthState();
      const after = await state(p.project);
      if (!m) throw new Error("Monthly allocation account missing");
      expectEqual(
        "month total",
        m.total,
        items.reduce((s, i) => s + i.gross, 0n),
      );
      expectEqual("month settled", m.committed, m.total);
      // The manually paid award is released, not reserved again.
      expectEqual("month released", m.released, items[0].gross);
      expectEqual(
        "reserved by monthly",
        after.reserved - reservedBefore,
        items[1].gross + items[2].gross,
      );
      expectEqual("outstanding", after.monthlyOutstanding, 0);
      entry.checks.automatic = {
        period: periods.open,
        month: month.toBase58(),
        frozenAt,
        allocationRoot: authorization.plan.allocationRoot,
        state: printable(m),
        reservedBefore: text(reservedBefore),
        reservedAfter: text(after.reserved),
        transactions: submissions,
      };
      await persist();
    }
    if (!entry.checks.replay) {
      const again = await ready(submit);
      entry.checks.replay = {
        executor: again,
        error: await simulated(periods.open),
      };
      if (again.alreadyCommitted !== true)
        throw new Error("Executor replay was not already committed");
      await persist();
    }
    for (const n of [1, 2]) {
      await bind(entry, `monthly:bind-${n}`, p, actors[n], wallets[n], 0n);
      await pay(
        entry,
        `monthly:pay-${n}`,
        p,
        items[n],
        1n,
        wallets[n].publicKey,
      );
    }
    for (const n of [0, 1, 2])
      await expectFailure(
        entry,
        `second-payment-${n}-refused`,
        "AlreadyPaid",
        keys.relayer,
        payIx(p, items[n], 1n, wallets[n].publicKey),
      );
    const after = await state(p.project);
    expectEqual(
      "monthly paid",
      after.paid,
      items.reduce((s, i) => s + i.net, 0n),
    );
    expectEqual(
      "monthly fees",
      after.payoutFees,
      items.reduce((s, i) => s + i.fee, 0n),
    );
    expectEqual("monthly reserved", after.reserved, 0);
    entry.checks.state = printable(after);
    entry.checks.awards = items.map((item, n) => ({
      githubUserId: item.actor.githubUserId,
      gross: text(item.gross),
      net: text(item.net),
      fee: text(item.fee),
      destination: wallets[n].publicKey.toBase58(),
      path:
        n === 0
          ? "manual commit and payment before the freeze; released by the monthly allocation"
          : "automatic commitment",
    }));
    await persist();
  }

  // ---- 3. walletless destination lifecycle ---------------------------------
  async function lifecycle(entry: ScenarioEvidence) {
    const mint = scenarioMint;
    const amounts = await amountsFor(mint);
    const p = await projectFor(entry, "lifecycle", mint);
    await deposit(entry, "lifecycle", p, 100n * amounts.unit);
    const actor = scenarioActor(2, 0);
    const item = award(p, "lifecycle", actor, amounts.award(50n));
    await commit(entry, "lifecycle:commit", p, item);
    const [w1, w2, w3] = [1, 2, 3].map((n) => wallet(`lifecycle:${n}`));
    await expectFailure(
      entry,
      "walletless-unpayable",
      /AccountNotInitialized|binding/,
      keys.relayer,
      payIx(p, item, 1n, w1.publicKey),
    );
    await expectFailure(
      entry,
      "wrong-network-refused",
      "WrongNetwork",
      identity,
      [
        bindIx(
          p,
          actor,
          w1,
          0n,
          sha256("slop-escrow-acceptance:solana-mainnet"),
        ),
      ],
      [w1],
    );
    await bind(entry, "lifecycle:bind-1", p, actor, w1, 0n);
    const replaced = await bind(entry, "lifecycle:replace-2", p, actor, w2, 1n);
    const afterReplace = await binding(p.project, actor);
    expectEqual(
      "replacement activation",
      afterReplace && afterReplace.version >= 2n ? "bound" : "missing",
      "bound",
    );
    await expectFailure(
      entry,
      "stale-version-bind-refused",
      "StaleBinding",
      identity,
      [bindIx(p, actor, w3, 1n)],
      [w3],
    );
    await expectFailure(
      entry,
      "stale-version-pay-refused",
      "StaleBinding",
      keys.relayer,
      payIx(p, item, 1n, w2.publicKey, 2n),
    );
    // Zero binding delay (owner decision): the owner has no veto window.
    await expectFailure(
      entry,
      "veto-without-window-refused",
      "BindingActive",
      keys.owner,
      [
        program.vetoBinding({
          owner: keys.owner.publicKey,
          project: p.project,
          actor: BigInt(actor.githubUserId),
          version: 2n,
          awardId: Buffer.from(item.id, "hex"),
        }),
      ],
    );
    const recovered = await bind(
      entry,
      "lifecycle:recover-3",
      p,
      actor,
      w3,
      2n,
    );
    const paid = await pay(entry, "lifecycle:pay-3", p, item, 3n, w3.publicKey);
    for (const [label, w] of [
      ["first", w1],
      ["replaced", w2],
    ] as const)
      expectEqual(
        `${label} wallet received`,
        await chain.tokenBalance(ata(mint, w.publicKey)),
        0,
      );
    entry.checks.lifecycle = {
      actor: actor.githubUserId,
      wallets: [w1, w2, w3].map((w) => w.publicKey.toBase58()),
      replacedAt: text(await slotTime(replaced.block)),
      recoveredAt: text(await slotTime(recovered.block)),
      paidAt: text(await slotTime(paid.block)),
      bindingDelaySeconds: "0",
    };
    await persist();
    if (reviewDelay === 0n) {
      entry.checks.reviewWindow =
        "not run: ESCROW_ACCEPTANCE_REVIEW_DELAY_SECONDS is not set";
      return;
    }
    // Veto and recover inside a review window: a project whose only
    // difference is its binding delay. A run interrupted past the window
    // continues in a new project.
    const attempt = Number(entry.checks.reviewAttempt ?? 0);
    const label = attempt ? `lifecycle-review-${attempt}` : "lifecycle-review";
    const review = await projectFor(entry, label, mint, {
      bindingDelay: reviewDelay,
    });
    await deposit(entry, label, review, 100n * amounts.unit);
    const reviewActor = scenarioActor(2, 1);
    const reviewItem = award(review, label, reviewActor, amounts.award(50n));
    const committed = await commit(
      entry,
      `${label}:commit`,
      review,
      reviewItem,
    );
    const [r1, r2] = [1, 2].map((n) => wallet(`${label}:${n}`));
    await bind(entry, `${label}:bind-1`, review, reviewActor, r1, 0n);
    const maturesAt = (await slotTime(committed.block)) + reviewDelay;
    if (!entry.steps[`${label}:veto-1`]) {
      const time = BigInt(Math.floor(Date.now() / 1000));
      if (time + 30n >= maturesAt) {
        entry.checks.reviewAttempt = attempt + 1;
        await persist();
        throw new Waiting(
          "the review window passed before the veto; the next run uses a new review project",
        );
      }
    }
    await send(
      entry,
      `${label}:veto-1`,
      [keys.owner],
      [
        program.vetoBinding({
          owner: keys.owner.publicKey,
          project: review.project,
          actor: BigInt(reviewActor.githubUserId),
          version: 1n,
          awardId: Buffer.from(reviewItem.id, "hex"),
        }),
      ],
    );
    await expectFailure(
      entry,
      "review:veto-again-refused",
      /already in use|0x0/,
      keys.owner,
      [
        program.vetoBinding({
          owner: keys.owner.publicKey,
          project: review.project,
          actor: BigInt(reviewActor.githubUserId),
          version: 1n,
          awardId: Buffer.from(reviewItem.id, "hex"),
        }),
      ],
    );
    await ready(async () => {
      const time = BigInt(Math.floor(Date.now() / 1000));
      if (time < maturesAt + 5n)
        throw new Waiting(
          `review award matures at ${maturesAt}`,
          new Date(Number(maturesAt + 5n) * 1000),
        );
    });
    await expectFailure(
      entry,
      "review:vetoed-version-refused",
      "BindingVetoed",
      keys.relayer,
      payIx(review, reviewItem, 1n, r1.publicKey),
    );
    await bind(entry, `${label}:recover-2`, review, reviewActor, r2, 1n);
    await pay(entry, `${label}:pay-2`, review, reviewItem, 2n, r2.publicKey);
    entry.checks.reviewWindow = {
      project: review.project.toBase58(),
      bindingDelaySeconds: text(reviewDelay),
      actor: reviewActor.githubUserId,
      vetoed: entry.steps[`${label}:veto-1`].transactionId,
      vetoedWallet: r1.publicKey.toBase58(),
      recoveredTo: r2.publicKey.toBase58(),
    };
    await persist();
  }

  // ---- 4-6. production dispatch: interrupted send, failed recipient, frozen fee
  async function dispatch(
    interrupted: ScenarioEvidence,
    failed: ScenarioEvidence,
    frozen: ScenarioEvidence,
  ) {
    const proxy = new FaultRpc(ctx.rpcUrl);
    try {
      const deployments: Record<string, EscrowDeployment> = {};
      const services = solanaServices(
        ctx,
        join(directory, "dispatch"),
        () =>
          Object.entries(deployments).map(([name, deployment]) => ({
            projectId: `acceptance-${run.runId.slice(0, 8)}-${name}`,
            effectiveCycle: run.startedAt.slice(0, 7),
            deployment,
          })),
        proxy.url,
      );
      const { projection, env, deps } = services;
      const setUp = async (
        entry: ScenarioEvidence,
        name: string,
        mint: PublicKey,
        units: bigint[],
        actorSet: number,
      ) => {
        const amounts = await amountsFor(mint);
        const p = await projectFor(entry, name, mint);
        deployments[name] = {
          ...solanaDeploymentRecord(
            ctx,
            p.project,
            mint,
            0n,
            entry.steps[`${name}:initialize`].transactionId,
          ),
        } as EscrowDeployment;
        services.refresh();
        await deposit(
          entry,
          name,
          p,
          units.reduce((s, u) => s + u, 0n) * amounts.unit,
        );
        const items = units.map((u, n) =>
          award(
            p,
            `${name}-${n}`,
            scenarioActor(actorSet, n),
            amounts.award(u),
          ),
        );
        for (const [n, item] of items.entries())
          await commit(entry, `${name}:commit-${n}`, p, item);
        const wallets = items.map((_, n) => wallet(`${name}:${n}`));
        const seeds = items.map((_, n) => walletSeed(`${name}:${n}`));
        return { p, items, wallets, seeds };
      };
      const lost = await setUp(
        interrupted,
        "interrupted",
        scenarioMint,
        [50n],
        3,
      );
      const blocked = await setUp(
        failed,
        "failed",
        freezable,
        [100n, 100n, 50n],
        4,
      );
      frozen.vaults.failed = blocked.p.vault.toBase58();
      if (!frozen.assets.includes(freezable.toBase58()))
        frozen.assets.push(freezable.toBase58());
      const tokenAccount = (n: number) =>
        ata(freezable, blocked.wallets[n].publicKey);
      const feeAccount = ata(freezable, ctx.feeRecipient);
      // The second recipient's token account is frozen before any dispatch.
      await send(
        failed,
        "failed:freeze-recipient-2",
        [keys.owner],
        [
          createAssociatedTokenAccountIdempotentInstruction(
            keys.owner.publicKey,
            tokenAccount(1),
            blocked.wallets[1].publicKey,
            freezable,
          ),
          createFreezeAccountInstruction(
            tokenAccount(1),
            freezable,
            keys.owner.publicKey,
          ),
        ],
      );
      for (const [set, entry] of [
        [lost, interrupted],
        [blocked, failed],
      ] as const)
        for (const [n, item] of set.items.entries())
          if (!entry.checks[`registered-${n}`]) {
            const seed = set.seeds[n];
            const claimed = await projection.registerWallet(
              item.actor,
              "solana",
              set.wallets[n].publicKey.toBase58(),
              async (message) =>
                Buffer.from(
                  ed25519.sign(new TextEncoder().encode(message), seed),
                ).toString("base64"),
              deps,
            );
            entry.checks[`registered-${n}`] = {
              claimId: claimed.claimId,
              wallet: set.wallets[n].publicKey.toBase58(),
            };
            await persist();
          }
      const ledger = (id: string) => projection.obligation(id)?.state ?? "none";
      // Lose the answer to the first broadcast of the interrupted award's payment.
      const awardAccount = program.award(
        lost.p.project,
        Buffer.from(lost.items[0].id, "hex"),
      );
      if (!interrupted.checks.lostResponse)
        proxy.arm({
          send: "sendTransaction",
          lookups: ["getSignatureStatuses"],
          match: (call) => {
            const raw = Buffer.from(String(call.params[0]), "base64");
            // The pay instruction writes the award account; bindings never do.
            return (
              raw.includes(awardAccount.toBuffer()) &&
              raw.includes(sha256("global:pay").subarray(0, 8))
            );
          },
          onLoss: async (call, upstream) => {
            const raw = Buffer.from(String(call.params[0]), "base64");
            interrupted.checks.lostResponse = {
              transactionId: solanaBase58(raw.subarray(1, 65)),
              nodeAnswerDiscarded: upstream.slice(0, 200),
              at: new Date().toISOString(),
            };
            await persist();
          },
        });
      const cosigned = new Set<string>();
      const tick = async () => {
        const errors = await runPaymentsCron(env);
        if (interrupted.checks.lostResponse && !interrupted.checks.restarted) {
          services.restart();
          interrupted.checks.restarted = new Date().toISOString();
          await persist();
        }
        // Each wallet co-signs the attester's prepared binding once an attempt exists.
        for (const [set] of [[lost], [blocked]] as const)
          for (const [n, item] of set.items.entries()) {
            if (cosigned.has(item.id) || !projection.attempts(item.id).length)
              continue;
            if (await binding(set.p.project, item.actor)) {
              cosigned.add(item.id);
              continue;
            }
            try {
              await cosignSolanaBinding({
                projection,
                actor: item.actor,
                seed: set.seeds[n],
                obligationId: item.id,
                deps,
              });
              cosigned.add(item.id);
            } catch (error) {
              errors.push(
                `cosign ${item.actor.githubUserId}: ${error instanceof Error ? error.message : error}`,
              );
            }
          }
        return errors;
      };
      const cronErrors: string[] = [];
      if (!failed.checks.phase1) {
        await ready(async () => {
          const errors = await tick();
          cronErrors.push(...errors);
          const states = [lost.items[0], ...blocked.items].map((i) =>
            ledger(i.id),
          );
          if (
            states[0] === "paid" &&
            states[1] === "paid" &&
            states[3] === "paid"
          )
            return;
          throw new Waiting(
            `dispatch phase 1: ledger ${states.join(",")}${errors.length ? ` (cron: ${[...new Set(errors)].slice(0, 3).join(" | ")})` : ""}`,
          );
        });
        const second = blocked.items[1];
        const s = await state(blocked.p.project);
        expectEqual(
          "frozen recipient unpaid",
          await chain.tokenBalance(tokenAccount(1)),
          0,
        );
        expectEqual("frozen award still reserved", s.reserved, second.gross);
        failed.checks.phase1 = {
          paid: [0, 2].map((n) => ({
            githubUserId: blocked.items[n].actor.githubUserId,
            ledger: ledger(blocked.items[n].id),
            transaction: projection.obligation(blocked.items[n].id)
              ?.paid_transaction,
          })),
          blocked: {
            githubUserId: second.actor.githubUserId,
            ledger: ledger(second.id),
            outbox: projection.outbox(second.id),
            attempts: projection.attempts(second.id),
            reserved: text(s.reserved),
          },
          cronErrors: [...new Set(cronErrors)].slice(0, 10),
        };
        await persist();
      }
      if (!interrupted.checks.result) {
        const item = lost.items[0];
        const lossRecord = interrupted.checks.lostResponse as
          | { transactionId: string }
          | undefined;
        if (!lossRecord)
          throw new Error("The payment broadcast answer was never lost");
        const attempts = projection.attempts(item.id);
        const obligation = projection.obligation(item.id);
        const journaled = await services.relayerJournal.get<{
          transactionId: string;
        }>(`solana:relayer:${network}:${attempts[0]?.id}`);
        // Every successful transaction that wrote the award account: the commit and one payment.
        const signatures = await connection.getSignaturesForAddress(
          awardAccount,
          {},
          "confirmed",
        );
        const succeeded = signatures
          .filter((s) => s.err === null)
          .map((s) => s.signature);
        const payments = succeeded.filter(
          (s) => s !== interrupted.steps["interrupted:commit-0"].transactionId,
        );
        expectEqual("attempts", attempts.length, 1);
        expectEqual("payments", payments.length, 1);
        expectEqual(
          "paid transaction is the lost one",
          payments[0],
          lossRecord.transactionId,
        );
        expectEqual(
          "ledger transaction",
          obligation?.paid_transaction,
          lossRecord.transactionId,
        );
        expectEqual(
          "journaled transaction",
          journaled?.transactionId,
          lossRecord.transactionId,
        );
        expectEqual(
          "wallet received once",
          // The movement of this payment only: the wallet comes from the reused actor key.
          (await chain.tokenDeltas(lossRecord.transactionId)).get(
            ata(scenarioMint, lost.wallets[0].publicKey).toBase58(),
          ),
          item.net,
        );
        interrupted.steps["interrupted:pay"] = {
          transactionId: lossRecord.transactionId,
          from: keys.relayer.publicKey.toBase58(),
          status: "success",
          note: "Signed once by the production executor; its broadcast answer was discarded and the next status lookup failed, then the cron recovered the journaled attempt",
        };
        interrupted.checks.result = {
          attempts,
          payments,
          ledger: obligation?.state,
          walletReceived: text(item.net),
          secondPayment: await failure(
            keys.relayer,
            payIx(lost.p, item, 1n, lost.wallets[0].publicKey),
          ),
        };
        expectEqual(
          "second payment",
          (interrupted.checks.result as { secondPayment: string })
            .secondPayment,
          "AlreadyPaid",
        );
        await persist();
      }
      // Phase 2: freeze the fee recipient's token account, thaw the second
      // recipient's. Fees cannot be claimed, yet the waiting payout proceeds.
      await send(
        frozen,
        "frozen:freeze-fee-account",
        [keys.owner],
        [
          createFreezeAccountInstruction(
            feeAccount,
            freezable,
            keys.owner.publicKey,
          ),
          createThawAccountInstruction(
            tokenAccount(1),
            freezable,
            keys.owner.publicKey,
          ),
        ],
      );
      await expectFailure(
        frozen,
        "claim-refused",
        /frozen|0x11/,
        keys.depositor,
        [claimIx(blocked.p)],
      );
      await send(
        frozen,
        "frozen:claim-fees-failed",
        [keys.depositor],
        [claimIx(blocked.p)],
        "reverted",
      );
      /**
       * The retried attempt can hold a transaction the node never accepted
       * (its preflight failed while the account was frozen). Once its
       * blockhash has expired it can never land, and nothing signs again.
       */
      const stuckAttempt = async () => {
        const [attempt] = projection.attempts(blocked.items[1].id);
        if (attempt?.state !== "submitted" || !attempt.transaction_id)
          return null;
        const status = (
          await connection.getSignatureStatuses([attempt.transaction_id], {
            searchTransactionHistory: true,
          })
        ).value[0];
        const journaled = await services.relayerJournal.get<{
          lastValidBlockHeight: number;
        }>(`solana:relayer:${network}:${attempt.id}`);
        const height = await connection.getBlockHeight("finalized");
        if (status || !journaled || height <= journaled.lastValidBlockHeight)
          return null;
        return {
          attempt,
          landed: false,
          lastValidBlockHeight: journaled.lastValidBlockHeight,
          finalizedBlockHeight: height,
          outbox: projection.outbox(blocked.items[1].id),
        };
      };
      if (!failed.checks.phase2 && !failed.checks.stuck) {
        await ready(async () => {
          const errors = await tick();
          if (ledger(blocked.items[1].id) === "paid") return;
          const stuck = await stuckAttempt();
          if (stuck) {
            failed.checks.stuck = stuck;
            return;
          }
          throw new Waiting(
            `dispatch phase 2: frozen recipient ${ledger(blocked.items[1].id)}${errors.length ? ` (cron: ${[...new Set(errors)].slice(0, 3).join(" | ")})` : ""}`,
          );
        });
        await persist();
      }
      if (!failed.checks.phase2 && !failed.checks.stuck) {
        const item = blocked.items[1];
        expectEqual("retried attempts", projection.attempts(item.id).length, 1);
        const paidTransaction = projection.obligation(
          item.id,
        )?.paid_transaction;
        if (!paidTransaction)
          throw new Error("Second recipient payment has no transaction");
        expectEqual(
          "second recipient received",
          (await chain.tokenDeltas(paidTransaction)).get(
            tokenAccount(1).toBase58(),
          ),
          item.net,
        );
        failed.checks.phase2 = {
          githubUserId: item.actor.githubUserId,
          attempts: projection.attempts(item.id),
          paidTransaction: projection.obligation(item.id)?.paid_transaction,
          paidWhileFeeAccountFrozen: true,
        };
        frozen.checks.payoutDuringFreeze = failed.checks.phase2;
        await persist();
      }
      await send(
        frozen,
        "frozen:thaw-fee-account",
        [keys.owner],
        [
          createThawAccountInstruction(
            feeAccount,
            freezable,
            keys.owner.publicKey,
          ),
        ],
      );
      const stuck = failed.checks.stuck !== undefined;
      const paidItems = stuck
        ? [blocked.items[0], blocked.items[2]]
        : blocked.items;
      const fees = paidItems.reduce((sum, item) => sum + item.fee, 0n);
      const claimed = await claim(frozen, "frozen:claim-fees", blocked.p, fees);
      await claim(
        interrupted,
        "interrupted:claim-fees",
        lost.p,
        lost.items[0].fee,
      );
      interrupted.checks.complete = true;
      const after = await state(blocked.p.project);
      expectEqual(
        "failed project paid",
        after.paid,
        paidItems.reduce((s, i) => s + i.net, 0n),
      );
      frozen.checks.claimed = {
        amount: text(fees),
        transaction: claimed.transactionId,
        state: printable(after),
      };
      failed.checks.state = printable(after);
      await persist();
      if (stuck)
        throw new Error(
          "The frozen recipient's retried payment is stuck: the executor journaled a transaction whose preflight failed, the cron recovery recorded it as submitted, and its blockhash expired without it landing. Nothing signs a new attempt, so the reserved award is not paid after the account thaws; no payout ran while the fee account was frozen.",
        );
      expectEqual(
        "failed vault balance",
        await chain.tokenBalance(blocked.p.vault),
        0,
      );
      failed.checks.complete = true;
      frozen.checks.complete = true;
      await persist();
    } finally {
      proxy.stop();
    }
  }

  const finalize = async (entry: ScenarioEvidence) => {
    const signatures = new Map<string, "success" | "reverted">();
    const include = (
      signature: string,
      expected: "success" | "reverted" = "success",
    ) => {
      const previous = signatures.get(signature);
      if (previous !== undefined && previous !== expected)
        throw new Error(`Conflicting outcomes for ${signature}`);
      signatures.set(signature, expected);
    };
    for (const step of Object.values(entry.steps)) {
      if (!step.status)
        throw new Waiting(`${step.transactionId} has no recorded outcome`);
      include(step.transactionId, step.status);
    }
    // The production monthly executor and dispatcher record their signatures
    // outside the direct-send steps. Their receipts need the same finality gate.
    for (const submission of (entry.checks.submissions ?? []) as {
      transactionId?: string | null;
      transactionIds?: string[];
    }[]) {
      if (submission.transactionId) include(submission.transactionId);
      for (const signature of submission.transactionIds ?? [])
        include(signature);
    }
    const phase1 = entry.checks.phase1 as
      | { paid: { transaction: string }[] }
      | undefined;
    for (const payment of phase1?.paid ?? []) include(payment.transaction);
    const phase2 = entry.checks.phase2 as
      | { paidTransaction: string }
      | undefined;
    if (phase2) include(phase2.paidTransaction);
    const transactions = [];
    for (const [signature, expected] of signatures) {
      const receipt = await connection.getTransaction(signature, {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      });
      if (!receipt?.meta)
        throw new Waiting(`${signature} waits for finalized receipt metadata`);
      if (receipt.transaction.signatures[0] !== signature)
        throw new Error(`Finalized receipt identity differs for ${signature}`);
      const status = receipt.meta.err === null ? "success" : "reverted";
      if (status !== expected)
        throw new Error(
          `Finalized transaction ${signature} ${status}, expected ${expected}`,
        );
      transactions.push({
        transactionId: signature,
        slot: receipt.slot,
        status,
      });
    }
    entry.checks.finality = { commitment: "finalized", transactions };
    await persist();
  };

  try {
    await runScenarios(
      run,
      persist,
      localOnly
        ? [[["key-recovery"], keyRecovery]]
        : [
            [["bounty"], bounty],
            [["walletless-lifecycle"], lifecycle],
            [["monthly"], monthly],
            [
              [
                "interrupted-send",
                "failed-recipient",
                "frozen-fee-destination",
              ],
              dispatch,
            ],
            [["key-recovery"], keyRecovery],
          ],
      // Poll for finality within the wait budget, as the EVM leg does.
      (entry) => ready(() => finalize(entry)),
    );
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
}
