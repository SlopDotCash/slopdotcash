import { afterEach, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { registryProjectDigest } from "../../src/lib/vault-setup";
import {
  CONFIG_DISCRIMINATOR,
  CONFIG_SIZE,
  PROJECT_DISCRIMINATOR,
  PROJECT_SIZE,
  solanaBase58,
  solanaConfigAddress,
  solanaDigest,
} from "./adapter";
import {
  prepareSolanaVaultCreation,
  verifySolanaVaultCreation,
} from "./owner-creation";
import {
  buildInitializeVaultInstructions,
  type SolanaVaultCreation,
} from "./owner-instructions";
import { concat, message } from "./transactions";

const PROGRAM = "7E5ZRh5y6Xgg7k3kdS75CMiTE2efoq9PqNWR5fCVDavQ";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const IDENTITY_BYTES = new Uint8Array(32).fill(3);
const IDENTITY = solanaBase58(IDENTITY_BYTES);
const FEES_BYTES = new Uint8Array(32).fill(4);
const FEES = solanaBase58(FEES_BYTES);
const ROTATION_BYTES = new Uint8Array(32).fill(5);
const ROTATION = solanaBase58(ROTATION_BYTES);
const MINT_BYTES = new Uint8Array(32).fill(9);
const MINT = solanaBase58(MINT_BYTES);
const OWNER_SECRET = new Uint8Array(32).fill(7);
const OWNER_BYTES = ed25519.getPublicKey(OWNER_SECRET);
const OWNER = solanaBase58(OWNER_BYTES);
const BLOCKHASH = solanaBase58(new Uint8Array(32).fill(8));
const PROJECT_ID = "canonical-registry-project";
const CODE = new Uint8Array([1, 2, 3]);
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const encoded = (owner: string, data: Uint8Array, executable = false) => ({
  owner,
  executable,
  lamports: 1,
  data: [Buffer.from(data).toString("base64"), "base64"],
});

function fixture(projectId = PROJECT_ID) {
  const projectDigest = registryProjectDigest(PROJECT_ID);
  const input: SolanaVaultCreation = {
    programId: PROGRAM,
    owner: OWNER,
    mint: MINT,
    projectDigest,
    networkDomain: "ab".repeat(32),
    identityAuthority: IDENTITY,
    feeRecipient: FEES,
    bindingDelaySeconds: "3600",
    rotationDelaySeconds: "604800",
    monthlyCap: "100",
    automaticMonthly: true,
  };
  const plan = buildInitializeVaultInstructions({
    ...input,
    tokenProgram: TOKEN,
  });
  const escrowConfig = new Uint8Array(CONFIG_SIZE);
  escrowConfig.set(Buffer.from(CONFIG_DISCRIMINATOR, "hex"));
  escrowConfig.set(IDENTITY_BYTES, 8);
  escrowConfig.set(FEES_BYTES, 40);
  escrowConfig.set(ROTATION_BYTES, 72);
  const project = new Uint8Array(PROJECT_SIZE);
  project.set(Buffer.from(PROJECT_DISCRIMINATOR, "hex"));
  project.set(OWNER_BYTES, 8);
  project.set(solanaDigest(projectDigest), 40);
  project.set(solanaDigest(input.networkDomain), 72);
  project.set(IDENTITY_BYTES, 104);
  project.set(FEES_BYTES, 136);
  project.set(MINT_BYTES, 168);
  const view = new DataView(project.buffer);
  view.setBigInt64(249, 3600n, true);
  view.setBigInt64(298, 604800n, true);
  project[306] = 0;
  const mint = new Uint8Array(82);
  mint[44] = 6;
  mint[45] = 1;
  const config = {
    rpcUrl: "https://rpc.invalid",
    genesisHash: "local-genesis",
    programId: PROGRAM,
    network: "solana-localnet",
    networkDomain: input.networkDomain,
    identityAuthority: IDENTITY,
    feeRecipient: FEES,
    rotationAuthority: ROTATION,
    codeSha256: Buffer.from(sha256(CODE)).toString("hex"),
    upgradeAuthority: null,
    bindingDelaySeconds: input.bindingDelaySeconds,
    rotationDelaySeconds: input.rotationDelaySeconds,
  };
  return { config, input, plan, projectId, escrowConfig, project, mint };
}

function mockChain(
  state: ReturnType<typeof fixture>,
  transaction?: { id: string; wire: Uint8Array },
  includeProject = true,
) {
  const accounts = new Map([
    [
      PROGRAM,
      encoded("BPFLoader2111111111111111111111111111111111", CODE, true),
    ],
    [solanaConfigAddress(PROGRAM), encoded(PROGRAM, state.escrowConfig)],
    [MINT, encoded(TOKEN, state.mint)],
    ...(includeProject
      ? [[state.plan.projectPda, encoded(PROGRAM, state.project)] as const]
      : []),
  ]);
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    let result: unknown;
    if (body.method === "getGenesisHash") result = "local-genesis";
    else if (body.method === "getAccountInfo")
      result = { value: accounts.get(body.params[0]) ?? null };
    else if (body.method === "getSignatureStatuses")
      result = {
        value: [
          transaction
            ? { confirmationStatus: "finalized", err: null, slot: 42 }
            : null,
        ],
      };
    else if (body.method === "getTransaction") {
      if (!transaction) result = null;
      else if (body.params[1].encoding === "json")
        result = { transaction: { message: { recentBlockhash: BLOCKHASH } } };
      else
        result = {
          slot: 42,
          transaction: [
            Buffer.from(transaction.wire).toString("base64"),
            "base64",
          ],
          meta: { err: null, innerInstructions: [], postBalances: [1] },
        };
    } else throw new Error(`Unexpected RPC ${body.method}`);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
}

test("owner creation recovers an existing vault for the canonical registry project", async () => {
  const state = fixture();
  mockChain(state);

  const prepared = await prepareSolanaVaultCreation(
    state.config,
    state.projectId,
    state.input,
  );

  expect(prepared.existingVault).toBe(state.plan.vault);
  expect(prepared.transaction).toBeNull();
});

test("owner creation finalizes for the canonical registry project", async () => {
  const state = fixture();
  const msg = message(OWNER, BLOCKHASH, state.plan.instructions);
  const signature = ed25519.sign(msg, OWNER_SECRET);
  const transaction = {
    id: solanaBase58(signature),
    wire: concat(Uint8Array.of(1), signature, msg),
  };
  mockChain(state, transaction);

  await expect(
    verifySolanaVaultCreation(
      state.config,
      state.projectId,
      state.input,
      transaction.id,
    ),
  ).resolves.toEqual({
    projectPda: state.plan.projectPda,
    vault: state.plan.vault,
  });
});

test("owner creation rejects a registry project ID that does not match the signed digest", async () => {
  const state = fixture("another-registry-project");
  mockChain(state);

  await expect(
    prepareSolanaVaultCreation(state.config, state.projectId, state.input),
  ).rejects.toThrow("The project digest does not match the registry project.");
});

test("owner creation rejects a new account whose digest does not match the registry project", async () => {
  const state = fixture("another-registry-project");
  mockChain(state, undefined, false);

  await expect(
    prepareSolanaVaultCreation(state.config, state.projectId, state.input),
  ).rejects.toThrow("The project digest does not match the registry project.");
});
