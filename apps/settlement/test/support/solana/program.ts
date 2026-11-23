// spec/contracts/solanaEscrow.md, "The program upgrade authority writes the Config once with three distinct keys"; spec/contracts/solanaEscrow.md, "A Token-2022 mint has at most metadata extensions and no active authority, and its token accounts at most ImmutableOwner"; spec/contracts/solanaEscrow.md, "The pre-pledge build's 332-byte project grows to the current layout with no open pledges"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { type Address, type Blockhash, type Signature, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, addressOf, base64Encode, findPda } from "@repo/platform/chain/solana";
import { type Validator, sbfBuild, solanaValidator } from "@repo/platform/testing/chains";
import { repoRoot } from "@repo/platform/testing/paths";
import { PRE_PLEDGE_PROJECT_SIZE, accountDiscriminator } from "../../../src/chain/solana/accounts.ts";
import { concat, digestBytes, u32le, u64le, utf8, type U64 } from "../../../src/chain/solana/bytes.ts";
import { PURPOSE_BYTE, UPGRADEABLE_LOADER, keyBytes, programDataAddress, tokenAccountAddress, vaultAddress } from "../../../src/chain/solana/pda.ts";
import { registryProjectDigest } from "../../../src/owner/ownerInstructions.ts";
import { type Instruction, compileLegacy, requiredSigners, transactionId, unsignedTransaction, withSignature } from "../../../src/chain/solana/transactions.ts";

export interface Keypair {
  readonly address: Address;
  readonly seed: Uint8Array;
}

export interface EscrowChain extends AsyncDisposable {
  readonly validator: Validator;
  readonly program: Address;
  readonly payer: Keypair;
  readonly upgradeAuthority: Keypair;
  readonly holder: Keypair;
  readonly mints: { readonly classic: Address; readonly token2022: Address; readonly refused: Address };
  readonly sources: { readonly classic: Address; readonly token2022: Address };
  readonly prePledge: { readonly projectId: string; readonly project: Address; readonly vault: Address };
  close(): Promise<void>;
}

const contracts = join(repoRoot, "packages/contracts/solana");
const fixtureMint = join(contracts, "integration/fixtures/token-2022-mint.bin");
const FIXTURE_MINT_KEY = new Uint8Array(32).fill(0x2a);
const SUPPLY = 1_000_000_000_000n as U64;
const FIXTURE_LAMPORTS = 10_000_000;
const PROGRAM_LAMPORTS = 100_000_000_000;
const PRE_PLEDGE_PROJECT_ID = "owner-pre-pledge";
const PRE_PLEDGE_DEPOSIT = 4_000_000n as U64;
const PRE_PLEDGE_MONTHLY_CAP = 7n as U64;

export function keypair(): Keypair {
  const seed = ed25519.utils.randomSecretKey();
  return { address: addressOf(ed25519.getPublicKey(seed)) as Address, seed };
}

function seeded(label: string): Address {
  return addressOf(sha256(utf8(label))) as Address;
}

function replaced(bytes: Uint8Array, from: Uint8Array, to: Uint8Array): Uint8Array {
  const copy = bytes.slice();
  for (let at = 0; at + from.length <= copy.length; at++)
    if (from.every((byte, index) => copy[at + index] === byte)) copy.set(to, at);
  return copy;
}

function classicMint(authority: Address): Uint8Array {
  const data = new Uint8Array(82);
  data.set(u32le(1), 0);
  data.set(keyBytes(authority), 4);
  data.set(u64le(SUPPLY), 36);
  data[44] = 6;
  data[45] = 1;
  return data;
}

function tokenAccount(mint: Address, owner: Address, extensions: Uint8Array | undefined): Uint8Array {
  const data = new Uint8Array(extensions === undefined ? 165 : 166 + extensions.length);
  data.set(keyBytes(mint), 0);
  data.set(keyBytes(owner), 32);
  data.set(u64le(SUPPLY), 64);
  data[108] = 1;
  if (extensions !== undefined) {
    data[165] = 2;
    data.set(extensions, 166);
  }
  return data;
}

function refusedMint(fixture: Uint8Array, address: Address, freezeAuthority: Address): Uint8Array {
  const data = replaced(fixture, FIXTURE_MINT_KEY, keyBytes(address));
  data.set(u32le(1), 46);
  data.set(keyBytes(freezeAuthority), 50);
  return data;
}

