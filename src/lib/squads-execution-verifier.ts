/** Worker/browser-safe exact instruction verifier, not payout verification.
 * Node CLI wrapper: scripts/verify-squads-execution.ts.
 * Usage: bun scripts/verify-squads-execution.ts --project <id> --allocation
 * <allocation.json> --plan <execution-plan.json> --base-ledger <trusted.json>
 * --ledger <candidate.json>
 * Both ledgers are canonical JSON arrays plus newline. The trusted Git gate
 * must provide the COMPLETE base; local CLI success confers no review authority.
 * Layout reference: Squads-Protocol/v4 @ af94153ff77a28b6effe46b9c94baaa93742b48c,
 * state/{proposal,vault_transaction}.rs and sdk/multisig/src/pda.ts.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import {
  MAX_TRANSFERS_PER_PLAN,
  type SettlementExecutionPlan,
  SOLANA_MAINNET_USDC_MINT,
} from "./settlement-plan";
import {
  executionSha256,
  isSquadsBatch,
  parseExecutionJson,
  SQUADS_EXECUTION_RPC_AUTHORITIES,
  type SquadsExecutionBinding,
  type SquadsExecutionObservation,
  squadsExecutionRootAccount,
  validateSquadsExecutionContext,
} from "./squads-execution";
import { SPL_TOKEN_PROGRAM_ID, SQUADS_V4_PROGRAM_ID } from "./squads-funding";

function data(
  value: string | number[] | Uint8Array,
  encoding: "utf8" | "hex" | "base64" = "utf8",
): Uint8Array {
  if (typeof value !== "string") return new Uint8Array(value);
  if (encoding === "utf8") return new TextEncoder().encode(value);
  if (encoding === "hex") {
    if (!/^(?:[a-f0-9]{2})*$/u.test(value))
      throw new TypeError("Invalid hex bytes");
    return Uint8Array.from(value.match(/../gu) ?? [], (pair) =>
      Number.parseInt(pair, 16),
    );
  }
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function base64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

const MAX_RPC_BYTES = 512 * 1024;
const MAX_ACCOUNT_BYTES = 64 * 1024;
type FetchLike = (url: URL, init?: RequestInit) => Promise<Response>;
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function publicKeyBytes(value: string): Uint8Array {
  let number = 0n;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new TypeError("Invalid account address");
    number = number * 58n + BigInt(digit);
  }
  const bytes = new Uint8Array(32);
  for (let index = 31; index >= 0; index--) {
    bytes[index] = Number(number & 255n);
    number >>= 8n;
  }
  if (number !== 0n) throw new TypeError("Account address overflow");
  return bytes;
}
function same(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid RPC object");
  return value as Record<string, unknown>;
}
function accountBytes(value: unknown): Uint8Array {
  const account = object(value);
  if (
    account.owner !== SQUADS_V4_PROGRAM_ID ||
    account.executable !== false ||
    !Array.isArray(account.data) ||
    account.data.length !== 2 ||
    account.data[1] !== "base64" ||
    typeof account.data[0] !== "string" ||
    account.data[0].length > MAX_ACCOUNT_BYTES * 2
  )
    throw new TypeError("Missing or foreign Squads account");
  const bytes = data(account.data[0], "base64");
  if (bytes.length > MAX_ACCOUNT_BYTES || base64(bytes) !== account.data[0])
    throw new TypeError("Invalid account encoding");
  return bytes;
}

export const ASSOCIATED_TOKEN_PROGRAM_ID =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
function encodeKey(bytes: Uint8Array): string {
  let number = BigInt(`0x${hex(bytes)}`);
  let result = "";
  while (number) {
    result = alphabet[Number(number % 58n)] + result;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = `1${result}`;
  }
  return result;
}
async function pda(
  seeds: Uint8Array[],
  program: string,
): Promise<{ address: string; bump: number }> {
  for (let bump = 255; bump >= 0; bump--) {
    const digest = data(
      await executionSha256(
        concat([
          ...seeds,
          data([bump]),
          publicKeyBytes(program),
          data("ProgramDerivedAddress"),
        ]),
      ),
      "hex",
    );
    let onCurve = true;
    try {
      ed25519.Point.fromBytes(digest);
    } catch {
      onCurve = false;
    }
    if (!onCurve) return { address: encodeKey(digest), bump };
  }
  throw new TypeError("No canonical PDA");
}
export async function squadsExecutionAddress(
  multisig: string,
  transactionIndex: string,
  proposal: boolean,
) {
  const index = new Uint8Array(8);
  new DataView(index.buffer).setBigUint64(0, BigInt(transactionIndex), true);
  return pda(
    [
      data("multisig"),
      publicKeyBytes(multisig),
      data("transaction"),
      index,
      ...(proposal ? [data("proposal")] : []),
    ],
    SQUADS_V4_PROGRAM_ID,
  );
}
export async function squadsBatchChildAddress(
  multisig: string,
  batchIndex: string,
  transactionIndex: number,
) {
  if (
    !Number.isInteger(transactionIndex) ||
    transactionIndex < 1 ||
    transactionIndex > 40
  )
    throw new TypeError("Invalid bounded child index");
  const batch = new Uint8Array(8),
    child = new Uint8Array(4);
  new DataView(batch.buffer).setBigUint64(0, BigInt(batchIndex), true);
  new DataView(child.buffer).setUint32(0, transactionIndex, true);
  return pda(
    [
      data("multisig"),
      publicKeyBytes(multisig),
      data("transaction"),
      batch,
      data("batch_transaction"),
      child,
    ],
    SQUADS_V4_PROGRAM_ID,
  );
}
export async function squadsUsdcAta(owner: string): Promise<string> {
  return (
    await pda(
      [
        publicKeyBytes(owner),
        publicKeyBytes(SPL_TOKEN_PROGRAM_ID),
        publicKeyBytes(SOLANA_MAINNET_USDC_MINT),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )
  ).address;
}
async function assertAddress(
  binding: SquadsExecutionBinding,
  bump: number,
  proposal: boolean,
) {
  const expected = await squadsExecutionAddress(
    binding.multisig,
    binding.transactionIndex,
    proposal,
  );
  if (
    bump !== expected.bump ||
    expected.address !==
      (proposal ? binding.proposalAccount : squadsExecutionRootAccount(binding))
  )
    throw new TypeError("Squads account PDA does not match binding");
}

/** Bounded Borsh decoder following the pinned official Squads Rust schema. */
class Reader {
  offset = 0;
  constructor(readonly bytes: Uint8Array) {}
  take(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length)
      throw new TypeError("Truncated Squads Borsh account");
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  u8() {
    return this.take(1)[0];
  }
  count(max: number) {
    const b = this.take(4);
    const value = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(
      0,
      true,
    );
    if (value > max)
      throw new TypeError("Squads vector exceeds supported bound");
    return value;
  }
  key() {
    return encodeKey(this.take(32));
  }
  end(padding = false) {
    if (
      padding
        ? this.take(this.bytes.length - this.offset).some((byte) => byte !== 0)
        : this.offset !== this.bytes.length
    )
      throw new TypeError("Unexpected trailing Squads account data");
  }
}

