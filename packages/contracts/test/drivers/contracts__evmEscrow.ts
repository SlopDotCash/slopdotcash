// spec/contracts/evmEscrow.md, "Simulation samples cover distinct and colliding keys, windows, allocations and signatures"; spec/contracts/evmEscrow.md, "Every credited unit stays in exactly one bucket and the asset balance covers them all"; spec/contracts/evmEscrow.md, "Reserved principal and fees are exactly the unpaid awards, and paid totals are exactly the paid awards"; spec/contracts/ledger.md, "An ordinary award or withdrawal pays ceil(gross / 50) and a bounty award pays a quarter"
import { type Address, type Hex, concat, encodeFunctionData, isAddressEqual, zeroAddress, zeroHash } from "viem";
import type { Driver, Options } from "../../gen/contracts__evmEscrow.conformance.ts";
import type { Event } from "../../gen/contracts__evmEscrow.ts";
import type { Leaf } from "../../gen/contracts__ledger.ts";
import {
  type Fixture, type Role, Unrepresentable, allocationRoot, awardId, blocking, codeless, deployProxy, digestOf, entry, factoryAbi, isRole, launch,
  roles, send, signAllocation, signBinding, signRelease, signReservation, small, submit, sumProof, sumRoot, tokenAbi, uint, vaultAbi, withoutFunds, word,
} from "../support/anvil.ts";
import { type Observed, type Walk, firstVault, freshWalk, observe, view } from "../support/evmState.ts";

let fixture: Fixture | undefined;
let walk: Walk = freshWalk();

const ready = (): Fixture => {
  if (fixture === undefined) throw new Error("the driver was not reset before its first event");
  return fixture;
};

const sender = (by: unknown): Address => {
  if (!isRole(by)) throw new Error(`no fixture account sends as ${JSON.stringify(by)}`);
  return ready().accounts[by].address;
};

const logicAt = (pair: readonly [Address, Address], logic: number): Address => {
  if (!Number.isSafeInteger(logic) || logic < 0) throw new Unrepresentable(`${logic} names no implementation`);
  if (logic === 0) return zeroAddress;
  const address = pair[logic - 1];
  if (address === undefined) throw new Error(`no implementation ${logic} is deployed`);
  return address;
};

const purposeCode = { Ordinary: 0, Bounty: 1 } as const;

const keyOf = (address: Address): Hex | undefined => {
  const role = roles.find((candidate) => isAddressEqual(ready().accounts[candidate].address, address));
  return role === undefined ? undefined : ready().accounts[role].privateKey;
};

const keyOtherThan = (address: Address): Hex => {
  const role = (["other", "wallet"] as const satisfies readonly Role[]).find((candidate) => !isAddressEqual(ready().accounts[candidate].address, address));
  return ready().accounts[role ?? "deployer"].privateKey;
};

async function attesterKey(attested: boolean): Promise<Hex> {
  const f = ready();
  if (walk.factory === undefined) return keyOtherThan(zeroAddress);
  const identity = await f.client.readContract({ address: walk.factory, abi: factoryAbi, functionName: "identityAuthority" });
  if (!attested) return keyOtherThan(identity);
  const key = keyOf(identity);
  if (key === undefined) throw new Error(`the identity authority ${identity} is not a fixture account`);
  return key;
}

async function party(name: string): Promise<Address> {
  if (name === "") return zeroAddress;
  if (name === "vault") {
    const vault = await firstVault(ready(), walk);
    if (vault === undefined) throw new Unrepresentable("no vault exists to name");
    return vault;
  }
  if (!isRole(name)) throw new Error(`no fixture account is named ${JSON.stringify(name)}`);
  return ready().accounts[name].address;
}

function tokenOf(token: string, tokenReady: boolean): Address {
  if (token === "") return zeroAddress;
  if (token !== "usdc") throw new Error(`no test token is named ${JSON.stringify(token)}`);
  return tokenReady ? ready().token : codeless;
}

const toFactory = (from: Address, data: Hex) => (walk.factory === undefined ? false : send(ready(), from, { to: walk.factory, data }, walk.now));

async function toVault(from: Address, build: (vault: Address) => Promise<Hex> | Hex, value = 0n): Promise<boolean> {
  const vault = await firstVault(ready(), walk);
  if (vault === undefined) return false;
  return send(ready(), from, { to: vault, data: await build(vault), value }, walk.now);
}

