// spec/contracts/solanaEscrow.md, "Simulation samples cover admitted and refused assets, windows, allocations and signers"; spec/contracts/solanaEscrow.md, "The program upgrade authority writes the Config once with three distinct keys"; spec/contracts/solanaEscrow.md, "The owner creates a token or native project with the Config's identity authority and fee recipient"; spec/contracts/solanaEscrow.md, "Anyone records a signed, fully funded allocation once per period inside its window"; spec/contracts/solanaEscrow.md, "Anyone pays a matured obligation to its actor's latest unvetoed binding"
// Sends each event to the compiled slop-escrow program on solana-test-validator 2.1.21. A spec sender signs with its
// fixture keypair; an event whose transition takes no sender is sent by the funded deployer. The spec's one project is
// the first one an event creates.
import { associatedTokenAddress, base58Encode } from "../support/solanaWire.ts";
import type { Driver, Options } from "../../gen/contracts__solanaEscrow.conformance.ts";
import type { AccountFacts, Event, MintFacts } from "../../gen/contracts__solanaEscrow.ts";
import type { Leaf } from "../../gen/contracts__ledger.ts";
import {
  type Address,
  type Chain,
  type GenesisAccount,
  type Instruction,
  type Keypair,
  type Role,
  CONFIG,
  DEFAULT_KEY,
  INSTRUCTIONS_SYSVAR,
  PROGRAM,
  PROGRAM_DATA,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  Unrepresentable,
  i64le,
  isRole,
  keyAt,
  keyBytes,
  keypair,
  launch,
  meta,
  programAccounts,
  readU64,
  rentFor,
  roles,
  setAuthorityInstruction,
  sha256,
  signed,
  systemAccount,
  u32le,
  u64le,
  upgradeInstruction,
  utf8,
} from "../support/solanaChain.ts";
import {
  FUNDED,
  allocationTree,
  associatedFacts,
  awardAddress,
  awardId,
  bindingAddress,
  configAccounts,
  earlierProject,
  ed25519Check,
  encodeProof,
  escrow,
  factsKey,
  freeze,
  int64,
  lamportTransfer,
  mintAccount,
  mintAddress,
  monthAddress,
  monthlyMessage,
  monthlySourceAddress,
  numberWord,
  originAddress,
  pledgeAddress,
  programOf,
  projectAddress,
  purposeByte,
  releaseMessage,
  settledAddress,
  tokenAccount,
  transferChecked,
  uint,
  vaultAddress,
  vetoAddress,
  word,
} from "../support/solanaAccounts.ts";
import { type Observed, type Walk, decodeProject, freshWalk, namer, observe, startOfWalk, view } from "../support/solanaState.ts";

let chain: Chain | undefined;
let walk: Walk = freshWalk();
/** Mints and token-account shapes some event named; every later genesis holds them, so each restarts at most once. */
const mintFacts = new Map<string, MintFacts>();
const accountFacts = new Map<string, AccountFacts>();
const BUFFER = keypair("buffer").address;
const ROLE_LAMPORTS = 10_000_000_000_000n;

const ready = (): Chain => {
  if (chain === undefined) throw new Error("the driver was not reset before its first event");
  return chain;
};

/** The earlier build's mint: classic SPL with no authorities (spec: `{ ...noMint, bytes: 82 }`). */
const earlierMint: MintFacts = { kind: "ClassicSpl", bytes: 82, mintAuthority: false, freezeAuthority: false, extensions: [], pointerAuthority: false, updateAuthority: false, selfHosted: true };

const signer = (by: unknown): Keypair => {
  if (!isRole(by)) throw new Unrepresentable(`no fixture keypair signs as ${JSON.stringify(by)}`);
  return ready().keys[by];
};
const deployer = () => ready().keys.deployer;
const roleAt = (address: Address): Role | undefined => roles.find((role) => ready().keys[role].address === address);
const keyFor = (address: Address): Keypair => {
  const role = roleAt(address);
  if (role === undefined) throw new Unrepresentable(`no fixture keypair holds ${address}`);
  return ready().keys[role];
};
/** Anything the spec names that the chain has no account for: a project of an unseen owner. */
const phantom = projectAddress(keypair("nobody").address, "", "Ordinary");
const projectKey = () => walk.project ?? phantom;