interface Lookup {
  address: string;
  writable: number[];
  readonly: number[];
}
export const LOOKUP_TABLE_PROGRAM_ID =
  "AddressLookupTab1e1111111111111111111111111";
function lookupKeys(value: unknown, slot: number): string[] {
  const a = object(value);
  if (
    a.owner !== LOOKUP_TABLE_PROGRAM_ID ||
    a.executable !== false ||
    !Array.isArray(a.data) ||
    a.data.length !== 2 ||
    a.data[1] !== "base64" ||
    typeof a.data[0] !== "string" ||
    a.data[0].length > 12000
  )
    throw new TypeError("Invalid lookup table account");
  const bytes = data(a.data[0], "base64");
  if (
    base64(bytes) !== a.data[0] ||
    bytes.length < 56 ||
    bytes.length > 56 + 256 * 32 ||
    (bytes.length - 56) % 32 !== 0 ||
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      0,
      true,
    ) !== 1 ||
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(
      4,
      true,
    ) !==
      (1n << 64n) - 1n ||
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(
      12,
      true,
    ) >= BigInt(slot) ||
    ![0, 1].includes(bytes[21])
  )
    throw new TypeError(
      "Malformed, deactivated or not-yet-stable lookup table",
    );
  return Array.from({ length: (bytes.length - 56) / 32 }, (_, i) =>
    encodeKey(bytes.subarray(56 + i * 32, 88 + i * 32)),
  );
}

