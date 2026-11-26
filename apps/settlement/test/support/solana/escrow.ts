// spec/settlement/escrow.md, "Events apply once, in canonical block and event order"; spec/settlement/escrow.md, "On Solana an uncommittable leaf returns to free funds and a later hand commit strands it"; spec/settlement/monthlyCommitment.md, "Solana signs one freeze time and refuses a month whose source is already consumed"; spec/contracts/solanaEscrow.md, "The pre-pledge build's 332-byte project grows to the current layout with no open pledges"; spec/contracts/solanaEscrow.md, "The owner pledges free funds to one period from the current one to eleven months ahead, raising and never lowering"
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { type Account, type Address, type Blockhash, type FetchedTransaction, type Signature, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, decodeTokenAccount } from "@repo/platform/chain/solana";
import { PRE_PLEDGE_PROJECT_SIZE, PROJECT_SIZE, type ProjectAccount, decodeAward, decodeBinding, decodeMarker, decodeMonth, decodeMonthPledgePresence, decodeOrigin, decodeProject, decodeVault, isInitialized } from "../../../src/chain/solana/accounts.ts";
import { type MonthlyEntry, solanaAllocationRoot } from "../../../src/chain/solana/allocationRoot.ts";
import { type Digest, type I64, type U64, digestBytes, digestOf, i64le, u32le, u64le, utf8 } from "../../../src/chain/solana/bytes.ts";
import { type EscrowCall, type LeafArguments, type PayAsset, type WalletBindingTerms, anchorData, bindWallet, commitAward, commitMonthlyAward, decodeEscrowCall, escrowInvocations, meta, payAward, releaseMonthlyAward, sameInstruction, setMonthlyCommitment } from "../../../src/chain/solana/instructions.ts";
import { type MonthlyAttestation, admitMonth, bindingMessage, solanaMonthlyMessage } from "../../../src/chain/solana/messages.ts";
import { type Purpose, type TokenProgram, PURPOSE_BYTE, awardAddress, awardId, bindingAddress, configAddress, keyBytes, monthAddress, monthPledgeAddress, monthlySourceAddress, originAddress, programDataAddress, projectAddress, settledAddress, tokenAccountAddress, vaultAddress } from "../../../src/chain/solana/pda.ts";
import { type Instruction, completesPrepared, missingSigners, resolveInstruction, unsignedTransaction, withSignature } from "../../../src/chain/solana/transactions.ts";
import { type Period, cutoffAt, periodContaining, shiftPeriod } from "../../../src/kernels/calendar.ts";
import { type EscrowChain, type Keypair, escrowChain, finalizedTime, keypair, signedTransaction, simulated, submit, submitWire } from "./program.ts";

export interface Deployment extends AsyncDisposable {
  readonly chain: EscrowChain;
  readonly identity: Keypair;
  readonly feeRecipient: Keypair;
  readonly rotationAuthority: Keypair;
  readonly network: Digest;
  close(): Promise<void>;
}

export interface Sent {
  readonly label: string;
  readonly signature: Signature;
  readonly wire: Uint8Array;
  readonly instructions: ReadonlyArray<Instruction>;
  readonly calls: ReadonlyArray<EscrowCall>;
}

export interface Scenario {
  readonly program: Address;
  readonly sent: ReadonlyArray<Sent>;
  readonly reads: ReadonlyArray<Address>;
  readonly expected: unknown;
  /** @throws {never} */
  observe(accounts: ReadonlyArray<Account | undefined>): unknown;
}

const LAMPORTS = 1_000_000_000n;
const RENT_EXEMPT_EMPTY = 890_880n;

const amount = (value: bigint) => value as U64;
const time = (value: bigint) => value as I64;
const hashed = (label: string) => digestOf(sha256(utf8(label))) as Digest;
const fee = (gross: bigint) => (gross + 49n) / 50n;

