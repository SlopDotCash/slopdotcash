// spec/contracts/evmEscrow.md, "Every credited unit stays in exactly one bucket and the asset balance covers them all"; spec/contracts/evmEscrow.md, "Reserved principal and fees are exactly the unpaid awards, and paid totals are exactly the paid awards"; spec/contracts/evmEscrow.md, "The owner pledges an amount to each of up to twelve months, raising but never lowering an open pledge"; spec/contracts/evmEscrow.md, "Anyone expires a pledge whose period's window closed without admission"; spec/contracts/evmEscrow.md, "Free funds always cover the open pledges, a pledged month is never admitted, and a pledge only rises until it closes"; spec/contracts/evmEscrow.md, "Each period has one root, its gross stays within the cap at admission, and the pending reserve is the sum of remainders"
import { type Address, type Hex, getAddress, hexToBigInt, isAddressEqual, sliceHex, zeroAddress } from "viem";
import type { Binding, Escrow, Month, Pledge, Vault, VaultKey } from "../../gen/contracts__evmEscrow.ts";
import type { Award, Leaf, Purpose } from "../../gen/contracts__ledger.ts";
import { type Fixture, count, factoryAbi, implementationSlot, roles, vaultAbi, wordName } from "./anvil.ts";

export type ObservedBinding = Omit<Binding, "walletSigned">;
export type ObservedMonth = Omit<Month, "leaves">;
export type ObservedVault = Omit<Vault, "unsolicited" | "bindings" | "months"> & { bindings: ObservedBinding[]; months: ObservedMonth[] };
export type Observed = Omit<Escrow, "now" | "vault"> & { vault: ObservedVault };

export interface Walk {
  now: number;
  factory: Address | undefined;
  readonly roots: Map<number, { readonly root: Hex; readonly name: string }>;
  readonly leaves: Map<number, readonly Leaf[]>;
}

export const startOfWalk = 1_796_342_399;

export const freshWalk = (): Walk => ({ now: startOfWalk, factory: undefined, roots: new Map(), leaves: new Map() });

const byPeriod = (pledges: readonly Pledge[]): Pledge[] => [...pledges].sort((a, b) => a.period - b.period);

export function view(escrow: Escrow): Observed {
  const { now: _now, vault: { unsolicited: _unsolicited, bindings, months, pledges, ...vault }, ...factory } = escrow;
  return {
    ...factory,
    vault: {
      ...vault,
      bindings: bindings.map(({ walletSigned: _walletSigned, ...binding }) => binding),
      months: months.map(({ leaves: _leaves, ...month }) => month),
      pledges: byPeriod(pledges),
    },
  };
}

const emptyVault: ObservedVault = {
  key: { owner: "", project: "", token: "", purpose: "Ordinary" },
  native: false, feeRecipient: "", bindingDelay: 0, implementation: 0,
  free: 0, pendingMonthly: 0, reservedPrincipal: 0, reservedFees: 0, deposited: 0, paid: 0, payoutFees: 0,
  grossWithdrawn: 0, withdrawalFees: 0, accruedFees: 0, claimedFees: 0, ownerRefunded: 0,
  balance: 0, monthlyCap: 0, monthlyEnabled: false, sourceSequence: 0, awards: [], bindings: [], months: [], pledges: [], pledged: 0,
};

const noFactory: Observed = {
  initialized: false, factoryImplementation: 0, vaultImplementation: 0, upgradeAuthority: "", pendingUpgradeAuthority: "",
  registrar: "", feeRecipient: "", bindingDelay: 0, identityAuthority: "", pendingIdentityAuthority: "", identityEffectiveAt: 0,
  vaultKeys: [], created: false, vault: emptyVault,
};

const purposes: readonly Purpose[] = ["Ordinary", "Bounty"];

const purposeOf = (code: number): Purpose => {
  const purpose = purposes[code];
  if (purpose === undefined) throw new Error(`the chain holds purpose ${code}, which is neither Ordinary nor Bounty`);
  return purpose;
};

