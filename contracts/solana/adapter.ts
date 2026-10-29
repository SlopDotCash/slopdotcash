import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { PaymentChainAdapter } from "../../backend/payments/ledger";
import { decodeBase58Bytes } from "../../src/lib/base58";
import {
  acceptsPayoutFee,
  type PayoutPolicy,
} from "../../src/lib/payments/contracts";
import type { VaultTotals } from "../vault-totals";
import {
  readTokenAccount,
  readTokenMint,
  type TokenMintReading,
} from "./token-extensions";

export interface SolanaEscrowConfig {
  payoutPolicy?: PayoutPolicy;
  rpcUrl: string;
  genesisHash: string;
  programId: string;
  projectPda: string;
  projectId: string;
  network: string;
  networkDomain: string;
  vault: string;
  mint: string;
  owner: string;
  /** The identity authority at activation. Later authorities come only from the program's
   * owner-proposed, rotation-authority-confirmed, timelocked rotation, so it is not compared with
   * live state. */
  identityAuthority: string;
  /** Must equal both the fee recipient pinned in the program's Config PDA and the project's
   * stored fee recipient. */
  feeRecipient: string;
  /** Independent confirmation key, never held by the fee converter. */
  rotationAuthority: string;
  codeSha256: string;
  upgradeAuthority: string | null;
  /** Receipt slot whose executed program must still be verifiable. */
  executedAtSlot?: number;
  /** Reviewed delay, in seconds, before a wallet binding can pay in this project. */
  bindingDelaySeconds: string;
  /** Reviewed notice period, in seconds, before a proposed identity authority takes effect. */
  rotationDelaySeconds: string;
}
/** Reviewed network program and Config, independent of any project vault. */
export type SolanaProgramConfig = Omit<
  SolanaEscrowConfig,
  "payoutPolicy" | "projectPda" | "projectId" | "vault" | "mint" | "owner"
>;
/** Project account size: 257 bytes of core state, the pending identity authority, its
 * effective time and confirmation, the i64 rotation delay, then the u8 purpose, the u64
 * monthly cap, the monthly on/off switch, the u64 accrued fees and the u64 outstanding
 * monthly gross. */
export const PROJECT_SIZE = 332;
/** Wallet binding size: 160 bytes of latest-binding state plus the u64 paid version and u8 veto count. */
export const BINDING_SIZE = 169;
/** Obligation size: 137 bytes of v2 state plus the i64 commit time. */
export const OBLIGATION_SIZE = 145;
export const OBLIGATION_DISCRIMINATOR = "a8ce8d6a584caca7";
export const PROJECT_DISCRIMINATOR = "cda8bdcab5f78e13";
/** Config size: discriminator, identity authority, fee recipient, rotation authority and bump. */
export const CONFIG_SIZE = 105;
type Obj = Record<string, unknown>;
const object = (value: unknown): Obj => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid RPC object");
  return value as Obj;
};
const string = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("Invalid RPC string");
  return value;
};
const list = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("Invalid RPC list");
  return value;
};
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const encoder = new TextEncoder();
const anchorDiscriminator = (name: string) =>
  hex(sha256(encoder.encode(`global:${name}`)).slice(0, 8));
const COMMIT = anchorDiscriminator("commit"),
  COMMIT_BOUNTY = anchorDiscriminator("commit_bounty"),
  COMMIT_MONTHLY_AWARD = anchorDiscriminator("commit_monthly_award"),
  PAY = anchorDiscriminator("pay");
export const CONFIG_DISCRIMINATOR = hex(
  sha256(encoder.encode("account:Config")).slice(0, 8),
);
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
function base58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let result = "";
  while (value > 0n) {
    result = alphabet[Number(value % 58n)] + result;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = `1${result}`;
  }
  return result;
}
const uint = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(
    offset,
    true,
  );
const pubkey = (bytes: Uint8Array, offset: number) =>
  base58(bytes.slice(offset, offset + 32));