function built<A>(outcome: { readonly kind: "built"; readonly value: A } | { readonly kind: "refused"; readonly issue: string }): A {
  if (outcome.kind === "refused") throw new Error(`The codec refused: ${outcome.issue}`);
  return outcome.value;
}

function read<A>(outcome: { readonly kind: "decoded"; readonly value: A } | { readonly kind: "malformed"; readonly issue: string }): A | string {
  return outcome.kind === "decoded" ? outcome.value : `malformed: ${outcome.issue}`;
}

function initializeConfig(program: Address, authority: Address, roles: { readonly identity: Address; readonly fee: Address; readonly rotation: Address }): Instruction {
  return {
    program,
    accounts: [meta(authority, true, true), meta(configAddress(program), true), meta(program, false), meta(programDataAddress(program), false), meta(SYSTEM_PROGRAM, false)],
    data: anchorData("initialize_config", keyBytes(roles.identity), keyBytes(roles.fee), keyBytes(roles.rotation)),
  };
}

function initializeProject(deployment: Deployment, owner: Address, projectId: Digest, purpose: Purpose, asset: PayAsset): Instruction {
  const program = deployment.chain.program;
  const project = projectAddress(program, owner, projectId, purpose);
  const args = [
    digestBytes(projectId),
    digestBytes(deployment.network),
    keyBytes(deployment.identity.address),
    keyBytes(deployment.feeRecipient.address),
    i64le(time(0n)),
    i64le(time(0n)),
    Uint8Array.of(PURPOSE_BYTE[purpose]),
  ];
  const vault = meta(vaultAddress(program, project), true);
  const config = meta(configAddress(program), false);
  return asset.kind === "Native"
    ? { program, accounts: [meta(owner, true, true), meta(project, true), vault, meta(SYSTEM_PROGRAM, false), config], data: anchorData("initialize_native", ...args) }
    : { program, accounts: [meta(owner, true, true), meta(project, true), meta(asset.mint, false), vault, meta(asset.tokenProgram, false), meta(SYSTEM_PROGRAM, false), config], data: anchorData("initialize", ...args) };
}

type DepositSource = { readonly kind: "Native" } | { readonly kind: "Token"; readonly mint: Address; readonly source: Address; readonly tokenProgram: TokenProgram };

function deposit(program: Address, project: Address, depositor: Address, value: U64, from: DepositSource): Instruction {
  const vault = meta(vaultAddress(program, project), true);
  return from.kind === "Native"
    ? { program, accounts: [meta(depositor, true, true), meta(project, true), vault, meta(SYSTEM_PROGRAM, false)], data: anchorData("deposit_native", u64le(value)) }
    : { program, accounts: [meta(depositor, false, true), meta(project, true), meta(from.mint, false), meta(from.source, true), vault, meta(from.tokenProgram, false)], data: anchorData("deposit", u64le(value)) };
}

export async function escrowDeployment(): Promise<Deployment> {
  const chain = await escrowChain();
  try {
    const [identity, feeRecipient, rotationAuthority] = [keypair(), keypair(), keypair()];
    await chain.validator.airdrop(identity.address, 2n * LAMPORTS);
    await submit(chain, chain.upgradeAuthority, [initializeConfig(chain.program, chain.upgradeAuthority.address, { identity: identity.address, fee: feeRecipient.address, rotation: rotationAuthority.address })]);
    return { chain, identity, feeRecipient, rotationAuthority, network: hashed("slop-escrow:solana-localnet"), close: chain.close, [Symbol.asyncDispose]: chain.close };
  } catch (error) {
    await chain.close();
    throw error;
  }
}

/** @throws {never} */
export function pledgeMonth(program: Address, project: Address, owner: Address, period: Period, value: U64): Instruction {
  return {
    program,
    accounts: [meta(owner, true, true), meta(project, true), meta(monthPledgeAddress(program, project, period), true), meta(SYSTEM_PROGRAM, false)],
    data: anchorData("pledge_month", u32le(period), u64le(value)),
  };
}