function party(name: string): Address {
  if (name === "") return DEFAULT_KEY;
  if (name === "project") return projectKey();
  if (name === "vault") return vaultAddress(projectKey());
  if (isRole(name)) return ready().keys[name].address;
  throw new Unrepresentable(`no fixture account is named ${JSON.stringify(name)}`);
}

const freeAccount = (holder: Address, mint: Address, facts: AccountFacts) => keypair(`account:${holder}:${mint}:${factsKey(facts)}`).address;
const emptyAccount = (mint: Address, facts: AccountFacts) => keypair(`empty:${mint}:${factsKey(facts)}`).address;
const associated = (holder: Address, mint: MintFacts): Address => {
  const found = associatedTokenAddress(holder, mintAddress(mint), programOf(mint.kind));
  if (found === undefined) throw new Error("no associated token address");
  return found;
};

/** The roles' accounts and the program as the earlier build left it, with the current build staged by the upgrader. */
function initialAccounts(): GenesisAccount[] {
  const { keys, legacy, current } = ready();
  return [...roles.map((role) => systemAccount(keys[role].address, ROLE_LAMPORTS)), ...programAccounts(legacy, keys.upgrader.address, current, BUFFER, keys.upgrader.address)];
}

/** Every named mint, each role's account of each named shape for it (the deployer's funded), and each role's associated account. */
function tokenAccounts(): GenesisAccount[] {
  const { keys } = ready();
  const made: GenesisAccount[] = [];
  for (const mint of mintFacts.values()) {
    const account = mintAccount(mint, keys.deployer.address);
    made.push(account);
    if (mint.kind === "OtherProgram") continue;
    for (const facts of accountFacts.values()) {
      for (const role of roles) made.push(tokenAccount(freeAccount(keys[role].address, account.address, facts), facts, account.address, keys[role].address, role === "deployer" ? FUNDED : 0n));
      made.push(tokenAccount(emptyAccount(account.address, facts), facts, account.address, keys.deployer.address, 0n));
    }
    for (const role of roles) {
      const holder = keys[role].address;
      const facts = walk.ata.get(`${holder}:${account.address}`) ?? associatedFacts(mint.kind);
      if (facts !== undefined) made.push(tokenAccount(associated(holder, mint), facts, account.address, holder, 0n));
    }
  }
  return made;
}

const merged = (...groups: ReadonlyArray<ReadonlyArray<GenesisAccount>>) => {
  const all = new Map<Address, GenesisAccount>();
  for (const group of groups) for (const account of group) all.set(account.address, account);
  return [...all.values()];
};

/** A new genesis at `time` holding everything the chain holds now, the fixtures it lacks, and `extra` over both. */
async function restart(time: number, extra: ReadonlyArray<GenesisAccount> = []): Promise<void> {
  const current = ready();
  const carried = await current.dump(roles.map((role) => current.keys[role].address));
  await current.boot(time, merged(current.base, tokenAccounts(), carried, extra));
}

async function knownMint(facts: MintFacts): Promise<Address> {
  if (!mintFacts.has(factsKey(facts))) {
    mintFacts.set(factsKey(facts), facts);
    if (!accountFacts.size) for (const kind of ["ClassicSpl", "Token2022"] as const) {
      const standard = associatedFacts(kind);
      if (standard !== undefined) accountFacts.set(factsKey(standard), standard);
    }
    await restart(walk.now);
  }
  return mintAddress(facts);
}

async function knownAccount(facts: AccountFacts): Promise<void> {
  if (accountFacts.has(factsKey(facts))) return;
  accountFacts.set(factsKey(facts), facts);
  await restart(walk.now);
}

interface Live {
  readonly address: Address;
  readonly project: NonNullable<ReturnType<typeof decodeProject>>;
  readonly vault: Address;
  readonly mint: MintFacts | undefined;
}