function publicKeyBytes(value: string): Uint8Array {
  const bytes = decodeBase58Bytes(value);
  if (bytes.length !== 32) throw new Error("Invalid public key");
  return bytes;
}
/** Solana `find_program_address`: the first bump from 255 down whose hash is off the curve. */
function programAddress(programId: string, seeds: Uint8Array[]): string {
  const program = publicKeyBytes(programId);
  const marker = encoder.encode("ProgramDerivedAddress");
  for (let bump = 255; bump >= 0; bump--) {
    const input = new Uint8Array(
      seeds.reduce((n, s) => n + s.length, 0) + 1 + 32 + marker.length,
    );
    let offset = 0;
    for (const s of seeds) {
      input.set(s, offset);
      offset += s.length;
    }
    input[offset++] = bump;
    input.set(program, offset);
    input.set(marker, offset + 32);
    const candidate = sha256(input);
    try {
      ed25519.Point.fromBytes(candidate);
    } catch {
      return base58(candidate);
    }
  }
  throw new Error("No program address");
}
/** The program's singleton Config PDA (seeds `["config"]`). */
export function solanaConfigAddress(programId: string): string {
  return programAddress(programId, [encoder.encode("config")]);
}
/** The project's vault PDA (seeds `["vault", project]`). */
export function solanaVaultAddress(
  programId: string,
  projectPda: string,
): string {
  return programAddress(programId, [
    encoder.encode("vault"),
    publicKeyBytes(projectPda),
  ]);
}
function digest(value: string): Uint8Array {
  const plain = value.replace(/^0x/, "");
  if (!/^[a-fA-F0-9]{64}$/.test(plain))
    throw new Error("Invalid obligation digest");
  return Uint8Array.from(plain.match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
}
/** The RPC did not answer: a refused connection, a timeout, an HTTP error
 * such as 429, or an unreadable or failed JSON-RPC response. It proves
 * nothing about chain state, so the caller can only try again later. */
export class SolanaRpcUnavailable extends Error {}
async function rpc(
  config: { rpcUrl: string },
  method: string,
  params: unknown[],
): Promise<unknown> {
  let body: Obj;
  try {
    const response = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new SolanaRpcUnavailable(`RPC HTTP failure ${response.status}`);
    body = object(await response.json());
  } catch (error) {
    if (error instanceof SolanaRpcUnavailable) throw error;
    // Keep the cause; the URL and the response body are not in the message.
    throw new SolanaRpcUnavailable("RPC failure", { cause: error });
  }
  if (body.id !== 1 || body.error || !("result" in body))
    throw new SolanaRpcUnavailable("RPC failure");
  return body.result;
}
function account(
  value: unknown,
  owner: string,
  size: number,
  discriminator: string,
): Uint8Array {
  const info = object(value);
  if (info.owner !== owner) throw new Error("Account owner mismatch");
  const data = list(info.data);
  if (data[1] !== "base64") throw new Error("Wrong account encoding");
  const bytes = decode(string(data[0]));
  if (bytes.length !== size || hex(bytes.slice(0, 8)) !== discriminator)
    throw new Error("Account layout mismatch");
  return bytes;
}

/** Reads the mint account at finalized commitment under the approved token programs. */
async function liveMint(
  config: { rpcUrl: string },
  mint: string,
): Promise<TokenMintReading> {
  const response = object(
    await rpc(config, "getAccountInfo", [
      mint,
      { commitment: "finalized", encoding: "base64" },
    ]),
  );
  if (response.value === null) throw new Error("Mint account missing");
  return readTokenMint(response.value, decodeBase58Bytes(mint));
}
/** The admitted program and decimals used to construct owner and payment instructions. */
export async function solanaMintDetails(
  config: { rpcUrl: string },
  mint: string,
): Promise<{ decimals: number; tokenProgram: string }> {
  const reading = await liveMint(config, mint);
  return { decimals: reading.decimals, tokenProgram: reading.program };
}
/** Reads the mint's decimals at finalized commitment. */
export async function solanaMintDecimals(
  config: { rpcUrl: string },
  mint: string,
): Promise<number> {
  return (await liveMint(config, mint)).decimals;
}

/** Verify finalized program bytes, loader, upgrade authority and singleton Config. */
export async function verifySolanaProgram(
  config: SolanaProgramConfig,
): Promise<Uint8Array> {
  if (!/^[0-9a-f]{64}$/.test(config.codeSha256))
    throw new Error("Missing reviewed program digest");
  if ((await rpc(config, "getGenesisHash", [])) !== config.genesisHash)
    throw new Error("Wrong Solana cluster");
  if (
    config.executedAtSlot !== undefined &&
    (!Number.isSafeInteger(config.executedAtSlot) || config.executedAtSlot < 0)
  )
    throw new Error("Invalid receipt slot");
  // The owner explicitly retains upgrade control. Verify the configured authority
  // below together with the exact finalized program bytes.
  for (const delay of [config.bindingDelaySeconds, config.rotationDelaySeconds])
    if (
      !/^(0|[1-9][0-9]{0,18})$/.test(delay) ||
      BigInt(delay) > (1n << 63n) - 1n
    )
      throw new Error("Missing reviewed binding or rotation delay");
  const response = object(
    await rpc(config, "getAccountInfo", [
      config.programId,
      { commitment: "finalized", encoding: "base64" },
    ]),
  );
  const program = object(response.value),
    data = list(program.data);
  if (program.executable !== true || data[1] !== "base64")
    throw new Error("Program is not executable");
  let code = decode(string(data[0]));
  if (program.owner === "BPFLoaderUpgradeab1e11111111111111111111111") {
    if (
      code.length !== 36 ||
      new DataView(code.buffer).getUint32(0, true) !== 2
    )
      throw new Error("Invalid upgradeable program pointer");
    const pd = object(
      object(
        await rpc(config, "getAccountInfo", [
          pubkey(code, 4),
          { commitment: "finalized", encoding: "base64" },
        ]),
      ).value,
    );
    const pdData = list(pd.data);
    if (
      pd.owner !== program.owner ||
      pd.executable !== false ||
      pdData[1] !== "base64"
    )
      throw new Error("ProgramData owner mismatch");
    const content = decode(string(pdData[0]));
    if (
      content.length <= 45 ||
      new DataView(content.buffer).getUint32(0, true) !== 3 ||
      content[12] > 1
    )
      throw new Error("Invalid ProgramData metadata");
    const authority = content[12] === 1 ? pubkey(content, 13) : null;
    if (authority !== config.upgradeAuthority)
      throw new Error("Upgrade authority mismatch");
    if (
      config.executedAtSlot !== undefined &&
      new DataView(content.buffer, content.byteOffset).getBigUint64(4, true) >=
        BigInt(config.executedAtSlot)
    )
      throw new Error(
        "Program version was not effective before the receipt slot",
      );
    code = content.slice(45);
  } else if (
    program.owner !== "BPFLoader2111111111111111111111111111111111" ||
    config.upgradeAuthority !== null
  )
    throw new Error("Unsupported program loader or authority");
  if (hex(sha256(code)) !== config.codeSha256)
    throw new Error("Deployed program bytes differ from reviewed digest");
  // L-3: the program pins the identity authority and fee recipient of every new project
  // in its singleton Config. A project whose fee recipient differs (for example one
  // created before the Config existed) is refused, and so is a deployment without a Config.
  const configInfo = object(
    await rpc(config, "getAccountInfo", [
      solanaConfigAddress(config.programId),
      { commitment: "finalized", encoding: "base64" },
    ]),
  );
  if (configInfo.value === null) throw new Error("Escrow Config missing");
  const pinned = account(
    configInfo.value,
    config.programId,
    CONFIG_SIZE,
    CONFIG_DISCRIMINATOR,
  );
  if (
    pubkey(pinned, 40) !== config.feeRecipient ||
    pubkey(pinned, 8) !== config.identityAuthority ||
    pubkey(pinned, 72) !== config.rotationAuthority
  )
    throw new Error("Authorities differ from the pinned escrow Config");
  return pinned;
}

/** Bind the reviewed deployment to finalized executable bytes and all project authorities. */
export async function verifySolanaDeployment(
  config: SolanaEscrowConfig,
  expectedProjectDigest?: string,
): Promise<Uint8Array> {
  await verifySolanaProgram(config);
  const info = object(
    await rpc(config, "getAccountInfo", [
      config.projectPda,
      { commitment: "finalized", encoding: "base64" },
    ]),
  );
  const project = account(
    info.value,
    config.programId,
    PROJECT_SIZE,
    PROJECT_DISCRIMINATOR,
  );
  if (
    expectedProjectDigest !== undefined &&
    (hex(project.slice(40, 72)) !== hex(digest(expectedProjectDigest)) ||
      config.projectPda !==
        programAddress(config.programId, [
          encoder.encode("project"),
          publicKeyBytes(config.owner),
          digest(expectedProjectDigest),
          Uint8Array.of(solanaProjectPurpose(config.payoutPolicy)),
        ]) ||
      config.vault !== solanaVaultAddress(config.programId, config.projectPda))
  )
    throw new Error("The vault belongs to a different registry project.");
  const view = new DataView(project.buffer, project.byteOffset);
  if (project[306] !== solanaProjectPurpose(config.payoutPolicy))
    throw new Error("Project purpose does not match the payout policy");
  if (
    view.getBigInt64(249, true) !== BigInt(config.bindingDelaySeconds) ||
    view.getBigInt64(298, true) !== BigInt(config.rotationDelaySeconds) ||
    pubkey(project, 8) !== config.owner ||
    pubkey(project, 136) !== config.feeRecipient ||
    pubkey(project, 168) !== config.mint ||
    hex(project.slice(72, 104)) !== hex(digest(config.networkDomain))
  )
    throw new Error("Reviewed project authorities or asset mismatch");
  return project;
}

export interface SolanaAuthorityRotation {
  identityAuthority: string;
  /** Null when no rotation is proposed. */
  pendingIdentityAuthority: string | null;
  effectiveAt: string | null;
  confirmed: boolean;
  rotationDelaySeconds: string;
}
/** The identity authority in force and any pending rotation, from finalized project state. */
export function solanaAuthorityRotation(
  project: Uint8Array,
): SolanaAuthorityRotation {
  if (project.length !== PROJECT_SIZE)
    throw new Error("Account layout mismatch");
  const view = new DataView(project.buffer, project.byteOffset);
  const pending = pubkey(project, 257);
  const proposed = pending !== "11111111111111111111111111111111";
  return {
    identityAuthority: pubkey(project, 104),
    pendingIdentityAuthority: proposed ? pending : null,
    effectiveAt: proposed ? view.getBigInt64(289, true).toString() : null,
    confirmed: proposed && project[297] === 1,
    rotationDelaySeconds: view.getBigInt64(298, true).toString(),
  };
}

/** The program's project purpose for a payout policy: 0 ordinary awards, 1 private bounties. It
 * is the last project PDA seed: ["project", owner, project ID, purpose]. */
export function solanaProjectPurpose(policy: PayoutPolicy = "ordinary") {
  return policy === "security-bounty" ? 1 : 0;
}

const U64 = (1n << 64n) - 1n;
/** One award of a monthly allocation, in allocation order. */
export interface SolanaMonthlyEntry {
  githubUserId: string;
  grossMicro: string;
  sourceDigest: string;
}
const le = (value: string | bigint, bytes: number) => {
  const out = new Uint8Array(bytes);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};
function monthlyLeaf(entry: SolanaMonthlyEntry) {
  if (
    !/^[1-9][0-9]*$/.test(entry.githubUserId) ||
    !/^[1-9][0-9]*$/.test(entry.grossMicro) ||
    BigInt(entry.githubUserId) > U64 ||
    BigInt(entry.grossMicro) > U64
  )
    throw new Error("Invalid monthly award");
  return sha256(
    concat(
      Uint8Array.of(0),
      le(entry.githubUserId, 8),
      le(entry.grossMicro, 8),
      digest(entry.sourceDigest),
    ),
  );
}
type AllocationNode = { hash: Uint8Array; total: bigint };
const node = (left: AllocationNode, right: AllocationNode): AllocationNode => {
  const total = left.total + right.total;
  if (total > U64) throw new Error("Monthly total overflow");
  return {
    hash: sha256(
      concat(
        Uint8Array.of(1),
        left.hash,
        le(left.total.toString(), 8),
        right.hash,
        le(right.total.toString(), 8),
      ),
    ),
    total,
  };
};
function levels(entries: readonly SolanaMonthlyEntry[]) {
  if (entries.length === 0 || entries.length > 0xffffffff)
    throw new Error("Invalid monthly allocation size");
  // A repeated source can never commit twice, so its reserve could only be released.
  if (
    new Set(entries.map((entry) => hex(digest(entry.sourceDigest)))).size !==
    entries.length
  )
    throw new Error("Monthly allocation repeats a source");
  const tree: AllocationNode[][] = [
    entries.map((entry) => ({
      hash: monthlyLeaf(entry),
      total: BigInt(entry.grossMicro),
    })),
  ];
  while (tree[tree.length - 1].length > 1) {
    const level = tree[tree.length - 1];
    const next: AllocationNode[] = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(i + 1 < level.length ? node(level[i], level[i + 1]) : level[i]);
    tree.push(next);
  }
  return tree;
}
/** Merkle sum root binding the complete allocation and its aggregate gross. */
export function solanaAllocationRoot(entries: readonly SolanaMonthlyEntry[]) {
  const tree = levels(entries);
  return hex(tree[tree.length - 1][0].hash);
}
export function solanaAllocationTotal(entries: readonly SolanaMonthlyEntry[]) {
  const tree = levels(entries);
  return tree[tree.length - 1][0].total.toString();
}
/** Sibling digests and sums needed to verify an award's complete funded allocation. */
export function solanaAllocationProof(
  entries: readonly SolanaMonthlyEntry[],
  index: number,
) {
  const tree = levels(entries);
  if (!Number.isSafeInteger(index) || index < 0 || index >= entries.length)
    throw new Error("Invalid allocation index");
  const proof: { hash: string; total: string }[] = [];
  let at = index;
  for (const level of tree.slice(0, -1)) {
    const sibling = at % 2 === 1 ? at - 1 : at + 1;
    if (sibling < level.length)
      proof.push({
        hash: hex(level[sibling].hash),
        total: level[sibling].total.toString(),
      });
    at = Math.floor(at / 2);
  }
  return proof;
}
/** The bytes the identity authority signs for one period ("YYYY-MM") of one project.
 * `frozenAt` is the Unix second at which the attester froze the allocation, after it
 * checked that no included source was consumed. */
export function solanaMonthlyMessage(
  programId: string,
  projectPda: string,
  period: string,
  allocationRoot: string,
  total: string,
  frozenAt: string,
  network: string,
) {
  const match = /^([2-9][0-9]{3})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) throw new Error("Invalid monthly period");
  const yyyymm = new Uint8Array(4);
  new DataView(yyyymm.buffer).setUint32(0, Number(match[1] + match[2]), true);
  return concat(
    new TextEncoder().encode("slop-monthly-allocation-v3"),
    publicKeyBytes(programId),
    publicKeyBytes(projectPda),
    yyyymm,
    digest(allocationRoot),
    le(total, 8),
    le(frozenAt, 8),
    digest(network),
  );
}