async function decodeExactMessage(
  bytes: Uint8Array,
  binding: SquadsExecutionBinding,
  plan: SettlementExecutionPlan,
  resolveLookups: (
    lookups: Lookup[],
  ) => Promise<{ writable: string[]; readonly: string[]; digest: string }>,
  messageOffset = 83,
) {
  if (plan.transfers.length > MAX_TRANSFERS_PER_PLAN)
    throw new TypeError("Plan exceeds existing transfer contract");
  const r = new Reader(bytes);
  r.take(messageOffset);
  if (r.count(0) !== 0)
    throw new TypeError("Ephemeral signers are unsupported");
  const signers = r.u8(),
    writableSigners = r.u8(),
    writableNonSigners = r.u8();
  const keys = Array.from({ length: r.count(256) }, () => r.key());
  if (
    signers !== 1 ||
    writableSigners > 1 ||
    keys[0] !== binding.vault ||
    writableNonSigners > keys.length - 1 ||
    new Set(keys).size !== keys.length
  )
    throw new TypeError("Unexpected message signer or account privileges");
  const instructions = Array.from(
    { length: r.count(MAX_TRANSFERS_PER_PLAN * 2) },
    () => ({
      program: r.u8(),
      accounts: [...r.take(r.count(7))],
      data: r.take(r.count(10)),
    }),
  );
  const lookups: Lookup[] = Array.from({ length: r.count(32) }, () => ({
    address: r.key(),
    writable: [...r.take(r.count(256))],
    readonly: [...r.take(r.count(256))],
  }));
  r.end();
  if (new Set(lookups.map((row) => row.address)).size !== lookups.length)
    throw new TypeError("Duplicate lookup table");
  const resolved = await resolveLookups(lookups);
  const staticLength = keys.length;
  keys.push(...resolved.writable, ...resolved.readonly);
  if (keys.length > 256 || new Set(keys).size !== keys.length)
    throw new TypeError("Duplicate or excessive resolved message accounts");
  const writable = (index: number) =>
    index < writableSigners ||
    (index >= signers && index < signers + writableNonSigners) ||
    (index >= staticLength && index < staticLength + resolved.writable.length);
  const used = new Set<number>();
  const at = (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= keys.length)
      throw new TypeError("Instruction account index out of range");
    used.add(index);
    return keys[index];
  };
  const source = await squadsUsdcAta(binding.vault);
  const destinations = await Promise.all(
    plan.transfers.map(async (transfer) => ({
      ...transfer,
      ata: await squadsUsdcAta(transfer.recipientOwner),
    })),
  );
  const creates = new Set<string>();
  const paidDestinations = new Set<string>();
  let transferIndex = 0;
  for (const ix of instructions) {
    const program = at(ix.program);
    if (writable(ix.program) || ix.program < signers)
      throw new TypeError("Program account has unexpected privileges");
    const accounts = ix.accounts.map(at);
    if (program === ASSOCIATED_TOKEN_PROGRAM_ID) {
      const target = destinations.find(
        (row) => row.ata === accounts[1] && row.recipientOwner === accounts[2],
      );
      if (
        !target ||
        creates.has(target.ata) ||
        paidDestinations.has(target.ata) ||
        accounts.length !== 6 ||
        accounts[0] !== binding.vault ||
        accounts[3] !== SOLANA_MAINNET_USDC_MINT ||
        accounts[4] !== "11111111111111111111111111111111" ||
        accounts[5] !== SPL_TOKEN_PROGRAM_ID ||
        ix.data.length !== 1 ||
        ![0, 1].includes(ix.data[0]) ||
        !writable(ix.accounts[0]) ||
        !writable(ix.accounts[1]) ||
        ix.accounts.slice(2).some((index) => writable(index) || index < signers)
      )
        throw new TypeError(
          "ATA creation is not an allowed planned recipient creation",
        );
      creates.add(target.ata);
    } else if (program === SPL_TOKEN_PROGRAM_ID) {
      const target = destinations[transferIndex++];
      const checked = ix.data[0] === 12;
      const expected = checked
        ? [source, SOLANA_MAINNET_USDC_MINT, target?.ata, binding.vault]
        : [source, target?.ata, binding.vault];
      if (
        !target ||
        (!checked && ix.data[0] !== 3) ||
        ix.data.length !== (checked ? 10 : 9) ||
        accounts.length !== expected.length ||
        accounts.some((key, index) => key !== expected[index]) ||
        !writable(ix.accounts[0]) ||
        !writable(ix.accounts[checked ? 2 : 1]) ||
        ix.accounts[checked ? 3 : 2] !== 0 ||
        (checked && (ix.data[9] !== 6 || writable(ix.accounts[1])))
      )
        throw new TypeError("Transfer instruction differs from exact plan");
      if (
        new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength)
          .getBigUint64(1, true)
          .toString() !== target.amountMinor
      )
        throw new TypeError("Transfer amount differs from exact plan");
      paidDestinations.add(target.ata);
    } else throw new TypeError("Unapproved program in vault transaction");
  }
  if (transferIndex !== plan.transfers.length || used.size !== keys.length)
    throw new TypeError("Missing planned transfers or unused message accounts");
  const owners = new Map<string, string>([
    [source, binding.vault],
    ...destinations.map(
      (row) => [row.ata, row.recipientOwner] as [string, string],
    ),
  ]);
  return { owners, creates, lookupTablesSha256: resolved.digest };
}