const logicIndex = (logic: readonly [Address, Address], address: Address): number => {
  const index = logic.findIndex((candidate) => isAddressEqual(candidate, address));
  return index < 0 ? -1 : index + 1;
};

const position = (log: { readonly blockNumber: bigint; readonly logIndex: number }) => log.blockNumber * 1_000_000n + BigInt(log.logIndex);

const ordered = <T extends { readonly blockNumber: bigint; readonly logIndex: number }>(logs: readonly T[]) =>
  [...logs].sort((a, b) => (position(a) < position(b) ? -1 : position(a) > position(b) ? 1 : 0));

export async function vaultsCreated(fixture: Fixture, walk: Walk) {
  if (walk.factory === undefined) return [];
  return ordered(await fixture.client.getContractEvents({ address: walk.factory, abi: factoryAbi, eventName: "VaultCreated", fromBlock: 0n, toBlock: "latest", strict: true }));
}

export const firstVault = async (fixture: Fixture, walk: Walk): Promise<Address | undefined> => (await vaultsCreated(fixture, walk))[0]?.args.vault;

export function namer(fixture: Fixture, vault: Address | undefined) {
  return (address: Address): string => {
    if (isAddressEqual(address, zeroAddress)) return "";
    if (vault !== undefined && isAddressEqual(address, vault)) return "vault";
    if (isAddressEqual(address, fixture.token)) return "usdc";
    return roles.find((role) => isAddressEqual(fixture.accounts[role].address, address)) ?? getAddress(address);
  };
}

const implementationOf = async (fixture: Fixture, proxy: Address): Promise<Address> =>
  getAddress(sliceHex((await fixture.client.getStorageAt({ address: proxy, slot: implementationSlot })) ?? `0x${"0".repeat(64)}`, 12));

export async function observe(fixture: Fixture, walk: Walk): Promise<Observed> {
  const factory = walk.factory;
  if (factory === undefined) return noFactory;
  const created = await vaultsCreated(fixture, walk);
  const vault = created[0]?.args.vault;
  const name = namer(fixture, vault);
  const at = { address: factory, abi: factoryAbi } as const;
  const { client } = fixture;
  const [factoryImplementation, vaultImplementation, upgradeAuthority, pendingUpgradeAuthority, registrar, feeRecipient, identityAuthority, pendingIdentityAuthority, bindingDelay, identityEffectiveAt] = await Promise.all([
    implementationOf(fixture, factory),
    client.readContract({ ...at, functionName: "vaultImplementation" }),
    client.readContract({ ...at, functionName: "upgradeAuthority" }),
    client.readContract({ ...at, functionName: "pendingUpgradeAuthority" }),
    client.readContract({ ...at, functionName: "registrar" }),
    client.readContract({ ...at, functionName: "feeRecipient" }),
    client.readContract({ ...at, functionName: "identityAuthority" }),
    client.readContract({ ...at, functionName: "pendingIdentityAuthority" }),
    client.readContract({ ...at, functionName: "bindingDelay" }),
    client.readContract({ ...at, functionName: "identityAuthorityEffectiveAt" }),
  ]);
  const vaultKeys: VaultKey[] = created.map(({ args }) => ({ owner: name(args.owner), project: wordName(args.projectId), token: name(args.token), purpose: purposeOf(args.purpose) }));
  return {
    initialized: true,
    factoryImplementation: logicIndex(fixture.factoryLogic, factoryImplementation),
    vaultImplementation: logicIndex(fixture.vaultLogic, vaultImplementation),
    upgradeAuthority: name(upgradeAuthority),
    pendingUpgradeAuthority: name(pendingUpgradeAuthority),
    registrar: name(registrar),
    feeRecipient: name(feeRecipient),
    bindingDelay: count(bindingDelay),
    identityAuthority: name(identityAuthority),
    pendingIdentityAuthority: name(pendingIdentityAuthority),
    identityEffectiveAt: count(identityEffectiveAt),
    vaultKeys,
    created: vaultKeys.length > 0,
    vault: vault === undefined ? emptyVault : await observeVault(fixture, walk, vault, name),
  };
}