function prePledgeAddress(program: Address, owner: Address): { readonly address: Address; readonly bump: number } {
  const found = findPda([utf8("project"), keyBytes(owner), digestBytes(registryProjectDigest(PRE_PLEDGE_PROJECT_ID)), Uint8Array.of(PURPOSE_BYTE.Ordinary)], program);
  if (found === undefined) throw new Error("The pre-pledge project has no program address");
  return found;
}

function prePledgeProject(owner: Address, mint: Address, bump: number): Uint8Array {
  const data = new Uint8Array(PRE_PLEDGE_PROJECT_SIZE);
  data.set(accountDiscriminator("Project"), 0);
  data.set(keyBytes(owner), 8);
  data.set(digestBytes(registryProjectDigest(PRE_PLEDGE_PROJECT_ID)), 40);
  data.set(keyBytes(mint), 168);
  data.set(u64le(PRE_PLEDGE_DEPOSIT), 208);
  data[248] = bump;
  data.set(u64le(PRE_PLEDGE_MONTHLY_CAP), 307);
  data[315] = 1;
  return data;
}

function programAccounts(program: Address, authority: Address, code: Uint8Array) {
  const data = programDataAddress(program);
  const header = new Uint8Array(45);
  header.set(u32le(3), 0);
  header[12] = 1;
  header.set(keyBytes(authority), 13);
  return [
    { address: program, owner: UPGRADEABLE_LOADER, executable: true, lamports: PROGRAM_LAMPORTS, bytes: concat(u32le(2), keyBytes(data)) },
    { address: data, owner: UPGRADEABLE_LOADER, executable: false, lamports: PROGRAM_LAMPORTS, bytes: concat(header, code) },
  ];
}

export async function escrowChain(): Promise<EscrowChain> {
  const idl = JSON.parse(await readFile(join(contracts, "idl/slop_escrow.json"), "utf8")) as { readonly address: string };
  const program = idl.address as Address;
  const upgradeAuthority = keypair();
  const holder = keypair();
  const mints = { classic: seeded("slop-test-classic-mint"), token2022: addressOf(FIXTURE_MINT_KEY) as Address, refused: seeded("slop-test-refused-token-2022-mint") };
  const sources = { classic: tokenAccountAddress(holder.address, mints.classic, TOKEN_PROGRAM), token2022: tokenAccountAddress(holder.address, mints.token2022, TOKEN_2022_PROGRAM) };
  const prePledgeKey = prePledgeAddress(program, holder.address);
  const prePledge = { projectId: PRE_PLEDGE_PROJECT_ID, project: prePledgeKey.address, vault: vaultAddress(program, prePledgeKey.address) };
  const fixture = new Uint8Array(await readFile(fixtureMint));
  const build = await sbfBuild(contracts, "programs/slop-escrow/Cargo.toml");
  const directory = await mkdtemp(join(tmpdir(), "slop-escrow-accounts-"));
  const release = async () => {
    await build.close();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const code = new Uint8Array(await readFile(join(build.out, "slop_escrow.so")));
    const accounts = [
      ...programAccounts(program, upgradeAuthority.address, code),
      { address: mints.classic, owner: TOKEN_PROGRAM, executable: false, lamports: FIXTURE_LAMPORTS, bytes: classicMint(holder.address) },
      { address: mints.token2022, owner: TOKEN_2022_PROGRAM, executable: false, lamports: FIXTURE_LAMPORTS, bytes: fixture },
      { address: mints.refused, owner: TOKEN_2022_PROGRAM, executable: false, lamports: FIXTURE_LAMPORTS, bytes: refusedMint(fixture, mints.refused, holder.address) },
      { address: sources.classic, owner: TOKEN_PROGRAM, executable: false, lamports: FIXTURE_LAMPORTS, bytes: tokenAccount(mints.classic, holder.address, undefined) },
      { address: sources.token2022, owner: TOKEN_2022_PROGRAM, executable: false, lamports: FIXTURE_LAMPORTS, bytes: tokenAccount(mints.token2022, holder.address, Uint8Array.of(7, 0, 0, 0)) },
      { address: prePledge.project, owner: program, executable: false, lamports: FIXTURE_LAMPORTS, bytes: prePledgeProject(holder.address, mints.classic, prePledgeKey.bump) },
    ];
    const files = await Promise.all(accounts.map(async (account, at) => {
      const jsonPath = join(directory, `account-${at}.json`);
      await writeFile(jsonPath, JSON.stringify({
        pubkey: account.address,
        account: { lamports: account.lamports, data: [base64Encode(account.bytes), "base64"], owner: account.owner, executable: account.executable, rentEpoch: 0, space: account.bytes.length },
      }));
      return { address: account.address, jsonPath };
    }));
    const validator = await solanaValidator({ accounts: files });
    const close = async () => {
      try {
        await validator.close();
      } finally {
        await release();
      }
    };
    const payer = { address: validator.payer.address as Address, seed: validator.payer.secretKey.slice(0, 32) };
    for (const funded of [upgradeAuthority, holder]) await validator.airdrop(funded.address, 10_000_000_000n);
    return { validator, program, payer, upgradeAuthority, holder, mints, sources, prePledge, close, [Symbol.asyncDispose]: close };
  } catch (error) {
    await release();
    throw error;
  }
}