/** The project the spec models, as the chain holds it, when one exists. */
async function live(): Promise<Live | undefined> {
  if (walk.project === undefined) return undefined;
  const [account] = await ready().accounts([walk.project]);
  const project = decodeProject(account);
  if (project === undefined) return undefined;
  const mint = [...mintFacts.values()].find((facts) => mintAddress(facts) === project.mint);
  return { address: walk.project, project, vault: vaultAddress(walk.project), mint };
}

const send = (instructions: ReadonlyArray<Instruction>, signers: ReadonlyArray<Keypair> = []) => ready().send(instructions, signers);

async function tokenAmount(address: Address): Promise<bigint> {
  const [account] = await ready().accounts([address]);
  return account === undefined || account.data.length < 72 ? 0n : readU64(account.data, 64);
}
async function lamports(address: Address): Promise<bigint> {
  const [account] = await ready().accounts([address]);
  return account?.lamports ?? 0n;
}

/**
 * Runs `run` while a transfer of `amount` into `account` fails. A mint with a freeze authority freezes the account;
 * an admitted Token-2022 mint has none, and nothing else makes a transfer into an admitted account fail, so that case
 * cannot be sent. A transfer of nothing is never made, so it cannot fail.
 */
async function failing(mint: MintFacts, account: Address, amount: bigint, run: () => Promise<boolean>): Promise<boolean> {
  if (amount === 0n) return run();
  const [held] = await ready().accounts([account]);
  if (!mint.freezeAuthority || held === undefined || held.data.length < 109 || held.data[108] !== 1) {
    if (held !== undefined && held.data.length >= 109 && held.data[108] !== 1) return run();
    throw new Unrepresentable("no failing transfer into this account can be arranged");
  }
  const program = programOf(mint.kind);
  if (!(await send([freeze(program, account, mintAddress(mint), deployer().address, false)], [deployer()]))) throw new Error("freezing a fixture account failed");
  const accepted = await run();
  if (!(await send([freeze(program, account, mintAddress(mint), deployer().address, true)], [deployer()]))) throw new Error("thawing a fixture account failed");
  return accepted;
}

const feeOf = (gross: bigint) => (gross + 49n) / 50n;

async function initialize(event: Extract<Event, { type: "initialize" | "initializeNative" }>, by: Keypair): Promise<boolean> {
  // The spec holds one project; a second one, for another key, is outside it.
  if (walk.project !== undefined) return false;
  const { opening } = event;
  const project = projectAddress(by.address, opening.project, opening.purpose);
  const vault = vaultAddress(project);
  const args = [word(opening.project), word(opening.network), keyBytes(party(opening.identity)), keyBytes(party(opening.feeRecipient)), i64le(int64(opening.delay)), i64le(int64(opening.rotationDelay)), Uint8Array.of(purposeByte[opening.purpose])];
  let instruction: Instruction;
  if (event.type === "initialize") {
    const mint = await knownMint(event.mint);
    const tokenProgram = event.mint.kind === "OtherProgram" ? TOKEN_PROGRAM : programOf(event.mint.kind);
    instruction = escrow("initialize", [meta(by.address, true, true), meta(project, true), meta(mint, false), meta(vault, true), meta(tokenProgram, false), meta(SYSTEM_PROGRAM, false), meta(CONFIG, false)], ...args);
  } else {
    // The program's native vault keeps exactly the rent-exempt minimum of an empty account.
    if (event.rent !== Number(rentFor(0))) throw new Unrepresentable(`a native vault's rent is ${rentFor(0)}, not ${event.rent}`);
    instruction = escrow("initialize_native", [meta(by.address, true, true), meta(project, true), meta(vault, true), meta(SYSTEM_PROGRAM, false), meta(CONFIG, false)], ...args);
  }
  const accepted = await send([instruction], [by]);
  if (accepted) walk.project = project;
  return accepted;
}

/**
 * The earlier builds are not in this repository, so their `initialize` and deposits are written into a new genesis:
 * the project, its classic mint and its vault holding the deposits. Only the earlier build creates such a project,
 * and with the keys its `initialize` accepted.
 */
