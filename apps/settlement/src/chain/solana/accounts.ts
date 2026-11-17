// spec/contracts/solanaEscrow.md, "The vault holds exactly the free, reserved and accrued funds plus uncredited transfers, above its rent reserve"; spec/settlement/escrow.md, "On Solana an uncommittable leaf returns to free funds and a later hand commit strands it"; spec/settlement/monthlyCommitment.md, "Solana signs one freeze time and refuses a month whose source is already consumed"; spec/contracts/solanaEscrow.md, "The pre-pledge build's 332-byte project grows to the current layout with no open pledges"
import { sha256 } from "@noble/hashes/sha2.js";
import { type Account, type Address, type Decoded, type TokenAccount, SYSTEM_PROGRAM, addressOf, decodeTokenAccount } from "@repo/platform/chain/solana";
import { type Digest, type I64, type U64, digestOf, readI64, readU32, readU64, sameBytes, utf8 } from "./bytes.ts";
import { type Purpose, type TokenProgram, isTokenProgram } from "./pda.ts";

export const CONFIG_SIZE = 105;
export const PROJECT_SIZE = 340;
export const PRE_PLEDGE_PROJECT_SIZE = 332;
export const PROJECT_SIZES: ReadonlyArray<number> = [PRE_PLEDGE_PROJECT_SIZE, PROJECT_SIZE];
export const AWARD_SIZE = 145;
export const BINDING_SIZE = 169;
export const MONTH_SIZE = 109;
export const ORIGIN_SIZE = 40;
export const MARKER_SIZE = 8;
export const MONTH_PLEDGE_SIZE = 54;

export type AccountIssue =
  | "missing"
  | "wrongOwner"
  | "executable"
  | "wrongSize"
  | "wrongDiscriminator"
  | "invalidFlag"
  | "invalidPurpose"
  | "wrongMint"
  | "wrongAuthority"
  | "nativeVaultData"
  | "tokenAccountLayout";

/** @throws {never} */
export function accountDiscriminator(name: string): Uint8Array {
  return sha256(utf8(`account:${name}`)).slice(0, 8);
}

const discriminators = {
  Config: accountDiscriminator("Config"),
  Project: accountDiscriminator("Project"),
  Obligation: accountDiscriminator("Obligation"),
  WalletBinding: accountDiscriminator("WalletBinding"),
  MonthlyAllocation: accountDiscriminator("MonthlyAllocation"),
  Origin: accountDiscriminator("Origin"),
  BindingVeto: accountDiscriminator("BindingVeto"),
  MonthPledge: accountDiscriminator("MonthPledge"),
};

class Refused {
  constructor(readonly issue: AccountIssue) {}
}

function decodedBy<A>(read: () => A): Decoded<A, AccountIssue> {
  try {
    return { kind: "decoded", value: read() };
  } catch (error) {
    if (error instanceof Refused) return { kind: "malformed", issue: error.issue };
    throw error;
  }
}

function anchored(account: Account | undefined, program: Address, size: number | ReadonlyArray<number>, name: keyof typeof discriminators): Uint8Array {
  if (account === undefined) throw new Refused("missing");
  if (account.owner !== program) throw new Refused("wrongOwner");
  if (account.executable) throw new Refused("executable");
  if (!(typeof size === "number" ? [size] : size).includes(account.data.length)) throw new Refused("wrongSize");
  if (!sameBytes(account.data.subarray(0, 8), discriminators[name])) throw new Refused("wrongDiscriminator");
  return account.data;
}

function key(data: Uint8Array, at: number): Address {
  return addressOf(data.slice(at, at + 32)) as Address;
}

function hash(data: Uint8Array, at: number): Digest {
  return digestOf(data.slice(at, at + 32)) as Digest;
}

function flag(data: Uint8Array, at: number): boolean {
  const value = data[at];
  if (value !== 0 && value !== 1) throw new Refused("invalidFlag");
  return value === 1;
}