function assertTokenAccount(value: unknown, owner: string): string {
  const a = object(value);
  if (
    a.owner !== SPL_TOKEN_PROGRAM_ID ||
    a.executable !== false ||
    !Array.isArray(a.data) ||
    a.data.length !== 2 ||
    a.data[1] !== "base64" ||
    typeof a.data[0] !== "string" ||
    a.data[0].length !== 220
  )
    throw new TypeError("Invalid legacy SPL token account");
  const bytes = data(a.data[0], "base64");
  if (
    bytes.length !== 165 ||
    base64(bytes) !== a.data[0] ||
    !same(bytes.subarray(0, 32), publicKeyBytes(SOLANA_MAINNET_USDC_MINT)) ||
    !same(bytes.subarray(32, 64), publicKeyBytes(owner)) ||
    bytes[108] !== 1
  )
    throw new TypeError(
      "Token account mint, recipient owner or initialized state differs",
    );
  return a.data[0];
}

async function header(
  bytes: Uint8Array,
  name: string,
  binding: SquadsExecutionBinding,
  indexOffset: number,
): Promise<void> {
  const discriminator = (
    await executionSha256(new TextEncoder().encode(`account:${name}`))
  ).slice(0, 16);
  if (
    bytes.length < indexOffset + 9 ||
    hex(bytes.slice(0, 8)) !== discriminator ||
    !same(bytes.slice(8, 40), publicKeyBytes(binding.multisig)) ||
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      .getBigUint64(indexOffset, true)
      .toString() !== binding.transactionIndex
  )
    throw new TypeError("Squads account header does not match binding");
}