/** The only award ID the program accepts for a source in this project. */
export function solanaAwardId(
  projectPda: string,
  sourceDigest: string,
): string {
  return hex(
    sha256(
      new Uint8Array([
        ...encoder.encode("slop-escrow-award"),
        ...decodeBase58Bytes(projectPda),
        ...digest(sourceDigest),
      ]),
    ),
  );
}

export interface EscrowInvocation {
  /** Position in the transaction's flattened instruction list. */
  index: number;
  kind: "reserved" | "paid";
  accounts: string[];
  data: Uint8Array;
  /** For a commit: the award ID argument, hex. `commit_monthly_award` puts its u32
   * period first, so its ID sits 4 bytes later than in `commit` and `commit_bounty`. */
  awardId?: string;
  /** Direct child instructions of this invocation, in order. */
  children: Obj[];
}
/**
 * Flattens top-level and inner instructions in execution order and returns each
 * escrow commit or pay, wherever it ran (including through a multisig CPI).
 * Logs are not used: they can be truncated by unrelated instructions.
 */
export function escrowInvocations(
  tx: Obj,
  programId: string,
): EscrowInvocation[] {
  const meta = object(tx.meta),
    message = object(object(tx.transaction).message);
  const inner = new Map<number, unknown[]>();
  for (const group of list(meta.innerInstructions ?? []).map(object))
    inner.set(Number(group.index), list(group.instructions));
  const flat: { ix: Obj; height: number; top: number }[] = [];
  list(message.instructions).forEach((value, top) => {
    flat.push({ ix: object(value), height: 1, top });
    for (const child of inner.get(top) ?? []) {
      const ix = object(child);
      if (!Number.isSafeInteger(ix.stackHeight) || Number(ix.stackHeight) < 2)
        throw new Error("Missing inner instruction stack height");
      flat.push({ ix, height: Number(ix.stackHeight), top });
    }
  });
  const found: EscrowInvocation[] = [];
  flat.forEach((entry, index) => {
    if (entry.ix.programId !== programId) return;
    const data = decodeBase58Bytes(string(entry.ix.data));
    const tag = hex(data.slice(0, 8));
    if (
      tag !== COMMIT &&
      tag !== COMMIT_BOUNTY &&
      tag !== COMMIT_MONTHLY_AWARD &&
      tag !== PAY
    )
      return;
    const children: Obj[] = [];
    for (let next = index + 1; next < flat.length; next++) {
      const candidate = flat[next];
      if (candidate.top !== entry.top || candidate.height <= entry.height)
        break;
      if (candidate.height === entry.height + 1) children.push(candidate.ix);
    }
    const awardAt = tag === COMMIT_MONTHLY_AWARD ? 12 : 8;
    found.push({
      index,
      kind: tag === PAY ? "paid" : "reserved",
      accounts: list(entry.ix.accounts).map(string),
      data,
      ...(tag === PAY
        ? {}
        : { awardId: hex(data.slice(awardAt, awardAt + 32)) }),
      children,
    });
  });
  return found;
}