async function observeVault(fixture: Fixture, walk: Walk, vault: Address, name: (address: Address) => string): Promise<ObservedVault> {
  const { client } = fixture;
  const at = { address: vault, abi: vaultAbi } as const;
  const events = { ...at, fromBlock: 0n, toBlock: "latest", strict: true } as const;
  const [token, projectId, owner, purpose, feeRecipient, bindingDelay, totals, pendingMonthly, monthlyCap, monthlyEnabled, sourceSequence, pledged, implementation] = await Promise.all([
    client.readContract({ ...at, functionName: "token" }),
    client.readContract({ ...at, functionName: "projectId" }),
    client.readContract({ ...at, functionName: "owner" }),
    client.readContract({ ...at, functionName: "purpose" }),
    client.readContract({ ...at, functionName: "feeRecipient" }),
    client.readContract({ ...at, functionName: "bindingDelay" }),
    client.readContract({ ...at, functionName: "totals" }),
    client.readContract({ ...at, functionName: "pendingMonthlyGross" }),
    client.readContract({ ...at, functionName: "monthlyCap" }),
    client.readContract({ ...at, functionName: "monthlyEnabled" }),
    client.readContract({ ...at, functionName: "ordinarySourceSequence" }),
    client.readContract({ ...at, functionName: "openPledgedGross" }),
    implementationOf(fixture, vault),
  ]);
  const [committed, paidLogs, bound, claimed, withdrawn, policies, legacy, reserved, pledgedLogs, closedPledges] = await Promise.all([
    client.getContractEvents({ ...events, eventName: "AwardCommitted" }),
    client.getContractEvents({ ...events, eventName: "Paid" }),
    client.getContractEvents({ ...events, eventName: "DestinationBound" }),
    client.getContractEvents({ ...events, eventName: "FeesClaimed" }),
    client.getContractEvents({ ...events, eventName: "UnusedWithdrawn" }),
    client.getContractEvents({ ...events, eventName: "MonthlyCommitmentSet" }),
    client.getContractEvents({ ...events, eventName: "MonthlyCommitted" }),
    client.getContractEvents({ ...events, eventName: "MonthlyReserved" }),
    client.getContractEvents({ ...events, eventName: "MonthPledged" }),
    client.getContractEvents({ ...events, eventName: "PledgeClosed" }),
  ]);
  const [deposited, paid, payoutFees, grossWithdrawn, withdrawalFees, free, reservedPrincipal, reservedFees, accruedFees, balance] = totals;
  const payments = new Map(paidLogs.map(({ args }) => [args.id, args]));
  const awards: Award[] = await Promise.all(ordered(committed).map(async ({ args: { id } }) => {
    const [actorId, gross, fee, sourceDigest, committedAt, isPaid] = await client.readContract({ ...at, functionName: "awards", args: [id] });
    const payment = payments.get(id);
    return {
      source: count(hexToBigInt(sourceDigest)), actor: count(actorId), gross: count(gross), fee: count(fee), committedAt: count(committedAt),
      paid: isPaid, paidTo: payment === undefined ? "" : name(payment.destination), paidVersion: payment === undefined ? 0 : count(payment.version),
    };
  }));
  const latestBinding = new Map(ordered(bound).map((log) => [log.args.actorId, log]));
  const bindings: ObservedBinding[] = await Promise.all([...latestBinding].map(async ([actorId, log]) => {
    const [[destination, version, claimDigest, activatesAt, cancelled], paidVersion, cancels, transaction] = await Promise.all([
      client.readContract({ ...at, functionName: "bindings", args: [actorId] }),
      client.readContract({ ...at, functionName: "paidVersion", args: [actorId] }),
      client.readContract({ ...at, functionName: "cancelCount", args: [actorId] }),
      client.getTransaction({ hash: log.transactionHash }),
    ]);
    return {
      actor: count(actorId), destination: name(destination), version: count(version), claim: count(hexToBigInt(claimDigest)), activatesAt: count(activatesAt),
      cancelled, attester: name(transaction.from), paidVersion: count(paidVersion), cancels,
    };
  }));
  const capAt = (admission: { readonly blockNumber: bigint; readonly logIndex: number; readonly transactionHash: Hex; readonly period: number }) => {
    const policy = ordered(policies).filter((entry) => position(entry) < position(admission)).at(-1)?.args;
    const cap = policy?.enabled === true ? policy.cap : 0n;
    const pledge = closedPledges.find(({ transactionHash, args }) => transactionHash === admission.transactionHash && args.period === admission.period && args.reserved)?.args.amount ?? 0n;
    return pledge > cap ? pledge : cap;
  };
  const admissions = ordered<{ readonly blockNumber: bigint; readonly logIndex: number; readonly transactionHash: Hex; readonly period: number; readonly version2: boolean; readonly wholeGross: bigint; readonly entries: bigint }>([
    ...legacy.map(({ blockNumber, logIndex, transactionHash, args }) => ({ blockNumber, logIndex, transactionHash, period: args.period, version2: false, wholeGross: args.gross, entries: args.awards })),
    ...reserved.map(({ blockNumber, logIndex, transactionHash, args }) => ({ blockNumber, logIndex, transactionHash, period: args.period, version2: true, wholeGross: args.wholeGross, entries: BigInt(args.count) })),
  ]);
  const months: ObservedMonth[] = await Promise.all(admissions.map(async (admission) => {
    const { period } = admission;
    const [root, [allocationDigest, total, remaining, reserveCount, admittedAt], released, block] = await Promise.all([
      client.readContract({ ...at, functionName: "monthlyRoots", args: [period] }),
      client.readContract({ ...at, functionName: "monthlyReserves", args: [period] }),
      client.readContract({ ...at, functionName: "monthlyReleased", args: [period] }),
      client.getBlock({ blockNumber: admission.blockNumber }),
    ]);
    const recorded = walk.roots.get(period);
    return {
      period, version2: admission.version2, digest: wordName(allocationDigest),
      root: recorded !== undefined && recorded.root === root ? recorded.name : root,
      wholeGross: count(admission.wholeGross), total: count(total), remaining: count(remaining),
      count: admission.version2 ? reserveCount : count(admission.entries),
      committedGross: count(total - remaining - released), released: count(released),
      admittedAt: count(admission.version2 ? admittedAt : block.timestamp), cap: count(capAt(admission)),
    };
  }));
  const pledges: Pledge[] = byPeriod(await Promise.all([...new Set(pledgedLogs.map(({ args }) => args.period))].map(async (period) => {
    const [amount, open] = await client.readContract({ ...at, functionName: "monthPledges", args: [period] });
    return { period, amount: count(amount), open };
  })));
  return {
    key: { owner: name(owner), project: wordName(projectId), token: name(token), purpose: purposeOf(purpose) },
    native: isAddressEqual(token, zeroAddress),
    feeRecipient: name(feeRecipient),
    bindingDelay: count(bindingDelay),
    implementation: logicIndex(fixture.vaultLogic, implementation),
    free: count(free), pendingMonthly: count(pendingMonthly), reservedPrincipal: count(reservedPrincipal), reservedFees: count(reservedFees),
    deposited: count(deposited), paid: count(paid), payoutFees: count(payoutFees), grossWithdrawn: count(grossWithdrawn),
    withdrawalFees: count(withdrawalFees), accruedFees: count(accruedFees),
    claimedFees: count(claimed.reduce((sum, { args }) => sum + args.amount, 0n)),
    ownerRefunded: count(withdrawn.reduce((sum, { args }) => sum + args.net, 0n)),
    balance: count(balance), monthlyCap: count(monthlyCap), monthlyEnabled, sourceSequence: count(sourceSequence),
    awards, bindings, months, pledges, pledged: count(pledged),
  };
}