async function blockhash(chain: EscrowChain): Promise<Blockhash> {
  const latest = await chain.validator.rpc("getLatestBlockhash", [{ commitment: "finalized" }]) as { readonly value: { readonly blockhash: Blockhash } };
  return latest.value.blockhash;
}

export async function signedTransaction(chain: EscrowChain, payer: Keypair, instructions: ReadonlyArray<Instruction>, keys: ReadonlyArray<Keypair>): Promise<Uint8Array> {
  const compiled = compileLegacy({ payer: payer.address, blockhash: await blockhash(chain), instructions });
  if (compiled.kind === "refused") throw new Error(`The codec refused the transaction: ${compiled.issue}`);
  let wire = unsignedTransaction(compiled.message);
  for (const signer of requiredSigners(compiled.message)) {
    const key = [payer, ...keys].find((candidate) => candidate.address === signer);
    if (key === undefined || wire === undefined) throw new Error(`No key for required signer ${signer}`);
    wire = withSignature(wire, signer, ed25519.sign(compiled.bytes, key.seed));
  }
  if (wire === undefined) throw new Error("The signed transaction did not encode");
  return wire;
}

export async function submitWire(chain: EscrowChain, wire: Uint8Array): Promise<Signature> {
  const signature = transactionId(wire);
  if (signature === undefined) throw new Error("The transaction has no fee payer signature");
  const sent = await chain.validator.rpc("sendTransaction", [base64Encode(wire), { encoding: "base64", preflightCommitment: "confirmed" }]);
  if (sent !== signature) throw new Error(`sendTransaction answered ${String(sent)}, not ${signature}`);
  for (let attempt = 0; attempt < 600; attempt++) {
    const statuses = await chain.validator.rpc("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]) as { readonly value: ReadonlyArray<{ readonly err: unknown; readonly confirmationStatus: string } | null> };
    const status = statuses.value[0];
    if (status && status.err !== null) throw new Error(`${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "finalized") return signature;
    await sleep(100);
  }
  throw new Error(`${signature} was not finalized within 60 seconds`);
}

export async function submit(chain: EscrowChain, payer: Keypair, instructions: ReadonlyArray<Instruction>, keys: ReadonlyArray<Keypair> = []): Promise<Signature> {
  return submitWire(chain, await signedTransaction(chain, payer, instructions, keys));
}

export async function simulated(chain: EscrowChain, payer: Keypair, instructions: ReadonlyArray<Instruction>, keys: ReadonlyArray<Keypair> = []): Promise<{ readonly err: unknown; readonly logs: ReadonlyArray<string> }> {
  const wire = await signedTransaction(chain, payer, instructions, keys);
  const answer = await chain.validator.rpc("simulateTransaction", [base64Encode(wire), { encoding: "base64", commitment: "finalized" }]) as { readonly value: { readonly err: unknown; readonly logs: ReadonlyArray<string> | null } };
  return { err: answer.value.err, logs: answer.value.logs ?? [] };
}

export async function finalizedTime(chain: EscrowChain): Promise<{ readonly slot: number; readonly time: number }> {
  const slot = await chain.validator.rpc("getSlot", [{ commitment: "finalized" }]) as number;
  const time = await chain.validator.rpc("getBlockTime", [slot]) as number;
  return { slot, time };
}