async function inspectAccounts(
  value: unknown,
  binding: SquadsExecutionBinding,
) {
  const result = object(value);
  const slot = object(result.context).slot;
  if (
    !Number.isSafeInteger(slot) ||
    Number(slot) < 0 ||
    !Array.isArray(result.value) ||
    result.value.length !== 2
  )
    throw new TypeError("Invalid finalized account snapshot");
  const proposal = accountBytes(result.value[0]);
  const transaction = accountBytes(result.value[1]);
  await header(proposal, "Proposal", binding, 40);
  await header(
    transaction,
    isSquadsBatch(binding) ? "Batch" : "VaultTransaction",
    binding,
    72,
  );
  const statuses = [
    "draft",
    "active",
    "rejected",
    "approved",
    "unknown",
    "executed",
    "cancelled",
  ] as const;
  const status = statuses[proposal[48]];
  // Executing has a different layout and is not a supported finalized state.
  if (
    !status ||
    status === "unknown" ||
    proposal.length < 70 ||
    transaction.length < 87 ||
    transaction[81] !== binding.vaultIndex
  )
    throw new TypeError("Unsupported or mismatched Squads account layout");
  await assertAddress(binding, proposal[57], true);
  await assertAddress(binding, transaction[80], false);
  const canonicalVault = await pda(
    [
      data("multisig"),
      publicKeyBytes(binding.multisig),
      data("vault"),
      data([binding.vaultIndex]),
    ],
    SQUADS_V4_PROGRAM_ID,
  );
  if (
    transaction[82] !== canonicalVault.bump ||
    canonicalVault.address !== binding.vault
  )
    throw new TypeError("Vault derivation differs from binding");
  let batchProgress:
    | { totalChildren: number; executedChildren: number }
    | undefined;
  if (isSquadsBatch(binding)) {
    if (transaction.length !== 91) throw new TypeError("Invalid Batch layout");
    const view = new DataView(
      transaction.buffer,
      transaction.byteOffset,
      transaction.byteLength,
    );
    const totalChildren = view.getUint32(83, true),
      executedChildren = view.getUint32(87, true);
    if (
      totalChildren !== binding.children.length ||
      executedChildren > totalChildren ||
      (status === "executed") !== (executedChildren === totalChildren) ||
      (executedChildren > 0 && status !== "approved" && status !== "executed")
    )
      throw new TypeError("Incomplete or inconsistent Batch");
    batchProgress = { totalChildren, executedChildren };
  }
  const votes = new Reader(proposal);
  votes.take(58);
  for (let group = 0; group < 3; group++) {
    const members = Array.from({ length: votes.count(256) }, () => votes.key());
    if (new Set(members).size !== members.length)
      throw new TypeError("Duplicate proposal vote");
  }
  votes.end(true);
  return {
    transaction,
    batchProgress,
    slot: Number(slot),
    proposalStatus: status,
    proposalSha256: await executionSha256(proposal),
    vaultTransactionSha256: await executionSha256(transaction),
  };
}

async function boundedResponse(response: Response): Promise<unknown> {
  if (!response.ok || response.redirected)
    throw new TypeError("RPC HTTP failure or redirect");
  const length = response.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/u.test(length) || Number(length) > MAX_RPC_BYTES)
  )
    throw new RangeError("RPC response exceeds bound");
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError("Missing RPC body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.length;
      if (total > MAX_RPC_BYTES) {
        await reader.cancel();
        throw new RangeError("RPC response exceeds bound");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(concat(chunks)),
  );
}