export async function pledgeCurrentMonth(deployment: Deployment, owner: Keypair, project: Address, value: U64): Promise<Period> {
  const period = periodContaining((await finalizedTime(deployment.chain)).time);
  await submit(deployment.chain, owner, [pledgeMonth(deployment.chain.program, project, owner.address, period, value)]);
  return period;
}

function sameFields(left: ProjectAccount, right: ProjectAccount): boolean {
  return (Object.keys(left) as ReadonlyArray<keyof ProjectAccount>).every((key) => key === "pledgedOpen" || left[key] === right[key]);
}

function projectLayouts(account: Account | undefined, program: Address) {
  if (account === undefined) return "missing";
  const truncated = (size: number) => decodeProject({ ...account, data: account.data.slice(0, size) }, program);
  const current = decodeProject(account, program);
  const prePledge = truncated(PRE_PLEDGE_PROJECT_SIZE);
  return {
    size: account.data.length,
    sameFields: current.kind === "decoded" && prePledge.kind === "decoded" && sameFields(current.value, prePledge.value),
    refused: [300, 320].map((size) => read(truncated(size))),
  };
}

async function funded(deployment: Deployment): Promise<Keypair> {
  const key = keypair();
  await deployment.chain.validator.airdrop(key.address, 20n * LAMPORTS);
  return key;
}

function callsOf(instructions: ReadonlyArray<Instruction>, program: Address): ReadonlyArray<EscrowCall> {
  return instructions.filter((instruction) => instruction.program === program).flatMap((instruction) => {
    const call = decodeEscrowCall(instruction.data);
    return call === undefined ? [] : [call];
  });
}

class Journal {
  readonly sent: Sent[] = [];
  readonly deployment: Deployment;

  constructor(deployment: Deployment) {
    this.deployment = deployment;
  }

  async wire(label: string, wire: Uint8Array, instructions: ReadonlyArray<Instruction>): Promise<void> {
    const signature = await submitWire(this.deployment.chain, wire);
    this.sent.push({ label, signature, wire, instructions, calls: callsOf(instructions, this.deployment.chain.program) });
  }

  async send(label: string, payer: Keypair, instructions: ReadonlyArray<Instruction>, keys: ReadonlyArray<Keypair> = []): Promise<void> {
    await this.wire(label, await signedTransaction(this.deployment.chain, payer, instructions, keys), instructions);
  }

  async bind(terms: WalletBindingTerms, wallet: Keypair): Promise<{ readonly waiting: ReadonlyArray<Address> | undefined; readonly completes: boolean }> {
    const latest = await this.deployment.chain.validator.rpc("getLatestBlockhash", [{ commitment: "finalized" }]) as { readonly value: { readonly blockhash: Blockhash } };
    const compiled = built(bindingMessage({ ...terms, blockhash: latest.value.blockhash }));
    if (compiled.kind === "refused") throw new Error(`The binding did not compile: ${compiled.issue}`);
    const empty = unsignedTransaction(compiled.message);
    const prepared = empty && withSignature(empty, terms.identityAuthority, ed25519.sign(compiled.bytes, this.deployment.identity.seed));
    const cosigned = prepared && withSignature(prepared, wallet.address, ed25519.sign(compiled.bytes, wallet.seed));
    if (prepared === undefined || cosigned === undefined) throw new Error("The binding signatures did not encode");
    await this.wire("bind", cosigned, [built(bindWallet(terms))]);
    return { waiting: missingSigners(prepared), completes: completesPrepared(prepared, cosigned, wallet.address) };
  }
}