async function earlier(event: Extract<Event, { type: "createLegacyProject" | "createPrePledgeProject" }>, by: Keypair): Promise<boolean> {
  if (walk.project !== undefined) return false;
  const current = ready();
  const [data] = await current.accounts([PROGRAM_DATA]);
  if (data === undefined || sha256(data.data.slice(45)).some((byte, index) => byte !== sha256(current.legacy)[index])) return false;
  const identity = party(event.identity);
  const feeRecipient = party(event.feeRecipient);
  if (event.project === "" || identity === DEFAULT_KEY || feeRecipient === DEFAULT_KEY || identity === by.address || identity === feeRecipient || feeRecipient === by.address) return false;
  const amount = uint(event.amount, 64);
  const mint = await knownMint(earlierMint);
  const legacy = event.type === "createLegacyProject";
  const project = earlierProject(legacy ? 316 : 332, by.address, event.project, legacy ? "legacy" : "prePledge", identity, feeRecipient, mint, amount);
  const vault = tokenAccount(vaultAddress(project.address), { kind: "ClassicSpl", initialized: true, extensions: [] }, mint, project.address, amount);
  await restart(walk.now, [project, vault]);
  walk.project = project.address;
  return true;
}

async function upgradeProgram(by: Keypair): Promise<boolean> {
  const [buffer] = await ready().accounts([BUFFER]);
  const instructions: Instruction[] = [];
  const signers = [by];
  // The staged buffer must name the program's upgrade authority, whichever key holds it now.
  if (buffer !== undefined && buffer.data[4] === 1) {
    const holder = keyAt(buffer.data, 5);
    if (holder !== by.address) {
      instructions.push(setAuthorityInstruction(BUFFER, holder, by.address));
      signers.push(keyFor(holder));
    }
  }
  instructions.push(upgradeInstruction(BUFFER, deployer().address, by.address));
  const accepted = await send(instructions, signers);
  // The loader makes a new build visible from the next slot.
  if (accepted) {
    const slot = (await ready().rpc("getSlot", [{ commitment: "confirmed" }])) as number;
    while (((await ready().rpc("getSlot", [{ commitment: "confirmed" }])) as number) < slot + 2) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return accepted;
}

function leafArgs(period: number, leaf: Leaf) {
  const leaves = walk.leaves.get(period) ?? [];
  const found = leaves.findIndex((l) => l.actor === leaf.actor && l.gross === leaf.gross && l.source === leaf.source);
  const tree = allocationTree(leaves);
  const index = Math.max(0, found);
  const proof = tree === undefined ? [] : tree.proof(index);
  return [numberWord(leaf.source), u64le(uint(leaf.actor, 64)), u64le(uint(leaf.gross, 64)), u32le(index), u32le(Math.max(1, leaves.length)), encodeProof(proof)];
}

async function commitMonthly({ monthlyCommit: event }: Extract<Event, { type: "commitMonthly" }>): Promise<boolean> {
  const project = await live();
  if (project === undefined) return false;
  const period = Number(uint(event.period, 32));
  const tree = allocationTree(event.leaves);
  const root = tree?.root ?? sha256(utf8(`root:${event.root}`));
  walk.roots.set(base58Encode(root), event.root);
  for (const leaf of event.leaves) {
    walk.sources.add(leaf.source);
    walk.actors.add(leaf.actor);
  }
  const total = uint(event.total, 64);
  const frozenAt = int64(event.frozenAt);
  const attester = event.attested ? keyFor(project.project.identity) : keypair("forger");
  const message = monthlyMessage(project.address, period, root, total, frozenAt, project.project.network);
  const check = ed25519Check(attester.publicKey, signed(attester, message), message);
  const instruction = escrow("commit_monthly", [
    meta(deployer().address, true, true), meta(project.address, true), meta(project.vault, false), meta(monthAddress(project.address, period), true),
    meta(INSTRUCTIONS_SYSVAR, false), meta(SYSTEM_PROGRAM, false), ...(event.pledgeAccount ? [meta(pledgeAddress(project.address, period), true)] : []),
  ], u32le(period), root, u64le(total), i64le(frozenAt));
  const accepted = await send([check, instruction], [deployer()]);
  if (accepted) walk.leaves.set(period, event.leaves);
  return accepted;
}

async function settleLeaf(event: Extract<Event, { type: "commitMonthlyAward" | "releaseMonthlyAward" }>): Promise<boolean> {
  const project = await live();
  if (project === undefined) return false;
  const period = Number(uint(event.period, 32));
  const { leaf } = event;
  walk.sources.add(leaf.source);
  walk.actors.add(leaf.actor);
  const month = monthAddress(project.address, period);
  const settled = settledAddress(month, leaf.source);
  if (event.type === "commitMonthlyAward") {
    return send([escrow("commit_monthly_award", [
      meta(deployer().address, true, true), meta(project.address, true), meta(project.vault, false), meta(month, true),
      meta(originAddress(project.address, leaf.source), true), meta(awardAddress(project.address, leaf.source), true), meta(settled, true),
      meta(monthlySourceAddress(project.address, leaf.source), true), meta(SYSTEM_PROGRAM, false),
    ], u32le(period), awardId(project.address, leaf.source), ...leafArgs(period, leaf))], [deployer()]);
  }
  const [origin] = await ready().accounts([originAddress(project.address, leaf.source)]);
  const obligation = origin !== undefined && origin.owner === PROGRAM && origin.data.length >= 40 ? keyAt(origin.data, 8) : PROGRAM;
  return send([escrow("release_monthly_award", [
    meta(deployer().address, true, true), meta(project.address, true), meta(month, true), meta(originAddress(project.address, leaf.source), false),
    meta(monthlySourceAddress(project.address, leaf.source), false), meta(obligation, false), meta(settled, true), meta(SYSTEM_PROGRAM, false),
  ], u32le(period), ...leafArgs(period, leaf))], [deployer()]);
}

async function releaseMonthlyReserve(event: Extract<Event, { type: "releaseMonthlyReserve" }>, by: Keypair): Promise<boolean> {
  const project = await live();
  if (project === undefined) return false;
  const period = Number(uint(event.period, 32));
  const month = monthAddress(project.address, period);
  const [held] = await ready().accounts([month]);
  const root = held === undefined ? new Uint8Array(32) : held.data.slice(44, 76);
  const total = held === undefined ? 0n : readU64(held.data, 84);
  const unsettled = uint(event.expectedUnsettled, 64);
  const released = uint(event.releasedAmount, 64);
  const attester = event.attested ? keyFor(project.project.identity) : keypair("forger");
  const message = releaseMessage(project.address, period, root, total, unsettled, released, project.project.network);
  return send([
    ed25519Check(attester.publicKey, signed(attester, message), message),
    escrow("release_monthly_reserve", [meta(by.address, false, true), meta(project.address, true), meta(month, true), meta(INSTRUCTIONS_SYSVAR, false)], u32le(period), u64le(unsettled), u64le(released)),
  ], [by]);
}

async function bindWallet({ bindingRequest: event }: Extract<Event, { type: "bindWallet" }>, by: Keypair): Promise<boolean> {
  const project = projectKey();
  walk.actors.add(event.actor);
  const destination = party(event.destination);
  const signers = [by, ...(event.walletSigned ? [keyFor(destination)] : [])];
  return send([escrow("bind_wallet", [
    meta(deployer().address, true, true), meta(by.address, false, true), meta(destination, false, event.walletSigned), meta(project, false),
    meta(bindingAddress(project, event.actor), true), meta(SYSTEM_PROGRAM, false),
  ], u64le(uint(event.actor, 64)), word(event.network), u64le(uint(event.expectedVersion, 64)), numberWord(event.claim), i64le(int64(event.expiresAt)))], signers);
}

async function vetoBinding(event: Extract<Event, { type: "vetoBinding" }>, by: Keypair): Promise<boolean> {
  const project = projectKey();
  walk.actors.add(event.actor);
  if (event.obligation !== 0) walk.sources.add(event.obligation);
  return send([escrow("veto_binding", [
    meta(by.address, true, true), meta(project, false), meta(bindingAddress(project, event.actor), true), meta(vetoAddress(project, event.actor, event.version), true),
    meta(event.obligation === 0 ? PROGRAM : awardAddress(project, event.obligation), false), meta(SYSTEM_PROGRAM, false),
  ], u64le(uint(event.actor, 64)), u64le(uint(event.version, 64)))], [by]);
}

/** The obligation of `source` and its actor's binding, as the program derives their addresses. */
async function obligationOf(project: Address, source: number) {
  walk.sources.add(source);
  const award = awardAddress(project, source);
  const [held] = await ready().accounts([award]);
  const actor = held === undefined || held.data.length < 145 ? 0 : Number(readU64(held.data, 112));
  const principal = held === undefined || held.data.length < 145 ? 0n : readU64(held.data, 120);
  const binding = bindingAddress(project, actor);
  const [bound] = await ready().accounts([binding]);
  const version = bound === undefined || bound.data.length < 169 ? 0 : Number(readU64(bound.data, 144));
  return { award, actor, principal, binding, veto: vetoAddress(project, actor, version) };
}

/** The chain keeps no payee on the obligation; the binding that paid names it until it is replaced. */
async function recordPayment(source: number, binding: Address): Promise<void> {
  const [bound] = await ready().accounts([binding]);
  if (bound === undefined) throw new Error("a paid obligation's binding is gone");
  walk.paid.set(source, { paidTo: namer(ready(), walk)(keyAt(bound.data, 112)), paidVersion: Number(readU64(bound.data, 160)) });
}

async function pay(paid: Extract<Event, { type: "pay" | "payNative" }>): Promise<boolean> {
  const project = await live();
  if (project === undefined) return false;
  const event = paid.type === "pay" ? paid.payRequest : paid;
  const { award, principal, binding, veto } = await obligationOf(project.address, event.source);
  const destination = party(event.destination);
  const version = u64le(uint(event.expectedVersion, 64));
  let accepted: boolean;
  if (paid.type === "payNative") {
    accepted = await send([escrow("pay_native", [meta(project.address, true), meta(award, true), meta(binding, true), meta(project.vault, true), meta(destination, true), meta(veto, false)], version)]);
  } else {
    const mint = project.mint;
    if (mint === undefined) return false;
    const ata = associated(destination, mint);
    const key = `${destination}:${mintAddress(mint)}`;
    const { account, transferOk } = paid.payRequest;
    if (factsKey(walk.ata.get(key) ?? associatedFacts(mint.kind)) !== factsKey(account)) {
      // Only a new genesis can give the associated address another shape; it keeps the balance it had.
      walk.ata.set(key, account);
      await restart(walk.now, [tokenAccount(ata, account, mintAddress(mint), destination, await tokenAmount(ata))]);
    }
    const run = () => send([escrow("pay", [
      meta(project.address, true), meta(award, true), meta(binding, true), meta(mintAddress(mint), false), meta(project.vault, true), meta(ata, true),
      meta(programOf(mint.kind), false), meta(veto, false),
    ], version)]);
    accepted = transferOk ? await run() : await failing(mint, ata, principal, run);
  }
  if (accepted) await recordPayment(event.source, binding);
  return accepted;
}

async function withdraw(event: Extract<Event, { type: "withdraw" | "withdrawNative" }>, by: Keypair): Promise<boolean> {
  const project = await live();
  if (project === undefined) return false;
  const gross = uint(event.gross, 64);
  if (event.type === "withdrawNative") {
    const before = await lamports(project.project.owner);
    const accepted = await send([escrow("withdraw_native", [meta(by.address, false, true), meta(project.address, true), meta(project.vault, true), meta(project.project.owner, true)], u64le(gross))], [by]);
    if (accepted) walk.ownerRefunded += Number((await lamports(project.project.owner)) - before);
    return accepted;
  }
  const mint = project.mint;
  if (mint === undefined) return false;
  await knownAccount(event.account);
  const destination = freeAccount(by.address, mintAddress(mint), event.account);
  const before = await tokenAmount(destination);
  const run = () => send([escrow("withdraw", [
    meta(by.address, false, true), meta(project.address, true), meta(mintAddress(mint), false), meta(project.vault, true), meta(destination, true), meta(programOf(mint.kind), false),
  ], u64le(gross))], [by]);
  const accepted = event.transferOk ? await run() : await failing(mint, destination, gross - feeOf(gross), run);
  if (accepted) walk.ownerRefunded += Number((await tokenAmount(destination)) - before);
  return accepted;
}

async function claimFees(event: Extract<Event, { type: "claimFees" | "claimFeesNative" }>): Promise<boolean> {
  const project = await live();
  if (project === undefined) return false;
  const recipient = project.project.feeRecipient;
  if (event.type === "claimFeesNative") {
    const before = await lamports(recipient);
    const accepted = await send([escrow("claim_fees_native", [meta(project.address, true), meta(project.vault, true), meta(recipient, true)])]);
    if (accepted) walk.claimedFees += Number((await lamports(recipient)) - before);
    return accepted;
  }
  const mint = project.mint;
  if (mint === undefined) return false;
  await knownAccount(event.account);
  const destination = freeAccount(recipient, mintAddress(mint), event.account);
  const before = await tokenAmount(destination);
  const run = () => send([escrow("claim_fees", [
    meta(project.address, true), meta(mintAddress(mint), false), meta(project.vault, true), meta(destination, true), meta(programOf(mint.kind), false),
  ])]);
  const accepted = event.transferOk ? await run() : await failing(mint, destination, project.project.field(316), run);
  if (accepted) walk.claimedFees += Number((await tokenAmount(destination)) - before);
  return accepted;
}

async function deposit(event: Extract<Event, { type: "deposit" | "depositNative" | "transferIn" }>): Promise<boolean> {
  const project = await live();
  if (project === undefined) return false;
  const amount = uint(event.amount, 64);
  const native = project.project.mint === SYSTEM_PROGRAM;
  if (event.type === "depositNative") {
    return send([escrow("deposit_native", [meta(deployer().address, true, true), meta(project.address, true), meta(project.vault, true), meta(SYSTEM_PROGRAM, false)], u64le(amount))], [deployer()]);
  }
  if (event.type === "transferIn") {
    // Anyone may send the vault funds outside the program; nothing moves in a transfer of nothing.
    if (amount === 0n) return false;
    if (native) return send([lamportTransfer(deployer().address, project.vault, amount)], [deployer()]);
    const mint = project.mint;
    if (mint === undefined) return false;
    const standard = associatedFacts(mint.kind);
    if (standard === undefined) return false;
    await knownAccount(standard);
    return send([transferChecked(programOf(mint.kind), freeAccount(deployer().address, mintAddress(mint), standard), mintAddress(mint), project.vault, deployer().address, amount)], [deployer()]);
  }
  const mint = project.mint;
  if (native || mint === undefined) return false;
  await knownAccount(event.account);
  // A failed transfer is one from an account holding nothing.
  const source = event.transferOk ? freeAccount(deployer().address, mintAddress(mint), event.account) : emptyAccount(mintAddress(mint), event.account);
  return send([escrow("deposit", [
    meta(deployer().address, false, true), meta(project.address, true), meta(mintAddress(mint), false), meta(source, true), meta(project.vault, true), meta(programOf(mint.kind), false),
  ], u64le(amount))], [deployer()]);
}

async function accepted(event: Event, by: unknown): Promise<boolean> {
  const project = projectKey();
  switch (event.type) {
    case "upgradeProgram":
      return upgradeProgram(signer(by));
    case "setUpgradeAuthority":
      return send([setAuthorityInstruction(PROGRAM_DATA, signer(by).address, event.successor === "" ? undefined : party(event.successor))], [signer(by)]);
    case "initializeConfig":
      return send([escrow("initialize_config", configAccounts(signer(by).address), keyBytes(party(event.identity)), keyBytes(party(event.feeRecipient)), keyBytes(party(event.rotation)))], [signer(by)]);
    case "tick": {
      // The cluster clock never runs backwards; a new genesis moves it forward.
      if (!Number.isSafeInteger(event.timestamp) || event.timestamp <= walk.now) return false;
      await restart(event.timestamp);
      walk.now = event.timestamp;
      return true;
    }
    case "initialize":
    case "initializeNative":
      return initialize(event, signer(by));
    case "createLegacyProject":
    case "createPrePledgeProject":
      return earlier(event, signer(by));
    case "migrateProject":
      return send([escrow("migrate_project", [meta(deployer().address, true, true), meta(project, true), meta(SYSTEM_PROGRAM, false)])], [deployer()]);
    case "proposeAuthorityRotation":
      return send([escrow("propose_authority_rotation", [meta(signer(by).address, false, true), meta(project, true), meta(CONFIG, false)], keyBytes(party(event.successor)))], [signer(by)]);
    case "confirmAuthorityRotation":
      return send([escrow("confirm_authority_rotation", [meta(signer(by).address, false, true), meta(CONFIG, false), meta(project, true)])], [signer(by)]);
    case "cancelAuthorityRotation":
      return send([escrow("cancel_authority_rotation", [meta(signer(by).address, false, true), meta(project, true)])], [signer(by)]);
    case "executeAuthorityRotation":
      return send([escrow("execute_authority_rotation", [meta(project, true)])]);
    case "deposit":
    case "depositNative":
    case "transferIn":
      return deposit(event);
    case "commit":
    case "commitBounty": {
      walk.sources.add(event.source);
      walk.actors.add(event.actor);
      const owner = signer(by);
      return send([escrow(event.type === "commit" ? "commit" : "commit_bounty", [
        meta(owner.address, true, true), meta(project, true), meta(vaultAddress(project), false), meta(originAddress(project, event.source), true),
        meta(awardAddress(project, event.source), true), meta(SYSTEM_PROGRAM, false),
      ], awardId(project, event.source), numberWord(event.source), u64le(uint(event.actor, 64)), u64le(uint(event.gross, 64)))], [owner]);
    }
    case "setMonthlyCommitment":
      return send([escrow("set_monthly_commitment", [meta(signer(by).address, false, true), meta(project, true)], u64le(uint(event.cap, 64)), Uint8Array.of(event.on ? 1 : 0))], [signer(by)]);
    case "commitMonthly":
      return commitMonthly(event);
    case "commitMonthlyAward":
    case "releaseMonthlyAward":
      return settleLeaf(event);
    case "releaseMonthlyReserve":
      return releaseMonthlyReserve(event, signer(by));
    case "pledgeMonth":
      return send([escrow("pledge_month", [meta(signer(by).address, true, true), meta(project, true), meta(pledgeAddress(project, event.period), true), meta(SYSTEM_PROGRAM, false)], u32le(Number(uint(event.period, 32))), u64le(uint(event.amount, 64)))], [signer(by)]);
    case "expirePledge":
      return send([escrow("expire_pledge", [meta(project, true), meta(pledgeAddress(project, event.period), true), meta(monthAddress(project, event.period), false)], u32le(Number(uint(event.period, 32))))]);
    case "closeMonthPledge":
      return send([escrow("close_month_pledge", [meta(signer(by).address, true, true), meta(project, false), meta(pledgeAddress(project, event.period), true)], u32le(Number(uint(event.period, 32))))], [signer(by)]);
    case "bindWallet":
      return bindWallet(event, signer(by));
    case "vetoBinding":
      return vetoBinding(event, signer(by));
    case "pay":
    case "payNative":
      return pay(event);
    case "withdraw":
    case "withdrawNative":
      return withdraw(event, signer(by));
    case "claimFees":
    case "claimFeesNative":
      return claimFees(event);
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

const mintsByAddress = () => new Map([...mintFacts.values()].map((facts) => [mintAddress(facts), facts] as const));

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: async () => {
    chain ??= await launch();
    walk = freshWalk();
    await chain.boot(startOfWalk, merged(chain.base, initialAccounts(), tokenAccounts()));
  },
  dispatch: async (_key, event, by) => {
    try {
      return (await accepted(event, by)) ? "accepted" : "refused";
    } catch (error) {
      if (error instanceof Unrepresentable) return "refused";
      throw error;
    }
  },
  observe: () => observe(ready(), walk, mintsByAddress()),
  [Symbol.asyncDispose]: async () => {
    await chain?.[Symbol.asyncDispose]();
    chain = undefined;
  },
};

export const options: Options<Observed> = { view, keys: ["escrow"], walks: 4, steps: 16 };
