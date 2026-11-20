// spec/contracts/solanaEscrow.md, "The vault holds exactly the free, reserved and accrued funds plus uncredited transfers, above its rent reserve"; spec/contracts/solanaEscrow.md, "Reserves are exactly the unpaid awards plus outstanding monthly gross, and paid totals are exactly the paid awards"; spec/contracts/solanaEscrow.md, "Each period has one month within the cap at admission, and outstanding gross is the sum of unsettled totals"; spec/contracts/solanaEscrow.md, "Open pledges never exceed the free balance, and a closed pledge's period was committed or its window closed"
// What the chain holds for the one project the spec models, read back from its accounts, and the part of the spec's
// state that the chain records.
import { base58Encode } from "./solanaWire.ts";
import type { AccountFacts, MintFacts, Pledge, Program, SolBinding, SolMonth, Veto } from "../../gen/contracts__solanaEscrow.ts";
import type { Award, Purpose } from "../../gen/contracts__ledger.ts";
import {
  type Address,
  type Chain,
  type GenesisAccount,
  CONFIG,
  DEFAULT_KEY,
  PROGRAM,
  PROGRAM_DATA,
  SYSTEM_PROGRAM,
  keyAt,
  readI64,
  readU32,
  readU64,
  rentFor,
  roles,
  sha256,
} from "./solanaChain.ts";
import {
  accountDiscriminator,
  bindingAddress,
  monthAddress,
  monthlySourceAddress,
  settledAddress,
  vaultAddress,
  vetoAddress,
  wordName,
  wordNumber,
} from "./solanaAccounts.ts";

export type ObservedMonth = Omit<SolMonth, "cap" | "leaves">;
export type ObservedBinding = Omit<SolBinding, "walletSigned">;
export type Observed = Omit<Program, "unsolicited" | "months" | "bindings"> & { months: ObservedMonth[]; bindings: ObservedBinding[] };

export const startOfWalk = 1_796_342_399;

/** What the driver remembers of one walk: what the chain does not record but the spec's state names. */
export interface Walk {
  now: number;
  project: Address | undefined;
  readonly roots: Map<string, string>;
  readonly leaves: Map<number, ReadonlyArray<{ readonly actor: number; readonly gross: number; readonly source: number }>>;
  readonly sources: Set<number>;
  readonly actors: Set<number>;
  readonly paid: Map<number, { readonly paidTo: string; readonly paidVersion: number }>;
  readonly ata: Map<string, AccountFacts>;
  claimedFees: number;
  ownerRefunded: number;
}

export const freshWalk = (): Walk => ({
  now: startOfWalk, project: undefined, roots: new Map(), leaves: new Map(), sources: new Set(), actors: new Set(), paid: new Map(), ata: new Map(),
  claimedFees: 0, ownerRefunded: 0,
});

const numeric = (a: number, b: number) => a - b;

export function view(state: Program): Observed {
  const { unsolicited: _unsolicited, months, bindings, awards, monthlySources, vetoes, pledges, ...rest } = state;
  return {
    ...rest,
    awards: [...awards].sort((a, b) => a.source - b.source),
    monthlySources: [...monthlySources].sort(numeric),
    months: months.map(({ cap: _cap, leaves: _leaves, settled, ...month }) => ({ ...month, settled: [...settled].sort(numeric) })).sort((a, b) => a.period - b.period),
    bindings: bindings.map(({ walletSigned: _signed, ...binding }) => binding).sort((a, b) => a.actor - b.actor),
    vetoes: [...vetoes].sort((a, b) => a.actor - b.actor || a.version - b.version),
    pledges: [...pledges].sort((a, b) => a.period - b.period),
  };
}

export const count = (value: bigint): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error(`${value} read from the chain is beyond 2^53`);
  return Number(value);
};

const noMint: MintFacts = { kind: "ClassicSpl", bytes: 0, mintAuthority: false, freezeAuthority: false, extensions: [], pointerAuthority: false, updateAuthority: false, selfHosted: true };

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);
const digest = (bytes: Uint8Array) => base58Encode(sha256(bytes));

export const discriminated = (name: string) => ({ memcmp: { offset: 0, bytes: base58Encode(accountDiscriminator(name)) } });
export const ofProject = (project: Address, offset: number) => ({ memcmp: { offset, bytes: project } });

export interface ProjectAccount {
  readonly size: number;
  readonly owner: Address;
  readonly projectId: Uint8Array;
  readonly network: Uint8Array;
  readonly identity: Address;
  readonly feeRecipient: Address;
  readonly mint: Address;
  readonly purpose: Purpose;
  readonly field: (at: number) => bigint;
  readonly data: Uint8Array;
}