/** @throws {never} */
export function transactionParity(program: Address, sent: ReadonlyArray<Sent>, fetched: ReadonlyArray<FetchedTransaction | undefined>) {
  return sent.map((one, at) => {
    const found = fetched[at];
    if (found === undefined) return { label: one.label, finalized: false };
    const keys = found.transaction.message.accountKeys;
    const invocations = escrowInvocations(found, program);
    return {
      label: one.label,
      finalized: true,
      sameWire: Buffer.from(found.wire).equals(Buffer.from(one.wire)),
      sameInstructions: found.transaction.message.instructions.length === one.instructions.length
        && found.transaction.message.instructions.every((compiled, index) => {
          const resolved = resolveInstruction(compiled, keys);
          return resolved !== undefined && sameInstruction(resolved, one.instructions[index] as Instruction);
        }),
      calls: invocations.kind === "decoded" ? invocations.value.map((invocation) => invocation.call) : `malformed: ${invocations.issue}`,
    };
  });
}

/** @throws {never} */
export function expectedParity(sent: ReadonlyArray<Sent>) {
  return sent.map((one) => ({ label: one.label, finalized: true, sameWire: true, sameInstructions: true, calls: one.calls }));
}

function openPeriod(now: number): Period {
  const previous = shiftPeriod(periodContaining(now), -1);
  return now >= cutoffAt(previous) ? previous : shiftPeriod(previous, -1);
}