/** Verifies the exact escrow instruction and its own token transfers, not the whole transaction. */
export function solanaPaymentAdapter(
  config: SolanaEscrowConfig,
): PaymentChainAdapter {
  return {
    // Lets the ledger skip re-verifying evidence it already stored.
    deployment: {
      projectId: config.projectId,
      network: config.network,
      vault: config.vault,
    },
    async verifyFinalized(input) {
      if (!Number.isSafeInteger(input.eventIndex) || input.eventIndex < 0)
        throw new Error("Invalid instruction index");
      if (decodeBase58Bytes(input.transactionId).length !== 64)
        throw new Error("Invalid signature");
      await verifySolanaDeployment(config);
      const status = object(
        await rpc(config, "getSignatureStatuses", [
          [input.transactionId],
          { searchTransactionHistory: true },
        ]),
      );
      const statusValue = object(list(status.value)[0]);
      if (
        statusValue.err !== null ||
        statusValue.confirmationStatus !== "finalized"
      )
        throw new Error("Transaction not finalized");
      const tx = object(
        await rpc(config, "getTransaction", [
          input.transactionId,
          {
            commitment: "finalized",
            encoding: "jsonParsed",
            maxSupportedTransactionVersion: 0,
          },
        ]),
      );
      const meta = object(tx.meta),
        transaction = object(tx.transaction);
      if (
        meta.err !== null ||
        list(transaction.signatures)[0] !== input.transactionId ||
        tx.slot !== statusValue.slot
      )
        throw new Error("Transaction mismatch");
      const invocation = escrowInvocations(tx, config.programId).find(
        (entry) => entry.index === input.eventIndex,
      );
      if (!invocation || invocation.kind !== input.kind)
        throw new Error("Exact escrow instruction missing");
      const award = digest(input.obligationId);
      const found = list(
        await rpc(config, "getProgramAccounts", [
          config.programId,
          {
            commitment: "finalized",
            encoding: "base64",
            filters: [
              { dataSize: OBLIGATION_SIZE },
              { memcmp: { offset: 48, bytes: config.projectPda } },
              { memcmp: { offset: 80, bytes: b64(award), encoding: "base64" } },
            ],
          },
        ]),
      );
      if (found.length !== 1)
        throw new Error("Ambiguous or missing durable award");
      const awardAddress = string(object(found[0]).pubkey);
      const obligation = account(
        object(found[0]).account,
        config.programId,
        OBLIGATION_SIZE,
        OBLIGATION_DISCRIMINATOR,
      );
      const gross = uint(obligation, 8),
        actor = uint(obligation, 112),
        net = uint(obligation, 120),
        fee = uint(obligation, 128),
        source = hex(obligation.slice(16, 48));
      if (
        gross === 0n ||
        actor === 0n ||
        gross !== net + fee ||
        !acceptsPayoutFee(gross, fee, config.payoutPolicy) ||
        solanaAwardId(config.projectPda, source) !== hex(award)
      )
        throw new Error("Invalid award accounting");
      const { accounts, data, children } = invocation;
      let destination: string | undefined;
      if (
        input.kind === "reserved" &&
        hex(data.slice(0, 8)) === COMMIT_MONTHLY_AWARD
      ) {
        // commit_monthly_award(period, award_id, source_digest, actor_id, gross, index, count,
        // proof); accounts: payer, project, vault, month, origin, obligation, settled. Ordinary only.
        if (
          config.payoutPolicy === "security-bounty" ||
          data.length < 104 ||
          data.length !==
            104 +
              40 *
                new DataView(data.buffer, data.byteOffset).getUint32(
                  100,
                  true,
                ) ||
          accounts[1] !== config.projectPda ||
          accounts[5] !== awardAddress ||
          hex(data.slice(12, 44)) !== hex(award) ||
          hex(data.slice(44, 76)) !== source ||
          uint(data, 76) !== actor ||
          uint(data, 84) !== gross
        )
          throw new Error("Reservation differs from award");
      } else if (input.kind === "reserved") {
        // commit(award_id, source_digest, actor_id, gross); accounts: owner, project, vault, origin, obligation.
        if (
          hex(data.slice(0, 8)) !==
            (config.payoutPolicy === "security-bounty"
              ? COMMIT_BOUNTY
              : COMMIT) ||
          data.length !== 88 ||
          accounts[1] !== config.projectPda ||
          accounts[4] !== awardAddress ||
          hex(data.slice(8, 40)) !== hex(award) ||
          hex(data.slice(40, 72)) !== source ||
          uint(data, 72) !== actor ||
          uint(data, 80) !== gross
        )
          throw new Error("Reservation differs from award");
      } else {
        // pay(expected_version); accounts: project, obligation, binding, mint, vault, destination.
        if (
          data.length !== 16 ||
          obligation[136] !== 1 ||
          accounts[0] !== config.projectPda ||
          accounts[1] !== awardAddress ||
          accounts[3] !== config.mint ||
          accounts[4] !== config.vault
        )
          throw new Error("Payment differs from award");
        // The fee accrues in the vault; a zero-net award makes no token transfer.
        const expected = net === 0n ? [] : [{ to: accounts[5], amount: net }];
        if (children.length !== expected.length)
          throw new Error("Unexpected payout instructions");
        // Only the mint's own token program may carry the transfer, and the transfer
        // decimals must equal that mint's.
        const mintReading = await liveMint(config, config.mint);
        children.forEach((child, i) => {
          const parsed = object(child.parsed),
            info = object(parsed.info),
            amount = object(info.tokenAmount);
          if (
            child.programId !== mintReading.program ||
            parsed.type !== "transferChecked" ||
            info.source !== config.vault ||
            info.mint !== config.mint ||
            info.authority !== config.projectPda ||
            info.destination !== expected[i].to ||
            amount.decimals !== mintReading.decimals ||
            amount.amount !== expected[i].amount.toString()
          )
            throw new Error("Payout transfer differs from award");
        });
        const keys = list(object(transaction.message).accountKeys).map(
          (entry) => string(object(entry).pubkey),
        );
        const ownerOf = (address: string) => {
          const index = keys.indexOf(address);
          // A recipient can spend the payout and close its token account later
          // in this transaction. The post-state then omits the closed account,
          // but the finalized pre-state still attests to its mint and owner.
          const balances = [meta.postTokenBalances, meta.preTokenBalances]
            .flatMap(list)
            .map(object);
          const balance = balances.find(
            (item) => item.accountIndex === index && item.mint === config.mint,
          );
          if (index < 0 || !balance || balance.mint !== config.mint)
            throw new Error("Payout account balance missing");
          return string(balance.owner);
        };
        destination = ownerOf(accounts[5]);
      }
      const block = object(
        await rpc(config, "getBlock", [
          tx.slot,
          {
            commitment: "finalized",
            transactionDetails: "none",
            rewards: false,
            maxSupportedTransactionVersion: 0,
          },
        ]),
      );
      return {
        kind: input.kind,
        transactionId: input.transactionId,
        eventIndex: input.eventIndex,
        blockId: string(block.blockhash),
        obligationId: input.obligationId,
        projectId: config.projectId,
        network: config.network,
        chain: "solana",
        vault: config.vault,
        githubUserId: actor.toString(),
        grossMicro: gross.toString(),
        netMicro: net.toString(),
        feeMicro: fee.toString(),
        sourceDigest: source,
        ...(destination ? { destination } : {}),
      };
    },
  };
}