async function failingTransfer(recipient: (vault: Address) => Promise<Address>, run: () => Promise<boolean>): Promise<boolean> {
  const f = ready();
  const vault = await firstVault(f, walk);
  if (vault === undefined) return run();
  const token = await f.client.readContract({ address: vault, abi: vaultAbi, functionName: "token" });
  return isAddressEqual(token, zeroAddress) ? withoutFunds(f, vault, run) : blocking(f, await recipient(vault), walk.now, run);
}

const transferring = (transferOk: boolean, recipient: (vault: Address) => Promise<Address>, run: () => Promise<boolean>) =>
  transferOk ? run() : failingTransfer(recipient, run);

async function initializeFactory(event: Extract<Event, { type: "initializeFactory" }>, from: Address): Promise<boolean> {
  const f = ready();
  const data = encodeFunctionData({
    abi: factoryAbi,
    functionName: "initialize",
    args: [await party(event.registrar), await party(event.feeRecipient), await party(event.identity), uint(event.delay, 64), await party(event.upgrader),
      event.uups ? logicAt(f.vaultLogic, event.logic) : f.notUups],
  });
  if (walk.factory !== undefined) return toFactory(from, data);
  const receipt = await submit(f, from, { data: deployProxy(f, logicAt(f.factoryLogic, event.factoryLogic), data) }, walk.now);
  if (receipt.status !== "success") return false;
  walk.factory = receipt.contractAddress ?? undefined;
  return true;
}

async function deposit(event: Extract<Event, { type: "deposit" }>, from: Address): Promise<boolean> {
  const f = ready();
  const vault = await firstVault(f, walk);
  if (vault === undefined) return false;
  const amount = uint(event.amount, 128);
  const value = uint(event.sent, 256);
  const token = await f.client.readContract({ address: vault, abi: vaultAbi, functionName: "token" });
  const run = () => send(f, from, { to: vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [amount] }), value }, walk.now);
  if (isAddressEqual(token, zeroAddress)) return run();
  if (!(await send(f, from, { to: token, data: encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [vault, amount] }) }, walk.now))) throw new Error("approving the vault reverted");
  return event.transferExact ? run() : blocking(f, vault, walk.now, run);
}

async function transferIn(event: Extract<Event, { type: "transferIn" }>, from: Address): Promise<boolean> {
  const f = ready();
  const vault = await firstVault(f, walk);
  if (vault === undefined || event.amount <= 0) return false;
  const amount = uint(event.amount, 128);
  const token = await f.client.readContract({ address: vault, abi: vaultAbi, functionName: "token" });
  if (isAddressEqual(token, zeroAddress)) return send(f, from, { data: concat(["0x73", vault, "0xff"]), value: amount }, walk.now);
  return send(f, from, { to: token, data: encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [vault, amount] }) }, walk.now);
}

const commit = (functionName: "commitAward" | "commitBountyAward", source: number, actor: number, gross: number) => (vault: Address) => {
  const sourceDigest = digestOf(source);
  return encodeFunctionData({ abi: vaultAbi, functionName, args: [awardId(vault, sourceDigest), uint(actor, 64), uint(gross, 128), sourceDigest] });
};

async function commitMonthly(event: Extract<Event, { type: "commitMonthly" }>, from: Address): Promise<boolean> {
  const period = small(event.period, 32);
  const entries = event.entries.map(entry);
  const root = event.entries.length > 0 ? allocationRoot(event.entries) : zeroHash;
  const key = await attesterKey(event.attested);
  const accepted = await toVault(from, async (vault) =>
    encodeFunctionData({ abi: vaultAbi, functionName: "commitMonthly", args: [period, entries, await signAllocation(key, vault, { period, allocationRoot: root })] }));
  if (accepted) walk.roots.set(period, { root, name: "legacy" });
  return accepted;
}

async function reserveMonthly(event: Extract<Event, { type: "reserveMonthly" }>, from: Address): Promise<boolean> {
  const { reservation } = event;
  const period = small(event.period, 32);
  const root = reservation.root === "" ? zeroHash : reservation.leaves.length > 0 ? sumRoot(reservation.leaves) : word(reservation.root);
  const signed = {
    period, allocationDigest: word(reservation.digest), allocationRoot: root, wholeGross: uint(reservation.wholeGross, 128),
    remainingGross: uint(reservation.remainingGross, 128), count: small(reservation.count, 32), sourceSequence: uint(event.sequence, 256),
  };
  const { period: _period, ...admitted } = signed;
  const key = await attesterKey(event.attested);
  const accepted = await toVault(from, async (vault) =>
    encodeFunctionData({ abi: vaultAbi, functionName: "reserveMonthly", args: [period, admitted, await signReservation(key, vault, signed)] }));
  if (accepted) {
    walk.roots.set(period, { root, name: reservation.root });
    walk.leaves.set(period, reservation.leaves);
  }
  return accepted;
}