/** @throws {never} */
export async function nativeMonth(deployment: Deployment): Promise<Scenario> {
  const { chain, identity, network } = deployment;
  const program = chain.program;
  const sponsor = await funded(deployment);
  const contributor = keypair();
  const projectId = hashed("slop-test-native-project");
  const project = projectAddress(program, sponsor.address, projectId, "Ordinary");
  const [actor, other] = [amount(1001n), amount(1002n)];
  const entries: ReadonlyArray<MonthlyEntry> = [
    { actor, gross: amount(2n * LAMPORTS), source: hashed("source:committed") },
    { actor, gross: amount(LAMPORTS), source: hashed("source:hand-awarded") },
    { actor: other, gross: amount(LAMPORTS / 2n), source: hashed("source:other-actor") },
  ];
  const [committed, handAwarded, otherActor] = entries as [MonthlyEntry, MonthlyEntry, MonthlyEntry];
  const allocation = solanaAllocationRoot(entries);
  if (allocation.kind === "refused") throw new Error(`The allocation was refused: ${allocation.issue}`);
  const { tree } = allocation;
  const journal = new Journal(deployment);
  await journal.send("initialize", sponsor, [initializeProject(deployment, sponsor.address, projectId, "Ordinary", { kind: "Native" })]);
  await journal.send("deposit", sponsor, [deposit(program, project, sponsor.address, amount(10n * LAMPORTS), { kind: "Native" })]);
  await journal.send("monthly on", sponsor, [built(setMonthlyCommitment({ program, project, owner: sponsor.address, cap: amount(5n * LAMPORTS), enabled: true }))]);
  await journal.send("hand award", sponsor, [commitAward({ program, project, owner: sponsor.address, purpose: "Ordinary", source: handAwarded.source, actor: handAwarded.actor, gross: handAwarded.gross })]);
  const frozen = await finalizedTime(chain);
  const frozenAt = BigInt(frozen.time);
  const period = openPeriod(frozen.time);
  const attestation: MonthlyAttestation = { program, project, period, root: tree.root, total: tree.total, frozenAt: time(frozenAt), network };
  const signature = ed25519.sign(solanaMonthlyMessage(attestation), identity.seed);
  await journal.send("admit", chain.payer, built(admitMonth({ payer: chain.payer.address, authority: identity.address, signature, attestation })));
  const leaf = (entry: MonthlyEntry): LeafArguments => {
    const index = entries.indexOf(entry);
    return { period, source: entry.source, actor: entry.actor, gross: entry.gross, index, count: tree.count, proof: tree.proofs[index] ?? [] };
  };
  const awardOf = (entry: MonthlyEntry) => awardAddress(program, project, awardId(project, entry.source));
  await journal.send("commit leaf", chain.payer, [built(commitMonthlyAward({ program, project, payer: chain.payer.address, leaf: leaf(committed) }))]);
  await journal.send("release leaf", chain.payer, [built(releaseMonthlyAward({ program, project, payer: chain.payer.address, leaf: leaf(handAwarded), obligation: awardOf(handAwarded) }))]);
  await journal.send("commit other", chain.payer, [built(commitMonthlyAward({ program, project, payer: chain.payer.address, leaf: leaf(otherActor) }))]);
  const terms: WalletBindingTerms = {
    program, project, payer: identity.address, identityAuthority: identity.address, destination: contributor.address, actor, network,
    expectedVersion: amount(0n), claimDigest: hashed("claim:contributor"), expiresAt: time(frozenAt + 3600n),
  };
  const halfSigned = await journal.bind(terms, contributor);
  await journal.send("pay", chain.payer, payAward({ program, project, payer: chain.payer.address, asset: { kind: "Native" }, actor, award: awardId(project, committed.source), destination: contributor.address, version: amount(1n) }));
  const pledgePeriod = periodContaining((await finalizedTime(chain)).time);
  await journal.send("pledge", sponsor, [pledgeMonth(program, project, sponsor.address, pledgePeriod, amount(LAMPORTS))]);
  const month = monthAddress(program, project, period);
  const net = committed.gross - fee(committed.gross);
  const reads: ReadonlyArray<Address> = [
    project,
    vaultAddress(program, project),
    month,
    ...entries.map(awardOf),
    ...entries.map((entry) => originAddress(program, project, entry.source)),
    ...entries.map((entry) => settledAddress(program, month, entry.source)),
    ...entries.map((entry) => monthlySourceAddress(program, project, entry.source)),
    bindingAddress(program, project, actor),
    contributor.address,
    monthPledgeAddress(program, project, pledgePeriod),
    monthPledgeAddress(program, project, period),
  ];
  const awardState = (entry: MonthlyEntry, paid: boolean) => ({
    gross: entry.gross, source: entry.source, project, awardId: awardId(project, entry.source), actor: entry.actor,
    principal: entry.gross - fee(entry.gross), fee: fee(entry.gross), paid, committed: true,
  });
  return {
    program,
    sent: journal.sent,
    reads,
    expected: {
      halfSigned: { waiting: [contributor.address], completes: true },
      project: {
        owner: sponsor.address, projectId, network, identityAuthority: identity.address, feeRecipient: deployment.feeRecipient.address, mint: SYSTEM_PROGRAM,
        reserved: handAwarded.gross + otherActor.gross, deposited: 10n * LAMPORTS, paid: net, payoutFees: fee(committed.gross), withdrawnGross: 0n, withdrawalFees: 0n,
        bindingDelay: 0n, pendingIdentityAuthority: undefined, rotationConfirmed: false, rotationDelay: 0n, purpose: "Ordinary", monthlyCap: 5n * LAMPORTS,
        monthlyEnabled: true, accruedFees: fee(committed.gross), monthlyOutstanding: 0n, pledgedOpen: LAMPORTS,
      },
      vault: { kind: "Native", aboveRent: 10n * LAMPORTS - net },
      month: { project, period, allocationRoot: tree.root, committed: tree.total, total: tree.total, released: handAwarded.gross, frozenAt, expired: false },
      awards: [awardState(committed, true), awardState(handAwarded, false), awardState(otherActor, false)],
      origins: entries.map(awardOf),
      settled: [true, true, true],
      monthlySources: [true, false, true],
      binding: { claimDigest: terms.claimDigest, authority: identity.address, actor, network, destination: contributor.address, version: 1n, paidVersion: 1n, vetoCount: 0, boundAfterFreeze: true },
      contributorLamports: net,
      projectLayouts: { size: PROJECT_SIZE, sameFields: true, refused: ["malformed: wrongSize", "malformed: wrongSize"] },
      pledges: { pledgedMonth: true, admittedMonth: false, stable: true, perMonth: true },
    },
    observe(accounts) {
      const at = (index: number) => accounts[index];
      const projectRead = decodeProject(at(0), program);
      const vault = decodeVault(at(1), { program, project, mint: SYSTEM_PROGRAM });
      const binding = decodeBinding(at(15), program);
      return {
        halfSigned,
        project: projectRead.kind === "decoded" ? (({ bump: _bump, rotationEffectiveAt: _effective, ...rest }) => rest)(projectRead.value) : `malformed: ${projectRead.issue}`,
        vault: vault.kind === "decoded" && vault.value.kind === "Native" ? { kind: "Native", aboveRent: vault.value.lamports - RENT_EXEMPT_EMPTY } : read(vault),
        month: read(decodeMonth(at(2), program)),
        awards: [3, 4, 5].map((index) => {
          const award = decodeAward(at(index), program);
          return award.kind === "decoded" ? (({ committedAt, ...rest }) => ({ ...rest, committed: committedAt > 0n }))(award.value) : `malformed: ${award.issue}`;
        }),
        origins: [6, 7, 8].map((index) => {
          const origin = decodeOrigin(at(index), program);
          return origin.kind === "decoded" ? origin.value.obligation : `malformed: ${origin.issue}`;
        }),
        settled: [9, 10, 11].map((index) => decodeMarker(at(index), program).kind === "decoded"),
        monthlySources: [12, 13, 14].map((index) => isInitialized(at(index), program) && decodeMarker(at(index), program).kind === "decoded"),
        binding: binding.kind === "decoded" ? (({ boundAt, ...rest }) => ({ ...rest, boundAfterFreeze: boundAt >= frozenAt }))(binding.value) : `malformed: ${binding.issue}`,
        contributorLamports: at(16)?.lamports,
        projectLayouts: projectLayouts(at(0), program),
        pledges: {
          pledgedMonth: read(decodeMonthPledgePresence(at(17), program)),
          admittedMonth: read(decodeMonthPledgePresence(at(18), program)),
          stable: monthPledgeAddress(program, project, pledgePeriod) === reads[17],
          perMonth: reads[17] !== reads[18],
        },
      };
    },
  };
}