/**
 * Reads the project's counters and mint decimals from one finalized slot. Counters are
 * token base units as decimal text. `freeBalance` is the credited balance not reserved
 * or spent; unsolicited transfers to the vault do not raise it.
 */
export async function readVaultTotals(config: {
  rpcUrl: string;
  network: string;
  projectPda: string;
  programId: string;
}): Promise<VaultTotals> {
  const first = object(
    await rpc(config, "getAccountInfo", [
      config.projectPda,
      { commitment: "finalized", encoding: "base64" },
    ]),
  );
  if (first.value === null) throw new Error("Project account missing");
  const mint = pubkey(
    account(first.value, config.programId, PROJECT_SIZE, PROJECT_DISCRIMINATOR),
    168,
  );
  // Project, mint and vault token account come from one finalized slot.
  const vault = solanaVaultAddress(config.programId, config.projectPda);
  const response = object(
    await rpc(config, "getMultipleAccounts", [
      [config.projectPda, mint, vault],
      { commitment: "finalized", encoding: "base64" },
    ]),
  );
  const slot = object(response.context).slot;
  if (!Number.isSafeInteger(slot) || Number(slot) < 0)
    throw new Error("Invalid RPC slot");
  const [projectInfo, mintInfo, vaultInfo] = list(response.value);
  if (projectInfo === null || mintInfo === null || vaultInfo === null)
    throw new Error("Project, mint or vault account missing");
  const project = account(
    projectInfo,
    config.programId,
    PROJECT_SIZE,
    PROJECT_DISCRIMINATOR,
  );
  if (pubkey(project, 168) !== mint) throw new Error("Project mint changed");
  const mintReading = readTokenMint(mintInfo, decodeBase58Bytes(mint));
  const decimals = mintReading.decimals;
  const time = await rpc(config, "getBlockTime", [slot]);
  if (!Number.isSafeInteger(time))
    throw new Error("Missing finalized block time");
  const reserved = uint(project, 200),
    deposited = uint(project, 208),
    paid = uint(project, 216),
    payoutFees = uint(project, 224),
    withdrawnGross = uint(project, 232),
    withdrawalFees = uint(project, 240),
    accruedFees = uint(project, 316);
  const free = deposited - paid - payoutFees - withdrawnGross - reserved;
  if (free < 0n) throw new Error("Project counters exceed deposits");
  // As on EVM, fail closed when the vault holds less than the counters owe.
  const vaultReading = readTokenAccount(vaultInfo);
  if (vaultReading.program !== mintReading.program)
    throw new Error("Vault token program differs from the mint");
  const vaultAccount = vaultReading.raw;
  if (
    pubkey(vaultAccount, 0) !== mint ||
    pubkey(vaultAccount, 32) !== config.projectPda ||
    uint(vaultAccount, 64) < free + reserved + accruedFees
  )
    throw new Error("Vault balance is below free, reserved and accrued fees");
  return {
    network: config.network,
    vault: config.projectPda,
    asset: mint,
    decimals,
    blockNumber: String(slot),
    blockTime: new Date(Number(time) * 1000).toISOString(),
    totalDeposited: deposited.toString(),
    totalPaid: paid.toString(),
    totalPayoutFees: payoutFees.toString(),
    totalGrossWithdrawn: withdrawnGross.toString(),
    totalWithdrawalFees: withdrawalFees.toString(),
    freeBalance: free.toString(),
    reservedPrincipal: null,
    reservedFees: null,
    accruedFees: accruedFees.toString(),
    reserved: reserved.toString(),
  };
}

export {
  account as solanaAccount,
  b64 as solanaBase64,
  base58 as solanaBase58,
  decode as solanaBase64Bytes,
  digest as solanaDigest,
  programAddress as solanaProgramAddress,
  pubkey as solanaPubkey,
  publicKeyBytes as solanaPublicKeyBytes,
  rpc as solanaRpc,
  uint as solanaUint,
};
