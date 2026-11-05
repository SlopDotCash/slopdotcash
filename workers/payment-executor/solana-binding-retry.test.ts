// A Solana destination binding that lands but fails on chain (for example its
// expected version was raced by an earlier binding, or its one-hour submission
// window closed before inclusion) is finalized proof the binding never took
// effect. The contributor must be able to prepare a fresh binding for the same
// payout attempt afterwards: the failed attempt is archived, never silently
// reused, and a failure that is not yet finalized still blocks replacement.

import { expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import { buildPaymentWalletMessage } from "../../backend/payments/possession";
import {
  BINDING_SIZE,
  CONFIG_DISCRIMINATOR,
  CONFIG_SIZE,
  OBLIGATION_DISCRIMINATOR,
  OBLIGATION_SIZE,
  PROJECT_DISCRIMINATOR,
  PROJECT_SIZE,
  SOLANA_NATIVE_ASSET,
  solanaAwardId,
  solanaBase58,
  solanaConfigAddress,
  solanaDigest,
} from "../../contracts/solana/adapter";
import { bytes, encoder, le, pda } from "../../contracts/solana/transactions";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
import type { JournalStore } from "./core";
import {
  completeSolanaBinding,
  createSolanaAttester,
  createSolanaExecutor,
} from "./solana";

const RPC_URL = "https://rpc.fixture/solana";
const GENESIS = "fixture-genesis-hash";
const NETWORK = "solana-localnet";
const DOMAIN = "d".repeat(64);
const ACTOR = "123";
const NOW = "2026-10-01T00:00:00.000Z";
const CHALLENGE_EXPIRY = "2027-01-01T00:00:00.000Z";

const keyOf = (label: string) => {
  const seed = sha256(new TextEncoder().encode(label));
  return { seed, address: solanaBase58(ed25519.getPublicKey(seed)) };
};
const owner = keyOf("owner");
const authority = keyOf("identity-authority");
const feeRecipient = keyOf("fee-recipient");
const rotationAuthority = keyOf("rotation-authority");
const destination = keyOf("destination-wallet");
const program = keyOf("program");
const project = keyOf("project");
const programId = program.address;
const projectPda = project.address;
const vault = pda(programId, [encoder.encode("vault"), bytes(projectPda)]);
const configAddress = solanaConfigAddress(programId);

const code = new Uint8Array(64).fill(7);
const codeSha256 = bytesToHex(sha256(code));
const claimDigest = "c".repeat(64);
const sourceDigest = "a".repeat(64);
const obligationId = solanaAwardId(projectPda, sourceDigest);
const awardAddress = pda(programId, [
  encoder.encode("award"),
  bytes(projectPda),
  solanaDigest(obligationId),
]);
const bindingAddress = pda(programId, [
  encoder.encode("wallet"),
  bytes(projectPda),
  le(BigInt(ACTOR)),
]);
let blockhashCalls = 0;
const blockhash = () =>
  solanaBase58(new Uint8Array(32).fill(blockhashCalls++ === 0 ? 9 : 10));

function pubkeyAt(target: Uint8Array, offset: number, address: string) {
  target.set(bytes(address), offset);
}
function projectBytes(): Uint8Array {
  const out = new Uint8Array(PROJECT_SIZE);
  out.set(hexToBytes(PROJECT_DISCRIMINATOR), 0);
  pubkeyAt(out, 8, owner.address);
  out.set(solanaDigest(DOMAIN), 72);
  pubkeyAt(out, 104, authority.address);
  pubkeyAt(out, 136, feeRecipient.address);
  pubkeyAt(out, 168, SOLANA_NATIVE_ASSET);
  return out;
}
function configBytes(): Uint8Array {
  const out = new Uint8Array(CONFIG_SIZE);
  out.set(hexToBytes(CONFIG_DISCRIMINATOR), 0);
  pubkeyAt(out, 8, authority.address);
  pubkeyAt(out, 40, feeRecipient.address);
  pubkeyAt(out, 72, rotationAuthority.address);
  return out;
}
function obligationBytes(): Uint8Array {
  const out = new Uint8Array(OBLIGATION_SIZE);
  out.set(hexToBytes(OBLIGATION_DISCRIMINATOR), 0);
  const view = new DataView(out.buffer);
  view.setBigUint64(8, 100_000_000n, true);
  out.set(hexToBytes(sourceDigest), 16);
  pubkeyAt(out, 48, projectPda);
  view.setBigUint64(112, BigInt(ACTOR), true);
  view.setBigUint64(120, 98_000_000n, true);
  view.setBigUint64(128, 2_000_000n, true);
  return out;
}
const b64 = (data: Uint8Array) => btoa(String.fromCharCode(...data));
const accountInfo = (data: Uint8Array, ownerAddress = programId) => ({
  value: {
    owner: ownerAddress,
    executable: false,
    data: [b64(data), "base64"],
  },
});

type SignatureStatus = { err: unknown; confirmationStatus: string } | null;
const statuses = new Map<string, SignatureStatus>();
let sendResult = "";
/** A binding that already landed on chain, seen by the getAccountInfo stub. */
let existingBinding: Uint8Array | null = null;
function bindingBytes(): Uint8Array {
  const out = new Uint8Array(BINDING_SIZE);
  out.set(hexToBytes("33d3ccb9a84434b0"), 0);
  out.set(hexToBytes(claimDigest), 8);
  pubkeyAt(out, 112, destination.address);
  new DataView(out.buffer).setBigUint64(144, 1n, true);
  return out;
}
const originalFetch = globalThis.fetch;
const fixtureFetch = (async (input: unknown, init?: { body?: unknown }) => {
  if (String(input) !== RPC_URL) throw new Error("Unexpected fetch target");
  const request = JSON.parse(String(init?.body ?? "{}")) as {
    method?: string;
    params?: unknown[];
  };
  const reply = (result: unknown) =>
    Response.json({ jsonrpc: "2.0", id: 1, result });
  switch (request.method) {
    case "getGenesisHash":
      return reply(GENESIS);
    case "getAccountInfo": {
      const address = request.params?.[0];
      if (address === programId)
        return reply({
          value: {
            owner: "BPFLoader2111111111111111111111111111111111",
            executable: true,
            data: [b64(code), "base64"],
          },
        });
      if (address === configAddress) return reply(accountInfo(configBytes()));
      if (address === projectPda) return reply(accountInfo(projectBytes()));
      if (address === awardAddress)
        return reply(accountInfo(obligationBytes()));
      if (address === bindingAddress)
        return reply(
          existingBinding ? accountInfo(existingBinding) : { value: null },
        );
      throw new Error(`Unexpected account ${String(address)}`);
    }
    case "getLatestBlockhash":
      return reply({
        value: { blockhash: blockhash(), lastValidBlockHeight: 2000 },
      });
    case "getBlockHeight":
      // Still inside the failed attempt's blockhash validity window: only its
      // finalized failure may release a replacement.
      return reply(1000);
    case "getSignatureStatuses":
      return reply({
        value: [
          statuses.get(String((request.params?.[0] as unknown[])?.[0])) ?? null,
        ],
      });
    case "sendTransaction":
      return reply(sendResult);
    default:
      throw new Error(`Unexpected RPC method ${String(request.method)}`);
  }
}) as typeof fetch;
globalThis.fetch = fixtureFetch;

function journal(): JournalStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  const store: JournalStore & { map: Map<string, unknown> } = {
    map,
    async get<T>(key: string) {
      const value = map.get(key);
      return value === undefined ? undefined : (structuredClone(value) as T);
    },
    async put<T>(key: string, value: T) {
      map.set(key, structuredClone(value));
    },
    async transaction<T>(callback: (store: JournalStore) => Promise<T>) {
      return callback(store);
    },
  };
  return store;
}