/** @throws {never} */
export async function tokenProjects(deployment: Deployment): Promise<Scenario> {
  const { chain, identity, network } = deployment;
  const program = chain.program;
  const sponsor = await funded(deployment);
  const contributor = keypair();
  const journal = new Journal(deployment);
  const classic = { kind: "Token", mint: chain.mints.classic, tokenProgram: TOKEN_PROGRAM } as const;
  const admitted = { kind: "Token", mint: chain.mints.token2022, tokenProgram: TOKEN_2022_PROGRAM } as const;
  const classicId = hashed("slop-test-classic-project");
  const admittedId = hashed("slop-test-token-2022-project");
  const classicProject = projectAddress(program, sponsor.address, classicId, "Ordinary");
  const admittedProject = projectAddress(program, sponsor.address, admittedId, "Ordinary");
  const actor = amount(2001n);
  const source = hashed("source:classic-award");
  const gross = amount(1_000_000n);
  await journal.send("initialize classic", sponsor, [initializeProject(deployment, sponsor.address, classicId, "Ordinary", classic)]);
  await journal.send("deposit classic", chain.holder, [deposit(program, classicProject, chain.holder.address, amount(10_000_000n), { ...classic, source: chain.sources.classic })]);
  await journal.send("award classic", sponsor, [commitAward({ program, project: classicProject, owner: sponsor.address, purpose: "Ordinary", source, actor, gross })]);
  const now = BigInt((await finalizedTime(chain)).time);
  const halfSigned = await journal.bind({
    program, project: classicProject, payer: identity.address, identityAuthority: identity.address, destination: contributor.address, actor, network,
    expectedVersion: amount(0n), claimDigest: hashed("claim:classic-contributor"), expiresAt: time(now + 3600n),
  }, contributor);
  await journal.send("pay classic", chain.payer, payAward({ program, project: classicProject, payer: chain.payer.address, asset: classic, actor, award: awardId(classicProject, source), destination: contributor.address, version: amount(1n) }));
  await journal.send("initialize token-2022", sponsor, [initializeProject(deployment, sponsor.address, admittedId, "Ordinary", admitted)]);
  await journal.send("deposit token-2022", chain.holder, [deposit(program, admittedProject, chain.holder.address, amount(5_000_000n), { ...admitted, source: chain.sources.token2022 })]);
  const refusedMint = { kind: "Token", mint: chain.mints.refused, tokenProgram: TOKEN_2022_PROGRAM } as const;
  const refusal = await simulated(chain, sponsor, [initializeProject(deployment, sponsor.address, hashed("slop-test-refused-project"), "Ordinary", refusedMint)]);
  const net = gross - fee(gross);
  const counters = (value: unknown) => {
    if (typeof value === "string") return value;
    const project = value as { readonly mint: Address; readonly deposited: U64; readonly reserved: U64; readonly paid: U64; readonly payoutFees: U64; readonly accruedFees: U64 };
    return { mint: project.mint, deposited: project.deposited, reserved: project.reserved, paid: project.paid, payoutFees: project.payoutFees, accruedFees: project.accruedFees };
  };
  return {
    program,
    sent: journal.sent,
    reads: [
      classicProject,
      vaultAddress(program, classicProject),
      awardAddress(program, classicProject, awardId(classicProject, source)),
      tokenAccountAddress(contributor.address, classic.mint, classic.tokenProgram),
      admittedProject,
      vaultAddress(program, admittedProject),
    ],
    expected: {
      halfSigned: { waiting: [contributor.address], completes: true },
      classic: { mint: classic.mint, deposited: 10_000_000n, reserved: 0n, paid: net, payoutFees: fee(gross), accruedFees: fee(gross) },
      classicVault: { tokenProgram: TOKEN_PROGRAM, amount: 10_000_000n - net },
      award: { paid: true, actor, gross, fee: fee(gross), principal: net },
      wallet: { mint: classic.mint, owner: contributor.address, amount: net },
      admitted: { mint: admitted.mint, deposited: 5_000_000n, reserved: 0n, paid: 0n, payoutFees: 0n, accruedFees: 0n },
      admittedVault: { tokenProgram: TOKEN_2022_PROGRAM, amount: 5_000_000n },
      refused: { failed: true, unsupportedExtension: true },
    },
    observe(accounts) {
      const vault = (index: number, project: Address, mint: Address) => {
        const decoded = decodeVault(accounts[index], { program, project, mint });
        return decoded.kind === "decoded" && decoded.value.kind === "Token" ? { tokenProgram: decoded.value.tokenProgram, amount: decoded.value.token.amount } : read(decoded);
      };
      const award = decodeAward(accounts[2], program);
      const wallet = accounts[3] === undefined ? undefined : decodeTokenAccount(accounts[3].data);
      return {
        halfSigned,
        classic: counters(read(decodeProject(accounts[0], program))),
        classicVault: vault(1, classicProject, classic.mint),
        award: award.kind === "decoded" ? { paid: award.value.paid, actor: award.value.actor, gross: award.value.gross, fee: award.value.fee, principal: award.value.principal } : read(award),
        wallet: wallet?.kind === "decoded" ? { mint: wallet.value.mint, owner: wallet.value.owner, amount: wallet.value.amount } : wallet,
        admitted: counters(read(decodeProject(accounts[4], program))),
        admittedVault: vault(5, admittedProject, admitted.mint),
        refused: { failed: refusal.err !== null, unsupportedExtension: refusal.logs.some((line) => line.includes("UnsupportedTokenExtension")) },
      };
    },
  };
}