const sameLeaf = (a: Leaf, b: Leaf) => a.actor === b.actor && a.gross === b.gross && a.source === b.source;

function commitMonthlyLeaf(event: Extract<Event, { type: "commitMonthlyLeaf" }>, from: Address): Promise<boolean> {
  const period = small(event.period, 32);
  const leaves = walk.leaves.get(period) ?? [];
  const index = Math.max(0, leaves.findIndex((leaf) => sameLeaf(leaf, event.leaf)));
  const proof = leaves.length > 0 ? sumProof(leaves, index) : [];
  return toVault(from, () => encodeFunctionData({ abi: vaultAbi, functionName: "commitMonthlyLeaf", args: [period, entry(event.leaf), index, proof] }));
}

async function releaseMonthlyReserve(event: Extract<Event, { type: "releaseMonthlyReserve" }>, from: Address): Promise<boolean> {
  const f = ready();
  const period = small(event.period, 32);
  const remainingGross = uint(event.expectedRemaining, 128);
  const releasedGross = uint(event.releasedGross, 128);
  const key = await attesterKey(event.attested);
  return toVault(from, async (vault) => {
    const [[allocationDigest], allocationRoot] = await Promise.all([
      f.client.readContract({ address: vault, abi: vaultAbi, functionName: "monthlyReserves", args: [period] }),
      f.client.readContract({ address: vault, abi: vaultAbi, functionName: "monthlyRoots", args: [period] }),
    ]);
    const attestation = await signRelease(key, vault, { period, allocationDigest, allocationRoot, remainingGross, releasedGross });
    return encodeFunctionData({ abi: vaultAbi, functionName: "releaseMonthlyReserve", args: [period, remainingGross, releasedGross, attestation] });
  });
}

async function bindDestination(event: Extract<Event, { type: "bindDestination" }>, from: Address): Promise<boolean> {
  const destination = await party(event.destination);
  const message = { actorId: uint(event.actor, 64), destination, expectedVersion: uint(event.expectedVersion, 64), claimDigest: digestOf(event.claim), expiresAt: uint(event.expiresAt, 64) };
  const key = (event.walletSigned ? keyOf(destination) : undefined) ?? keyOtherThan(destination);
  return toVault(from, async (vault) =>
    encodeFunctionData({
      abi: vaultAbi,
      functionName: "bindDestination",
      args: [message.actorId, destination, message.expectedVersion, message.claimDigest, message.expiresAt, await signBinding(key, vault, message)],
    }));
}

async function pay(event: Extract<Event, { type: "pay" }>, from: Address): Promise<boolean> {
  const f = ready();
  const version = uint(event.expectedVersion, 64);
  const sourceDigest = digestOf(event.source);
  const destination = async (vault: Address) => {
    const [actorId] = await f.client.readContract({ address: vault, abi: vaultAbi, functionName: "awards", args: [awardId(vault, sourceDigest)] });
    const [payee] = await f.client.readContract({ address: vault, abi: vaultAbi, functionName: "payableBinding", args: [actorId] });
    return payee;
  };
  return transferring(event.transferOk, destination, () =>
    toVault(from, (vault) => encodeFunctionData({ abi: vaultAbi, functionName: "pay", args: [awardId(vault, sourceDigest), version] })));
}

const ownerOf = (vault: Address) => ready().client.readContract({ address: vault, abi: vaultAbi, functionName: "owner" });
const feeRecipientOf = (vault: Address) => ready().client.readContract({ address: vault, abi: vaultAbi, functionName: "feeRecipient" });