export async function verifySquadsExecution(
  input: Parameters<typeof validateSquadsExecutionContext>[0],
  options: { fetchImpl?: FetchLike } = {},
): Promise<SquadsExecutionObservation> {
  input = {
    ...input,
    planBytes: new Uint8Array(input.planBytes),
    allocationBytes: new Uint8Array(input.allocationBytes),
  };
  // Invalid local authority/bindings throw before any network request.
  const binding = await validateSquadsExecutionContext(input);
  const fetchImpl = options.fetchImpl ?? fetch;
  const plan = parseExecutionJson(input.planBytes) as SettlementExecutionPlan;
  const observed = await Promise.allSettled(
    SQUADS_EXECUTION_RPC_AUTHORITIES.map(async (authority, index) => {
      let requestIndex = 0;
      const request = async (addresses: string[], minContextSlot?: number) => {
        const id = `squads-execution-${index}-${requestIndex++}`;
        const response = await fetchImpl(new URL(authority), {
          method: "POST",
          headers: { "content-type": "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            method: "getMultipleAccounts",
            params: [
              addresses,
              {
                encoding: "base64",
                commitment: "finalized",
                ...(minContextSlot === undefined ? {} : { minContextSlot }),
              },
            ],
          }),
        });
        const envelope = object(await boundedResponse(response));
        if (
          envelope.jsonrpc !== "2.0" ||
          envelope.id !== id ||
          envelope.error != null ||
          !Object.hasOwn(envelope, "result")
        )
          throw new TypeError("Invalid RPC envelope");
        return envelope.result;
      };
      const addresses = [
        binding.proposalAccount,
        squadsExecutionRootAccount(binding),
      ];
      const initial = await inspectAccounts(await request(addresses), binding);
      let evidenceSlot = initial.slot;
      const resolveLookups = async (lookups: Lookup[]) => {
        if (!lookups.length)
          return {
            writable: [],
            readonly: [],
            digest: await executionSha256(data("[]")),
          };
        const response = object(
          await request(
            [...addresses, ...lookups.map((row) => row.address)],
            evidenceSlot,
          ),
        );
        if (
          !Array.isArray(response.value) ||
          response.value.length !== 2 + lookups.length
        )
          throw new TypeError("Missing lookup table snapshot");
        const confirmed = await inspectAccounts(
          { context: response.context, value: response.value.slice(0, 2) },
          binding,
        );
        if (
          confirmed.slot < evidenceSlot ||
          confirmed.proposalSha256 !== initial.proposalSha256 ||
          confirmed.vaultTransactionSha256 !== initial.vaultTransactionSha256
        )
          throw new TypeError(
            "Squads accounts changed during lookup resolution",
          );
        evidenceSlot = confirmed.slot;
        const writable: string[] = [],
          readonly: string[] = [],
          evidence: unknown[] = [];
        for (const [i, lookup] of lookups.entries()) {
          const keys = lookupKeys(response.value[i + 2], confirmed.slot);
          const select = (index: number) => {
            const key = keys[index];
            if (!key) throw new TypeError("Lookup index out of range");
            return key;
          };
          writable.push(...lookup.writable.map(select));
          readonly.push(...lookup.readonly.map(select));
          evidence.push([lookup.address, object(response.value[i + 2]).data]);
        }
        return {
          writable,
          readonly,
          digest: await executionSha256(data(JSON.stringify(evidence))),
        };
      };
      let childAccountsSha256 = "";
      let message: Awaited<ReturnType<typeof decodeExactMessage>>;
      if (isSquadsBatch(binding)) {
        const response = object(
          await request(
            [
              ...addresses,
              ...binding.children.map((c) => c.transactionAccount),
            ],
            evidenceSlot,
          ),
        );
        if (
          !Array.isArray(response.value) ||
          response.value.length !== 2 + binding.children.length
        )
          throw new TypeError("Missing Batch children");
        const confirmed = await inspectAccounts(
          { context: response.context, value: response.value.slice(0, 2) },
          binding,
        );
        if (
          confirmed.slot < evidenceSlot ||
          confirmed.proposalSha256 !== initial.proposalSha256 ||
          confirmed.vaultTransactionSha256 !== initial.vaultTransactionSha256
        )
          throw new TypeError("Batch changed during child reads");
        evidenceSlot = confirmed.slot;
        const owners = new Map<string, string>(),
          creates = new Set<string>(),
          mustExist = new Set<string>(),
          childEvidence: string[] = [];
        for (const [i, child] of binding.children.entries()) {
          const bytes = accountBytes(response.value[i + 2]);
          const address = await squadsBatchChildAddress(
            binding.multisig,
            binding.transactionIndex,
            child.transactionIndex,
          );
          const discriminator = (
            await executionSha256(data("account:VaultBatchTransaction"))
          ).slice(0, 16);
          if (
            bytes.length < 13 ||
            hex(bytes.slice(0, 8)) !== discriminator ||
            address.address !== child.transactionAccount ||
            address.bump !== bytes[8] ||
            (await executionSha256(bytes.slice(13))) !== child.messageSha256
          )
            throw new TypeError("Foreign, closed or mutated Batch child");
          const decoded = await decodeExactMessage(
            bytes,
            binding,
            {
              ...plan,
              transfers: child.transferIndexes.map(
                (index) => plan.transfers[index],
              ),
            },
            async (lookups) => {
              if (lookups.length)
                throw new TypeError("Bounded Batch has no lookup tables");
              return {
                writable: [],
                readonly: [],
                digest: await executionSha256(data("[]")),
              };
            },
            9,
          );
          for (const [key, owner] of decoded.owners) owners.set(key, owner);
          for (const key of decoded.creates) creates.add(key);
          if (i < (initial.batchProgress?.executedChildren ?? 0))
            for (const key of decoded.owners.keys()) mustExist.add(key);
          childEvidence.push(await executionSha256(bytes));
        }
        for (const key of mustExist) creates.delete(key);
        childAccountsSha256 = await executionSha256(
          data(JSON.stringify(childEvidence)),
        );
        message = {
          owners,
          creates,
          lookupTablesSha256: await executionSha256(data("[]")),
        };
      } else
        message = await decodeExactMessage(
          initial.transaction,
          binding,
          plan,
          resolveLookups,
        );

      const tokenAddresses = [...message.owners.keys()];
      const tokenEvidence: unknown[] = [];
      let finalSlot = evidenceSlot;
      // getMultipleAccounts supports 100 addresses. Every chunk rechecks the
      // exact proposal and transaction; these are observations across slots,
      // not a claim of one atomic bank snapshot or transaction feasibility.
      for (let offset = 0; offset < tokenAddresses.length; offset += 98) {
        const chunk = tokenAddresses.slice(offset, offset + 98);
        const combined = object(
          await request([...addresses, ...chunk], finalSlot),
        );
        if (
          !Array.isArray(combined.value) ||
          combined.value.length !== addresses.length + chunk.length
        )
          throw new TypeError("Missing token account snapshot");
        const confirmed = await inspectAccounts(
          { context: combined.context, value: combined.value.slice(0, 2) },
          binding,
        );
        if (
          confirmed.slot < finalSlot ||
          confirmed.proposalSha256 !== initial.proposalSha256 ||
          confirmed.vaultTransactionSha256 !== initial.vaultTransactionSha256
        )
          throw new TypeError("Squads accounts changed during verification");
        finalSlot = confirmed.slot;
        for (const [i, address] of chunk.entries()) {
          const account = combined.value[i + 2];
          if (
            account === null &&
            message.creates.has(address) &&
            confirmed.proposalStatus !== "executed"
          )
            tokenEvidence.push([address, null]);
          else
            tokenEvidence.push([
              address,
              assertTokenAccount(
                account,
                message.owners.get(address) as string,
              ),
            ]);
        }
      }
      return {
        authority,
        slot: finalSlot,
        proposalStatus: initial.proposalStatus,
        proposalSha256: initial.proposalSha256,
        vaultTransactionSha256: childAccountsSha256
          ? await executionSha256(
              data(`${initial.vaultTransactionSha256}:${childAccountsSha256}`),
            )
          : initial.vaultTransactionSha256,
        batchProgress: initial.batchProgress,
        lookupTablesSha256: message.lookupTablesSha256,
        tokenAccountsSha256: await executionSha256(
          data(JSON.stringify(tokenEvidence)),
        ),
      };
    }),
  );
  const groups = new Map<
    string,
    Array<{
      authority: string;
      slot: number;
      batchProgress?: { totalChildren: number; executedChildren: number };
      proposalStatus: Exclude<
        SquadsExecutionObservation["proposalStatus"],
        "unknown"
      >;
      proposalSha256: string;
      vaultTransactionSha256: string;
      tokenAccountsSha256: string;
      lookupTablesSha256: string;
    }>
  >();
  for (const result of observed) {
    if (result.status !== "fulfilled") continue;
    const entry = result.value;
    const key = `${entry.proposalSha256}:${entry.vaultTransactionSha256}:${entry.tokenAccountsSha256}:${entry.lookupTablesSha256}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const quorum = [...groups.values()].find((group) => group.length >= 2);
  return {
    verifier: "squads-execution-v1",
    binding,
    observedAt: new Date().toISOString(),
    status: quorum ? "plan-matched" : "unverified",
    instructionVerification: quorum ? "verified" : "unverified",
    paymentVerified: false,
    retirementVerified: false,
    ...(isSquadsBatch(binding)
      ? { batchProgress: quorum?.[0].batchProgress ?? null }
      : {}),
    proposalStatus: quorum?.[0].proposalStatus ?? "unknown",
    accountEvidence: quorum
      ? {
          authorities: quorum.map((row) => row.authority),
          slots: quorum.map((row) => row.slot),
          proposalSha256: quorum[0].proposalSha256,
          vaultTransactionSha256: quorum[0].vaultTransactionSha256,
          tokenAccountsSha256: quorum[0].tokenAccountsSha256,
          lookupTablesSha256: quorum[0].lookupTablesSha256,
        }
      : null,
    reason: quorum
      ? "Exact ordered transfers and permitted recipient ATA creates match the frozen plan; account identities and token ownership agree across finalized RPC quorum. This snapshot does not prove signing capability, executable funding, settlement, or retirement."
      : "No quorum verified the exact supported plan and token accounts. Missing, closed, foreign, mismatched, unsupported or unavailable evidence does not prove execution or retirement.",
  };
}