/** @throws {never} */
export function isInitialized(account: Account | undefined, program: Address): boolean {
  return account !== undefined && account.owner === program && account.data.length > 0;
}

export interface EscrowConfig {
  readonly identityAuthority: Address;
  readonly feeRecipient: Address;
  readonly rotationAuthority: Address;
  readonly bump: number;
}

/** @throws {never} */
export function decodeConfig(account: Account | undefined, program: Address): Decoded<EscrowConfig, AccountIssue> {
  return decodedBy(() => {
    const data = anchored(account, program, CONFIG_SIZE, "Config");
    return { identityAuthority: key(data, 8), feeRecipient: key(data, 40), rotationAuthority: key(data, 72), bump: data[104] as number };
  });
}

export interface ProjectAccount {
  readonly owner: Address;
  readonly projectId: Digest;
  readonly network: Digest;
  readonly identityAuthority: Address;
  readonly feeRecipient: Address;
  readonly mint: Address;
  readonly reserved: U64;
  readonly deposited: U64;
  readonly paid: U64;
  readonly payoutFees: U64;
  readonly withdrawnGross: U64;
  readonly withdrawalFees: U64;
  readonly bump: number;
  readonly bindingDelay: I64;
  readonly pendingIdentityAuthority: Address | undefined;
  readonly rotationEffectiveAt: I64;
  readonly rotationConfirmed: boolean;
  readonly rotationDelay: I64;
  readonly purpose: Purpose;
  readonly monthlyCap: U64;
  readonly monthlyEnabled: boolean;
  readonly accruedFees: U64;
  readonly monthlyOutstanding: U64;
}

function purposeAt(data: Uint8Array, at: number): Purpose {
  const value = data[at];
  if (value === 0) return "Ordinary";
  if (value === 1) return "Bounty";
  throw new Refused("invalidPurpose");
}

/** @throws {never} */
export function decodeProject(account: Account | undefined, program: Address): Decoded<ProjectAccount, AccountIssue> {
  return decodedBy(() => {
    const data = anchored(account, program, PROJECT_SIZES, "Project");
    const pending = key(data, 257);
    return {
      owner: key(data, 8),
      projectId: hash(data, 40),
      network: hash(data, 72),
      identityAuthority: key(data, 104),
      feeRecipient: key(data, 136),
      mint: key(data, 168),
      reserved: readU64(data, 200),
      deposited: readU64(data, 208),
      paid: readU64(data, 216),
      payoutFees: readU64(data, 224),
      withdrawnGross: readU64(data, 232),
      withdrawalFees: readU64(data, 240),
      bump: data[248] as number,
      bindingDelay: readI64(data, 249),
      pendingIdentityAuthority: pending === SYSTEM_PROGRAM ? undefined : pending,
      rotationEffectiveAt: readI64(data, 289),
      rotationConfirmed: flag(data, 297),
      rotationDelay: readI64(data, 298),
      purpose: purposeAt(data, 306),
      monthlyCap: readU64(data, 307),
      monthlyEnabled: flag(data, 315),
      accruedFees: readU64(data, 316),
      monthlyOutstanding: readU64(data, 324),
    };
  });
}

export interface AwardAccount {
  readonly gross: U64;
  readonly source: Digest;
  readonly project: Address;
  readonly awardId: Digest;
  readonly actor: U64;
  readonly principal: U64;
  readonly fee: U64;
  readonly paid: boolean;
  readonly committedAt: I64;
}

/** @throws {never} */
export function decodeAward(account: Account | undefined, program: Address): Decoded<AwardAccount, AccountIssue> {
  return decodedBy(() => {
    const data = anchored(account, program, AWARD_SIZE, "Obligation");
    return {
      gross: readU64(data, 8),
      source: hash(data, 16),
      project: key(data, 48),
      awardId: hash(data, 80),
      actor: readU64(data, 112),
      principal: readU64(data, 120),
      fee: readU64(data, 128),
      paid: flag(data, 136),
      committedAt: readI64(data, 137),
    };
  });
}

