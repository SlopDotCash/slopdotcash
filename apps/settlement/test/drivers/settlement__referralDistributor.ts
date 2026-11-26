// spec/settlement/referralDistributor.md, "Deployment fixes token, growth cap and spacing, with distinct owner and poster"; spec/settlement/referralDistributor.md, "Ownership transfer is accepted by the pending owner and never merges signer roles"; spec/settlement/referralDistributor.md, "Only exact token deposits increase the balance"; spec/settlement/referralDistributor.md, "Voiding the latest unclaimed epoch restores prior live spacing and high water"; spec/settlement/referralDistributor.md, "The wallet signs a valid active-root claim and receives its exact difference"; spec/settlement/referralDistributor.md, "Rescue waits a full year after every post and unpause, even after a void"
import { type Address, type Hex, encodeDeployData, encodeFunctionData, isAddressEqual, keccak256, parseEventLogs, stringToHex, zeroAddress, zeroHash } from "viem";
import type { Driver, Options } from "../../gen/settlement__referralDistributor.conformance.ts";
import type { Distributor, Event } from "../../gen/settlement__referralDistributor.ts";
import { type ReferralFixture, type Tree, Unrepresentable, distributorAbi, dollarAbi, isParty, launchReferral, leafOf, parties, refusingTransfersTo, submitAt, treeOf } from "../support/referralDistributor.ts";

export interface ObservedEpoch {
  readonly index: number;
  readonly root: string;
  readonly total: string;
  readonly postedAt: number;
  readonly voided: boolean;
}
export interface Observed {
  readonly configured: boolean;
  readonly token: string;
  readonly epochCap: string;
  readonly postSpacing: number;
  readonly owner: string;
  readonly pendingOwner: string;
  readonly poster: string;
  readonly paused: boolean;
  readonly lastUnpausedAt: number;
  readonly epochs: readonly ObservedEpoch[];
  readonly latestRootClaimed: boolean;
  readonly claims: readonly { readonly wallet: string; readonly cumulative: string }[];
  readonly balance: string;
  readonly paid: string;
  readonly rescued: string;
}

type Amount = readonly number[];

const value = (amount: Amount): bigint => amount.reduceRight((total, limb) => total * 1000n + BigInt(limb), 0n);
const text = (amount: Amount): string => value(amount).toString();

export function view(d: Distributor): Observed {
  return {
    configured: d.configured,
    token: d.token,
    epochCap: text(d.epochCap),
    postSpacing: d.postSpacing,
    owner: d.owner,
    pendingOwner: d.pendingOwner,
    poster: d.poster,
    paused: d.paused,
    lastUnpausedAt: d.lastUnpausedAt,
    epochs: d.epochs.map((epoch) => ({ index: epoch.index, root: epoch.root, total: text(epoch.total), postedAt: epoch.postedAt, voided: epoch.voided })),
    latestRootClaimed: d.latestRootClaimed,
    claims: d.claims.map((c) => ({ wallet: c.wallet, cumulative: text(c.cumulative) })).sort((a, b) => a.wallet.localeCompare(b.wallet)),
    balance: text(d.balance),
    paid: text(d.paid),
    rescued: text(d.rescued),
  };
}

const unconfigured: Observed = {
  configured: false, token: "", epochCap: "0", postSpacing: 0, owner: "", pendingOwner: "", poster: "", paused: false,
  lastUnpausedAt: 0, epochs: [], latestRootClaimed: false, claims: [], balance: "0", paid: "0", rescued: "0",
};

const leafBound = 32n;

let fixture: ReferralFixture | undefined;
let distributor: Address | undefined;
let now = 0;
const trees = new Map<string, Tree>();
const receipts = new Set<number>();

const ready = (): ReferralFixture => {
  if (fixture === undefined) throw new Error("the driver was not reset before its first event");
  return fixture;
};

function account(name: string): Address {
  if (name === "") return zeroAddress;
  if (!isParty(name)) throw new Unrepresentable(`no fixture account is named ${JSON.stringify(name)}`);
  return ready().accounts[name].address;
}

function nameOf(address: Address): string {
  if (isAddressEqual(address, zeroAddress)) return "";
  const party = parties.find((candidate) => isAddressEqual(ready().accounts[candidate].address, address));
  if (party === undefined) throw new Error(`the chain holds ${address}, which is no fixture account`);
  return party;
}

function tokenNamed(name: string): Address {
  if (name === "") return zeroAddress;
  if (name !== "token" && name !== "wrong") throw new Unrepresentable(`no test token is named ${JSON.stringify(name)}`);
  return ready().tokens[name];
}

function tokenName(address: Address): string {
  const f = ready();
  if (isAddressEqual(address, f.tokens.token)) return "token";
  if (isAddressEqual(address, f.tokens.wrong)) return "wrong";
  throw new Error(`the distributor holds token ${address}, which is no test token`);
}

function treeNamed(name: string): Tree {
  const known = trees.get(name);
  if (known !== undefined) return known;
  const leaves: Hex[] = [keccak256(stringToHex(`root ${name}`))];
  for (const party of parties) for (let cumulative = 0n; cumulative <= leafBound; cumulative += 1n) leaves.push(leafOf(ready().accounts[party].address, cumulative));
  const tree = treeOf(leaves);
  trees.set(name, tree);
  return tree;
}