export function decodeProject(account: GenesisAccount | undefined): ProjectAccount | undefined {
  if (account === undefined || account.owner !== PROGRAM || account.data.length < 316) return undefined;
  if (!sameBytes(account.data.slice(0, 8), accountDiscriminator("Project"))) return undefined;
  const { data } = account;
  const purpose = data[306] === 0 ? "Ordinary" : data[306] === 1 ? "Bounty" : undefined;
  if (purpose === undefined) throw new Error(`the project holds purpose ${data[306]}`);
  return {
    size: data.length, data, owner: keyAt(data, 8), projectId: data.slice(40, 72), network: data.slice(72, 104), identity: keyAt(data, 104),
    feeRecipient: keyAt(data, 136), mint: keyAt(data, 168), purpose,
    field: (at) => (at + 8 <= data.length ? readU64(data, at) : 0n),
  };
}

export function namer(chain: Chain, walk: Walk) {
  const vault = walk.project === undefined ? undefined : vaultAddress(walk.project);
  return (address: Address): string => {
    if (address === DEFAULT_KEY) return "";
    if (address === walk.project) return "project";
    if (address === vault) return "vault";
    return roles.find((role) => chain.keys[role].address === address) ?? address;
  };
}

export async function observe(chain: Chain, walk: Walk, mints: ReadonlyMap<Address, MintFacts>): Promise<Observed> {
  const name = namer(chain, walk);
  const [programData, config, projectRaw] = await chain.accounts([PROGRAM_DATA, CONFIG, walk.project ?? DEFAULT_KEY]);
  if (programData === undefined || readU32(programData.data, 0) !== 3) throw new Error("the program has no program data");
  const elf = programData.data.slice(45);
  const build = digest(elf) === digest(chain.current) ? "CurrentBuild" : digest(elf) === digest(chain.legacy) ? "LegacyBuild" : undefined;
  if (build === undefined) throw new Error("the program holds neither build");
  const upgradeAuthority = programData.data[12] === 1 ? name(keyAt(programData.data, 13)) : "";
  const configured = config !== undefined && config.owner === PROGRAM;
  const slot = (await chain.rpc("getSlot", [{ commitment: "confirmed" }])) as number;
  const now = (await chain.rpc("getBlockTime", [slot])) as number;
  const common = {
    build, upgradeAuthority, now, configured,
    configIdentity: configured ? name(keyAt(config.data, 8)) : "",
    configFee: configured ? name(keyAt(config.data, 40)) : "",
    rotationAuthority: configured ? name(keyAt(config.data, 72)) : "",
    claimedFees: walk.claimedFees, ownerRefunded: walk.ownerRefunded,
  } as const;
  const project = walk.project === undefined ? undefined : decodeProject(projectRaw);
  if (project === undefined || walk.project === undefined) {
    return {
      ...common, layout: "NoProject", owner: "", project: "", network: "", purpose: "Ordinary", native: false, mint: noMint, rent: 0,
      identityAuthority: "", feeRecipient: "", bindingDelay: 0, rotationDelay: 0, pendingIdentity: "", rotationEffectiveAt: 0, rotationConfirmed: false,
      reserved: 0, deposited: 0, paid: 0, payoutFees: 0, withdrawnGross: 0, withdrawalFees: 0, accruedFees: 0, monthlyOutstanding: 0, monthlyCap: 0,
      monthlyEnabled: false, vaultAmount: 0, awards: [], monthlySources: [], months: [], bindings: [], vetoes: [], pledges: [], pledged: 0,
    };
  }
  const address = walk.project;
  const native = project.mint === SYSTEM_PROGRAM;
  const field = (at: number) => count(project.field(at));
  const [vault] = await chain.accounts([vaultAddress(address)]);
  const rent = native ? Number(rentFor(0)) : 0;
  const vaultAmount = vault === undefined ? 0 : native ? count(vault.lamports - rentFor(0)) : count(readU64(vault.data, 64));
  const mint = native ? noMint : mints.get(project.mint);
  if (mint === undefined) throw new Error(`the project's mint ${project.mint} is no fixture mint`);
  const layout = project.size === 316 ? "LegacyLayout" : project.size === 332 ? "PrePledgeLayout" : project.size === 340 ? "CurrentLayout" : undefined;
  if (layout === undefined) throw new Error(`the project is ${project.size} bytes`);

  const obligations = await chain.programAccounts(PROGRAM, [discriminated("Obligation"), ofProject(address, 48)]);
  const awards: Award[] = obligations.map(({ data }) => {
    const source = wordNumber(data.slice(16, 48));
    if (source === undefined) throw new Error("an obligation's source is no fixture source");
    const paid = data[136] === 1;
    const recorded = walk.paid.get(source);
    return {
      source, actor: count(readU64(data, 112)), gross: count(readU64(data, 8)), fee: count(readU64(data, 128)), committedAt: count(readI64(data, 137)),
      paid, paidTo: paid ? (recorded?.paidTo ?? "?") : "", paidVersion: paid ? (recorded?.paidVersion ?? -1) : 0,
    };
  });
  const sources = [...walk.sources];
  const exists = async (addresses: ReadonlyArray<Address>) => (await chain.accounts(addresses)).map((account) => account !== undefined && account.owner === PROGRAM);
  const monthlySources = (await exists(sources.map((source) => monthlySourceAddress(address, source)))).flatMap((found, index) => (found ? [sources[index] as number] : []));
  const allocations = await chain.programAccounts(PROGRAM, [discriminated("MonthlyAllocation"), ofProject(address, 8)]);
  const months: ObservedMonth[] = [];
  for (const { data } of allocations) {
    const period = readU32(data, 40);
    const root = base58Encode(data.slice(44, 76));
    const settled = (await exists(sources.map((source) => settledAddress(monthAddress(address, period), source)))).flatMap((found, index) => (found ? [sources[index] as number] : []));
    const committed = count(readU64(data, 76));
    const total = count(readU64(data, 84));
    const released = count(readU64(data, 92));
    months.push({
      period, root: walk.roots.get(root) ?? root, committed, total, released, frozenAt: count(readI64(data, 100)),
      wholeReleased: total > 0 && released === total && committed === total && settled.length === 0, settled,
    });
  }
  const actors = [...walk.actors];
  const bindingAccounts = await chain.accounts(actors.map((actor) => bindingAddress(address, actor)));
  const bindings: ObservedBinding[] = [];
  const vetoes: Veto[] = [];
  for (const account of bindingAccounts) {
    if (account === undefined || account.owner !== PROGRAM) continue;
    const { data } = account;
    const claim = wordNumber(data.slice(8, 40));
    if (claim === undefined) throw new Error("a binding's claim is no fixture claim");
    const actor = count(readU64(data, 72));
    const version = count(readU64(data, 144));
    bindings.push({
      actor, network: wordName(data.slice(80, 112)), authority: name(keyAt(data, 40)), destination: name(keyAt(data, 112)), claim, version,
      boundAt: count(readI64(data, 152)), paidVersion: count(readU64(data, 160)), vetoes: data[168] as number,
    });
    const versions = Array.from({ length: version }, (_, index) => index + 1);
    const vetoed = await exists(versions.map((v) => vetoAddress(address, actor, v)));
    vetoes.push(...versions.flatMap((v, index) => (vetoed[index] ? [{ actor, version: v }] : [])));
  }
  const pledgeAccounts = await chain.programAccounts(PROGRAM, [discriminated("MonthPledge"), ofProject(address, 8)]);
  const pledges: Pledge[] = pledgeAccounts.map(({ data }) => ({ period: readU32(data, 40), amount: count(readU64(data, 44)), open: data[52] === 1 }));
  return view({
    ...common, layout, owner: name(project.owner), project: wordName(project.projectId), network: wordName(project.network), purpose: project.purpose, native, mint, rent,
    identityAuthority: name(project.identity), feeRecipient: name(project.feeRecipient), bindingDelay: count(readI64(project.data, 249)),
    rotationDelay: count(readI64(project.data, 298)), pendingIdentity: name(keyAt(project.data, 257)), rotationEffectiveAt: count(readI64(project.data, 289)),
    rotationConfirmed: project.data[297] === 1,
    reserved: field(200), deposited: field(208), paid: field(216), payoutFees: field(224), withdrawnGross: field(232), withdrawalFees: field(240),
    monthlyCap: field(307), monthlyEnabled: project.data[315] === 1, accruedFees: field(316), monthlyOutstanding: field(324), pledged: field(332),
    vaultAmount, unsolicited: 0, awards, monthlySources,
    months: months.map((month) => ({ ...month, cap: 0, leaves: [] })),
    bindings: bindings.map((binding) => ({ ...binding, walletSigned: true })), vetoes, pledges,
  });
}
