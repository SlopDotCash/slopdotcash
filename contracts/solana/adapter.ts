import { sha256 } from "@noble/hashes/sha2.js";
import type { PaymentChainAdapter } from "../../backend/payments/ledger";
import { decodeBase58Bytes } from "../../src/lib/squads-funding";

export interface SolanaEscrowConfig {
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
  identityAuthority: string;
  feeRecipient: string;
  codeSha256: string;
  upgradeAuthority: string | null;
  /** Reviewed delay, in seconds, before a wallet binding can pay in this project. */
  bindingDelaySeconds: string;
}
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
/** Project account size: 249 bytes of v2 state plus the i64 binding delay. */
export const PROJECT_SIZE = 257;
/** Wallet binding size: 152 bytes of v2 state plus the i64 bound_at time. */
export const BINDING_SIZE = 160;
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
  PAY = anchorDiscriminator("pay");
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
function digest(value: string): Uint8Array {
  const plain = value.replace(/^0x/, "");
  if (!/^[a-fA-F0-9]{64}$/.test(plain))
    throw new Error("Invalid obligation digest");
  return Uint8Array.from(plain.match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
}
async function rpc(
  config: SolanaEscrowConfig,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`RPC HTTP failure ${response.status}`);
  const body = object(await response.json());
  if (body.id !== 1 || body.error || !("result" in body))
    throw new Error("RPC failure");
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

/** Bind the reviewed deployment to finalized executable bytes and all project authorities. */
export async function verifySolanaDeployment(
  config: SolanaEscrowConfig,
): Promise<Uint8Array> {
  if (!/^[0-9a-f]{64}$/.test(config.codeSha256))
    throw new Error("Missing reviewed program digest");
  if ((await rpc(config, "getGenesisHash", [])) !== config.genesisHash)
    throw new Error("Wrong Solana cluster");
  // An upgrade key could swap the program, empty vaults, and restore the
  // reviewed bytes before this check runs again.
  if (
    config.genesisHash === MAINNET_GENESIS &&
    config.upgradeAuthority !== null
  )
    throw new Error("Mainnet escrow requires a revoked upgrade authority");
  if (
    !/^(0|[1-9][0-9]{0,18})$/.test(config.bindingDelaySeconds) ||
    BigInt(config.bindingDelaySeconds) > (1n << 63n) - 1n
  )
    throw new Error("Missing reviewed binding delay");
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
    code = content.slice(45);
  } else if (
    program.owner !== "BPFLoader2111111111111111111111111111111111" ||
    config.upgradeAuthority !== null
  )
    throw new Error("Unsupported program loader or authority");
  if (hex(sha256(code)) !== config.codeSha256)
    throw new Error("Deployed program bytes differ from reviewed digest");
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
    "cda8bdcab5f78e13",
  );
  if (
    new DataView(project.buffer, project.byteOffset).getBigInt64(249, true) !==
      BigInt(config.bindingDelaySeconds) ||
    pubkey(project, 8) !== config.owner ||
    pubkey(project, 104) !== config.identityAuthority ||
    pubkey(project, 136) !== config.feeRecipient ||
    pubkey(project, 168) !== config.mint ||
    hex(project.slice(72, 104)) !== hex(digest(config.networkDomain))
  )
    throw new Error("Reviewed project authorities or asset mismatch");
  return project;
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
    if (tag !== COMMIT && tag !== PAY) return;
    const children: Obj[] = [];
    for (let next = index + 1; next < flat.length; next++) {
      const candidate = flat[next];
      if (candidate.top !== entry.top || candidate.height <= entry.height)
        break;
      if (candidate.height === entry.height + 1) children.push(candidate.ix);
    }
    found.push({
      index,
      kind: tag === COMMIT ? "reserved" : "paid",
      accounts: list(entry.ix.accounts).map(string),
      data,
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
    async verifyFinalized(input) {
      if (!Number.isSafeInteger(input.eventIndex) || input.eventIndex < 0)
        throw new Error("Invalid instruction index");
      if (decodeBase58Bytes(input.transactionId).length !== 64)
        throw new Error("Invalid signature");
      const project = await verifySolanaDeployment(config);
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
              { dataSize: 137 },
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
        137,
        "a8ce8d6a584caca7",
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
        fee !== gross / 50n ||
        solanaAwardId(config.projectPda, source) !== hex(award)
      )
        throw new Error("Invalid award accounting");
      const { accounts, data, children } = invocation;
      let destination: string | undefined;
      if (input.kind === "reserved") {
        // commit(award_id, source_digest, actor_id, gross); accounts: owner, project, vault, origin, obligation.
        if (
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
        // pay(expected_version); accounts: project, obligation, binding, mint, vault, destination, fee_account.
        if (
          data.length !== 16 ||
          obligation[136] !== 1 ||
          accounts[0] !== config.projectPda ||
          accounts[1] !== awardAddress ||
          accounts[3] !== config.mint ||
          accounts[4] !== config.vault
        )
          throw new Error("Payment differs from award");
        const expected = [
          { to: accounts[5], amount: net },
          { to: accounts[6], amount: fee },
        ];
        if (children.length !== expected.length)
          throw new Error("Unexpected payout instructions");
        children.forEach((child, i) => {
          const parsed = object(child.parsed),
            info = object(parsed.info),
            amount = object(info.tokenAmount);
          if (
            child.programId !== TOKEN_PROGRAM ||
            parsed.type !== "transferChecked" ||
            info.source !== config.vault ||
            info.mint !== config.mint ||
            info.authority !== config.projectPda ||
            info.destination !== expected[i].to ||
            amount.decimals !== 6 ||
            amount.amount !== expected[i].amount.toString()
          )
            throw new Error("Payout transfer differs from award");
        });
        const keys = list(object(transaction.message).accountKeys).map(
          (entry) => string(object(entry).pubkey),
        );
        const ownerOf = (address: string) => {
          const index = keys.indexOf(address);
          const balance = list(meta.postTokenBalances)
            .map(object)
            .find((item) => item.accountIndex === index);
          if (index < 0 || !balance || balance.mint !== config.mint)
            throw new Error("Payout account balance missing");
          return string(balance.owner);
        };
        destination = ownerOf(accounts[5]);
        if (ownerOf(accounts[6]) !== pubkey(project, 136))
          throw new Error("Fee account is not owned by the fee recipient");
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

export {
  account as solanaAccount,
  base58 as solanaBase58,
  digest as solanaDigest,
  pubkey as solanaPubkey,
  rpc as solanaRpc,
  uint as solanaUint,
};