const rootWord = (name: string): Hex => (name === "" ? zeroHash : treeNamed(name).root);

function rootName(root: Hex): string {
  for (const [name, tree] of trees) if (tree.root === root) return name;
  throw new Error(`the distributor holds root ${root}, which the driver never posted`);
}

const uint = (amount: Amount, bits: number): bigint => {
  const result = value(amount);
  if (result >= 2n ** BigInt(bits)) throw new Unrepresentable(`${result} is not a uint${bits}`);
  return result;
};

const whole = (n: number, bits: number): bigint => {
  if (!Number.isSafeInteger(n) || n < 0 || BigInt(n) >= 2n ** BigInt(bits)) throw new Unrepresentable(`${n} is not a uint${bits}`);
  return BigInt(n);
};

const time = (timestamp: number): number => {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Unrepresentable(`${timestamp} is no block time after the fixture's start`);
  return timestamp;
};

async function call(from: Address, data: Hex): Promise<boolean> {
  if (distributor === undefined) return false;
  return (await submitAt(ready(), from, { to: distributor, data }, now)).status === "success";
}

async function tokenOfDistributor(): Promise<Address> {
  if (distributor === undefined) throw new Error("no distributor is deployed");
  return ready().client.readContract({ address: distributor, abi: distributorAbi, functionName: "token" });
}

async function balanceOf(token: Address, holder: Address): Promise<bigint> {
  return ready().client.readContract({ address: token, abi: dollarAbi, functionName: "balanceOf", args: [holder] });
}

async function deploy(event: Extract<Event, { type: "deploy" }>): Promise<boolean> {
  if (distributor !== undefined) throw new Unrepresentable("a deployed distributor has no second constructor");
  const at = time(event.timestamp);
  const data = encodeDeployData({
    abi: distributorAbi,
    bytecode: ready().distributorBytecode,
    args: [tokenNamed(event.token), account(event.owner), account(event.poster), uint(event.cap, 256), whole(event.spacing, 64)],
  });
  const before = await ready().chain.snapshot();
  const receipt = await submitAt(ready(), ready().accounts.deployer.address, { data }, at);
  if (receipt.status !== "success" || receipt.contractAddress == null) {
    await ready().chain.revert(before);
    return false;
  }
  distributor = receipt.contractAddress;
  now = at;
  return true;
}

async function deposit(event: Extract<Event, { type: "deposit" }>): Promise<boolean> {
  if (distributor === undefined || !event.finalized || event.receipt <= 0 || receipts.has(event.receipt)) return false;
  const token = tokenNamed(event.token);
  if (token === zeroAddress) return false;
  const credited = await tokenOfDistributor();
  const before = await balanceOf(credited, distributor);
  const sent = await submitAt(ready(), ready().accounts.deployer.address, { to: token, data: encodeFunctionData({ abi: dollarAbi, functionName: "transfer", args: [distributor, uint(event.amount, 256)] }) }, now);
  if (sent.status !== "success") return false;
  const credits = (await balanceOf(credited, distributor)) > before;
  if (credits) receipts.add(event.receipt);
  return credits;
}

async function claim(event: Extract<Event, { type: "claim" }>, from: Address): Promise<boolean> {
  const cumulative = uint(event.cumulative, 256);
  if (event.verified && cumulative > leafBound) throw new Unrepresentable(`no posted tree holds a leaf of ${cumulative}`);
  const tree = treeNamed(event.proofRoot);
  const leaf = leafOf(account(event.wallet), cumulative);
  const proof = event.verified ? tree.proof(leaf) : tree.proof(leafOf(account(event.wallet), cumulative + 1n > leafBound ? 0n : cumulative + 1n));
  if (proof === undefined) throw new Unrepresentable(`the tree ${event.proofRoot} holds no such leaf`);
  const run = () => call(from, encodeFunctionData({ abi: distributorAbi, functionName: "claim", args: [cumulative, [...proof]] }));
  if (event.transferExact || distributor === undefined) return run();
  return refusingTransfersTo(ready(), await tokenOfDistributor(), from, now, run);
}

async function rescue(event: Extract<Event, { type: "rescue" }>, from: Address): Promise<boolean> {
  const run = () => call(from, encodeFunctionData({ abi: distributorAbi, functionName: "rescue", args: [account(event.destination)] }));
  if (event.transferExact || distributor === undefined || event.destination === "") return run();
  return refusingTransfersTo(ready(), await tokenOfDistributor(), account(event.destination), now, run);
}