export interface BindingAccount {
  readonly claimDigest: Digest;
  readonly authority: Address;
  readonly actor: U64;
  readonly network: Digest;
  readonly destination: Address;
  readonly version: U64;
  readonly boundAt: I64;
  readonly paidVersion: U64;
  readonly vetoCount: number;
}

/** @throws {never} */
export function decodeBinding(account: Account | undefined, program: Address): Decoded<BindingAccount, AccountIssue> {
  return decodedBy(() => {
    const data = anchored(account, program, BINDING_SIZE, "WalletBinding");
    return {
      claimDigest: hash(data, 8),
      authority: key(data, 40),
      actor: readU64(data, 72),
      network: hash(data, 80),
      destination: key(data, 112),
      version: readU64(data, 144),
      boundAt: readI64(data, 152),
      paidVersion: readU64(data, 160),
      vetoCount: data[168] as number,
    };
  });
}

export interface MonthAccount {
  readonly project: Address;
  readonly period: number;
  readonly allocationRoot: Digest;
  readonly committed: U64;
  readonly total: U64;
  readonly released: U64;
  readonly frozenAt: I64;
  readonly expired: boolean;
}

/** @throws {never} */
export function decodeMonth(account: Account | undefined, program: Address): Decoded<MonthAccount, AccountIssue> {
  return decodedBy(() => {
    const data = anchored(account, program, MONTH_SIZE, "MonthlyAllocation");
    return {
      project: key(data, 8),
      period: readU32(data, 40),
      allocationRoot: hash(data, 44),
      committed: readU64(data, 76),
      total: readU64(data, 84),
      released: readU64(data, 92),
      frozenAt: readI64(data, 100),
      expired: flag(data, 108),
    };
  });
}

/** @throws {never} */
export function decodeOrigin(account: Account | undefined, program: Address): Decoded<{ readonly obligation: Address }, AccountIssue> {
  return decodedBy(() => ({ obligation: key(anchored(account, program, ORIGIN_SIZE, "Origin"), 8) }));
}

/** @throws {never} */
export function decodeMarker(account: Account | undefined, program: Address): Decoded<true, AccountIssue> {
  return decodedBy(() => {
    anchored(account, program, MARKER_SIZE, "BindingVeto");
    return true as const;
  });
}

/** @throws {never} */
export function decodeMonthPledgePresence(account: Account | undefined, program: Address): Decoded<boolean, AccountIssue> {
  return decodedBy(() => {
    if (account === undefined) return false;
    anchored(account, program, MONTH_PLEDGE_SIZE, "MonthPledge");
    return true;
  });
}

export type VaultAccount =
  | { readonly kind: "Native"; readonly lamports: bigint }
  | { readonly kind: "Token"; readonly tokenProgram: TokenProgram; readonly token: TokenAccount; readonly data: Uint8Array };

/** @throws {never} */
export function decodeVault(account: Account | undefined, expected: { readonly program: Address; readonly project: Address; readonly mint: Address }): Decoded<VaultAccount, AccountIssue> {
  return decodedBy((): VaultAccount => {
    if (account === undefined) throw new Refused("missing");
    if (account.executable) throw new Refused("executable");
    if (expected.mint === SYSTEM_PROGRAM) {
      if (account.owner !== expected.program) throw new Refused("wrongOwner");
      if (account.data.length !== 0) throw new Refused("nativeVaultData");
      return { kind: "Native", lamports: account.lamports };
    }
    const tokenProgram = account.owner;
    if (!isTokenProgram(tokenProgram)) throw new Refused("wrongOwner");
    const decoded = decodeTokenAccount(account.data);
    if (decoded.kind === "malformed") throw new Refused("tokenAccountLayout");
    if (decoded.value.mint !== expected.mint) throw new Refused("wrongMint");
    if (decoded.value.owner !== expected.project) throw new Refused("wrongAuthority");
    return { kind: "Token", tokenProgram, token: decoded.value, data: account.data };
  });
}