async function accepted(event: Event, from: Address): Promise<boolean> {
  const f = ready();
  switch (event.type) {
    case "initializeFactory":
      return initializeFactory(event, from);
    case "tick":
      uint(event.timestamp, 64);
      if (event.timestamp <= walk.now) return false;
      walk.now = event.timestamp;
      return true;
    case "proposeUpgradeAuthority":
      return toFactory(from, encodeFunctionData({ abi: factoryAbi, functionName: "proposeUpgradeAuthority", args: [await party(event.successor)] }));
    case "acceptUpgradeAuthority":
      return toFactory(from, encodeFunctionData({ abi: factoryAbi, functionName: "acceptUpgradeAuthority" }));
    case "setVaultImplementation":
      return toFactory(from, encodeFunctionData({ abi: factoryAbi, functionName: "setVaultImplementation", args: [event.uups ? logicAt(f.vaultLogic, event.logic) : f.notUups] }));
    case "upgradeFactory":
      return toFactory(from, encodeFunctionData({ abi: factoryAbi, functionName: "upgradeToAndCall", args: [event.uups ? logicAt(f.factoryLogic, event.logic) : f.notUups, "0x"] }));
    case "upgradeVault":
      return toVault(from, () => encodeFunctionData({ abi: vaultAbi, functionName: "upgradeToAndCall", args: [event.uups ? logicAt(f.vaultLogic, event.logic) : f.notUups, "0x"] }));
    case "proposeIdentityAuthority":
      return toFactory(from, encodeFunctionData({ abi: factoryAbi, functionName: "proposeIdentityAuthority", args: [await party(event.successor)] }));
    case "cancelIdentityAuthorityRotation":
      return toFactory(from, encodeFunctionData({ abi: factoryAbi, functionName: "cancelIdentityAuthorityRotation" }));
    case "executeIdentityAuthorityRotation":
      return toFactory(from, encodeFunctionData({ abi: factoryAbi, functionName: "executeIdentityAuthorityRotation" }));
    case "create":
      return toFactory(from, encodeFunctionData({ abi: factoryAbi, functionName: "create", args: [word(event.project), tokenOf(event.token, event.tokenReady), purposeCode[event.purpose]] }));
    case "createWithMonthlyCommitment":
      return toFactory(from, encodeFunctionData({
        abi: factoryAbi,
        functionName: "createWithMonthlyCommitment",
        args: [word(event.project), tokenOf(event.token, event.tokenReady), uint(event.cap, 128), event.on],
      }));
    case "deposit":
      return deposit(event, from);
    case "transferIn":
      return transferIn(event, from);
    case "commitAward":
      return toVault(from, commit("commitAward", event.source, event.actor, event.gross));
    case "commitBountyAward":
      return toVault(from, commit("commitBountyAward", event.source, event.actor, event.gross));
    case "setMonthlyCommitment":
      return toVault(from, () => encodeFunctionData({ abi: vaultAbi, functionName: "setMonthlyCommitment", args: [uint(event.cap, 128), event.on] }));
    case "commitMonthly":
      return commitMonthly(event, from);
    case "reserveMonthly":
      return reserveMonthly(event, from);
    case "commitMonthlyLeaf":
      return commitMonthlyLeaf(event, from);
    case "releaseMonthlyReserve":
      return releaseMonthlyReserve(event, from);
    case "bindDestination":
      return bindDestination(event, from);
    case "cancelBinding":
      return toVault(from, () => encodeFunctionData({ abi: vaultAbi, functionName: "cancelBinding", args: [uint(event.actor, 64), uint(event.expectedVersion, 64)] }));
    case "pay":
      return pay(event, from);
    case "withdrawUnused":
      return transferring(event.transferOk, ownerOf, () =>
        toVault(from, () => encodeFunctionData({ abi: vaultAbi, functionName: "withdrawUnused", args: [uint(event.gross, 128)] })));
    case "claimFees":
      return transferring(event.transferOk, feeRecipientOf, () => toVault(from, () => encodeFunctionData({ abi: vaultAbi, functionName: "claimFees" })));
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: async () => {
    fixture ??= await launch();
    await fixture.reset();
    walk = freshWalk();
  },
  dispatch: async (_key, event, by) => {
    try {
      return (await accepted(event, sender(by))) ? "accepted" : "refused";
    } catch (error) {
      if (error instanceof Unrepresentable) return "refused";
      throw error;
    }
  },
  observe: () => observe(ready(), walk),
  [Symbol.asyncDispose]: async () => {
    await fixture?.[Symbol.asyncDispose]();
    fixture = undefined;
  },
};

export const options: Options<Observed> = { view, keys: ["escrow"], walks: 25, steps: 24 };