async function accepted(event: Event, by: unknown): Promise<boolean> {
  const from = (): Address => {
    if (typeof by !== "string" || by === "") throw new Unrepresentable(`no account sends as ${JSON.stringify(by)}`);
    return account(by);
  };
  switch (event.type) {
    case "deploy":
      return deploy(event);
    case "tick":
      if (distributor === undefined || event.timestamp <= now) return false;
      now = time(event.timestamp);
      return true;
    case "transferOwnership":
      return call(from(), encodeFunctionData({ abi: distributorAbi, functionName: "transferOwnership", args: [account(event.newOwner)] }));
    case "acceptOwnership":
      return call(from(), encodeFunctionData({ abi: distributorAbi, functionName: "acceptOwnership" }));
    case "setPoster":
      return call(from(), encodeFunctionData({ abi: distributorAbi, functionName: "setPoster", args: [account(event.newPoster)] }));
    case "pause":
      return call(from(), encodeFunctionData({ abi: distributorAbi, functionName: "pause" }));
    case "unpause":
      return call(from(), encodeFunctionData({ abi: distributorAbi, functionName: "unpause" }));
    case "deposit":
      return deposit(event);
    case "postRoot":
      return call(from(), encodeFunctionData({ abi: distributorAbi, functionName: "postRoot", args: [whole(event.index, 256), rootWord(event.root), uint(event.total, 256)] }));
    case "voidLast":
      return call(from(), encodeFunctionData({ abi: distributorAbi, functionName: "voidRoot", args: [whole(event.index, 256)] }));
    case "claim":
      return claim(event, from());
    case "rescue":
      return rescue(event, from());
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

const latestRootClaimedSlot = 2n;
const latestRootClaimedShift = 168n;

async function observed(): Promise<Observed> {
  if (distributor === undefined) return unconfigured;
  const f = ready();
  const at = distributor;
  const client = f.client;
  const token = await client.readContract({ address: at, abi: distributorAbi, functionName: "token" });
  const epochCap = await client.readContract({ address: at, abi: distributorAbi, functionName: "epochCap" });
  const postSpacing = await client.readContract({ address: at, abi: distributorAbi, functionName: "postSpacing" });
  const owner = await client.readContract({ address: at, abi: distributorAbi, functionName: "owner" });
  const pendingOwner = await client.readContract({ address: at, abi: distributorAbi, functionName: "pendingOwner" });
  const poster = await client.readContract({ address: at, abi: distributorAbi, functionName: "poster" });
  const paused = await client.readContract({ address: at, abi: distributorAbi, functionName: "paused" });
  const epochCount = await client.readContract({ address: at, abi: distributorAbi, functionName: "epochCount" });
  const totalClaimed = await client.readContract({ address: at, abi: distributorAbi, functionName: "totalClaimed" });
  const lastUnpausedAt = await client.readContract({ address: at, abi: distributorAbi, functionName: "lastUnpausedAt" });
  const epochs: ObservedEpoch[] = [];
  for (let index = 0n; index < epochCount; index += 1n) {
    const epoch = await f.client.readContract({ address: distributor, abi: distributorAbi, functionName: "epochAt", args: [index] });
    epochs.push({ index: Number(index), root: rootName(epoch.root), total: epoch.total.toString(), postedAt: Number(epoch.postedAt) - f.epoch, voided: epoch.voided });
  }
  const claims: { wallet: string; cumulative: string }[] = [];
  for (const party of parties) {
    const cumulative = await f.client.readContract({ address: distributor, abi: distributorAbi, functionName: "claimed", args: [f.accounts[party].address] });
    if (cumulative > 0n) claims.push({ wallet: party, cumulative: cumulative.toString() });
  }
  const flags = await f.client.getStorageAt({ address: distributor, slot: `0x${latestRootClaimedSlot.toString(16).padStart(64, "0")}` });
  const logs = await f.client.getLogs({ address: distributor, fromBlock: 0n, toBlock: "latest" });
  const rescued = parseEventLogs({ abi: distributorAbi, eventName: "Rescued", logs }).reduce((total, log) => total + log.args.amount, 0n);
  return {
    configured: true,
    token: tokenName(token),
    epochCap: epochCap.toString(),
    postSpacing: Number(postSpacing),
    owner: nameOf(owner),
    pendingOwner: nameOf(pendingOwner),
    poster: nameOf(poster),
    paused,
    lastUnpausedAt: Number(lastUnpausedAt) - f.epoch,
    epochs,
    latestRootClaimed: flags !== undefined && (BigInt(flags) >> latestRootClaimedShift) % 256n === 1n,
    claims: claims.sort((a, b) => a.wallet.localeCompare(b.wallet)),
    balance: (await balanceOf(token, distributor)).toString(),
    paid: totalClaimed.toString(),
    rescued: rescued.toString(),
  };
}

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: async () => {
    fixture ??= await launchReferral();
    await fixture.reset();
    distributor = undefined;
    now = 0;
    trees.clear();
    receipts.clear();
  },
  dispatch: async (_key, event, by) => {
    try {
      return (await accepted(event, by)) ? "accepted" : "refused";
    } catch (error) {
      if (error instanceof Unrepresentable) return "refused";
      throw error;
    }
  },
  observe: () => observed(),
  [Symbol.asyncDispose]: async () => {
    await fixture?.[Symbol.asyncDispose]();
    fixture = undefined;
  },
};

export const options: Options<Observed> = { view, keys: ["distributor"], walks: 25, steps: 24 };