function setup() {
  const { db, sqlite: sql } = sqliteD1(MIGRATIONS);
  const expiresAt = CHALLENGE_EXPIRY;
  const message = buildPaymentWalletMessage({
    actorId: ACTOR,
    chain: "solana",
    address: destination.address,
    claimId: "claim-1",
    claimDigest,
    nonce: "challenge-1",
    expiresAt,
  });
  const signature = b64(
    ed25519.sign(new TextEncoder().encode(message), destination.seed),
  );
  sql
    .query(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "claim-1",
      ACTOR,
      "alice",
      destination.address,
      "d1_registry",
      "b".repeat(64),
      NOW,
      claimDigest,
      null,
      NOW,
      "solana",
    );
  sql
    .query(
      "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,?,?,?)",
    )
    .run("challenge-1", "claim-1", ACTOR, message, expiresAt, NOW);
  sql
    .query(
      "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,?)",
    )
    .run("claim-1", ACTOR, NOW, "challenge-1", signature);
  sql
    .query(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'reserved',?)",
    )
    .run(
      obligationId,
      "project-1",
      ACTOR,
      NETWORK,
      "solana",
      vault,
      SOLANA_NATIVE_ASSET,
      9,
      "100000000",
      "2000000",
      sourceDigest,
      NOW,
    );
  sql
    .query(
      "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state) VALUES(?,?,?,?,?)",
    )
    .run("attempt-1", obligationId, "claim-1", NOW, "unknown");
  const deployment = {
    network: NETWORK,
    chain: "solana",
    vault,
    programId,
    projectPda,
    projectId: "project-1",
    networkDomain: DOMAIN,
    mint: SOLANA_NATIVE_ASSET,
    owner: owner.address,
    identityAuthority: authority.address,
    feeRecipient: feeRecipient.address,
    rotationAuthority: rotationAuthority.address,
    codeSha256,
    upgradeAuthority: null,
    bindingDelaySeconds: "0",
    rotationDelaySeconds: "0",
  };
  const store = journal();
  const env = {
    PAYMENTS_DB: db as unknown as D1Database,
    PAYMENT_DEPLOYMENTS: JSON.stringify([deployment]),
    PAYMENT_RPC_URLS: JSON.stringify({ [NETWORK]: RPC_URL }),
    SOLANA_SIGNER: {
      address: authority.address,
      signMessage: async (message: Uint8Array) =>
        ed25519.sign(message, authority.seed),
    },
    JOURNAL: store,
    ALLOW_LOCAL_TEST_CHAIN: true,
    LOCAL_SOLANA_GENESIS: GENESIS,
  };
  const input = {
    obligationId,
    network: NETWORK,
    vault,
    githubUserId: ACTOR,
    claimId: "claim-1",
    claimDigest,
    destination: destination.address,
    idempotencyKey: "attempt-1",
  };
  return { env, input, store };
}

/** The destination wallet co-signs the prepared bytes, as the page does. */
function coSign(preparedTransaction: string): string {
  const signed = Uint8Array.from(atob(preparedTransaction), (c) =>
    c.charCodeAt(0),
  );
  const message = signed.slice(129);
  signed.set(ed25519.sign(message, destination.seed), 65);
  return b64(signed);
}

test("a finalized failed Solana binding permits one fresh binding for the same attempt", async () => {
  const { env, input, store } = setup();
  const attester = createSolanaAttester(env);
  try {
    const prepared = await attester.submit(input);
    expect(prepared.transaction).toBeString();
    const firstId = prepared.transactionId;

    // Re-preparing while the first attempt is merely unseen returns its exact
    // bytes; no second signing happens behind the contributor's back.
    const again = await attester.submit(input);
    expect(again.transactionId).toBe(firstId);
    expect(again.transaction).toBe(prepared.transaction);

    // The contributor co-signs and the completed transaction is broadcast.
    sendResult = firstId;
    const completed = await completeSolanaBinding(
      env,
      input,
      coSign(prepared.transaction as string),
    );
    expect(completed.transactionId).toBe(firstId);

    // No finalized binding exists, so the award still cannot pay.
    await expect(createSolanaExecutor(env).submit(input)).rejects.toThrow(
      "co-signature",
    );

    // A failure that is not yet finalized is not proof: replacement waits.
    statuses.set(firstId, {
      err: { InstructionError: [0, "Custom:6001"] },
      confirmationStatus: "confirmed",
    });
    await expect(attester.submit(input)).rejects.toThrow(
      "Existing transaction failed; reconcile before retry",
    );

    // Once the failure is finalized, a fresh binding can be prepared for the
    // same payout attempt instead of that attempt being blocked forever.
    statuses.set(firstId, {
      err: { InstructionError: [0, "Custom:6001"] },
      confirmationStatus: "finalized",
    });
    const replacement = await attester.submit(input);
    expect(replacement.transaction).toBeString();
    expect(replacement.transactionId).not.toBe(firstId);
    const archived = await store.get<{ transactionId: string }>(
      `solana:attester:${NETWORK}:attempt-1:expired:2000`,
    );
    expect(archived?.transactionId).toBe(firstId);

    // The replacement completes through the same co-sign and broadcast path.
    sendResult = replacement.transactionId;
    const second = await completeSolanaBinding(
      env,
      input,
      coSign(replacement.transaction as string),
    );
    expect(second.transactionId).toBe(replacement.transactionId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a finalized failed Solana binding refuses replacement when a matching binding already landed", async () => {
  const { env, input } = setup();
  const attester = createSolanaAttester(env);
  try {
    // The earlier test's finally restores the real fetch; re-install the
    // fixture stub for this test.
    globalThis.fetch = fixtureFetch;
    const prepared = await attester.submit(input);
    expect(prepared.transaction).toBeString();

    // The contributor co-signs and the completed transaction is broadcast.
    sendResult = prepared.transactionId;
    const completed = await completeSolanaBinding(
      env,
      input,
      coSign(prepared.transaction as string),
    );
    expect(completed.transactionId).toBe(prepared.transactionId);

    // The broadcast attempt failed and the failure is finalized, so the
    // replacement path opens — but a binding for this destination and claim
    // digest already landed on chain, so no fresh binding may be prepared.
    statuses.set(prepared.transactionId, {
      err: { InstructionError: [0, "Custom:6001"] },
      confirmationStatus: "finalized",
    });
    existingBinding = bindingBytes();
    await expect(attester.submit(input)).rejects.toThrow(
      "Binding changed; finalized receipt reconciliation required",
    );
  } finally {
    existingBinding = null;
    globalThis.fetch = originalFetch;
  }
});
