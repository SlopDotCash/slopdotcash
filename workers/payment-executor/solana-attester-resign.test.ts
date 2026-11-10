// E2 (round 3): the Solana attester re-signs a binding for an award that was
// paid externally while its blockhash expired, because the refresh path only
// checks the binding for the attester role and never rechecks the paid flag.
// The EVM attester checks the paid flag on every path; the relayer/keeper
// roles of this same function do too. Synthetic data only: a local JSON-RPC
// node answers every chain read, and the award flips to paid between the
// second submit's first read and its refresh read.
//
// Note on the trigger: the audit summary says the binding must be unchanged,
// but the code throws "Binding changed..." exactly when the refreshed binding
// still matches the requested destination and digest (i.e. the bind already
// landed), so the live hole needs the binding to have rotated between the
// opening read and the refresh read. The fix is the same either way: recheck
// the paid flag on the refreshed state before re-signing.

import { expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { buildPaymentWalletMessage } from "../../backend/payments/possession";
import {
  BINDING_SIZE,
  CONFIG_DISCRIMINATOR,
  OBLIGATION_DISCRIMINATOR,
  OBLIGATION_SIZE,
  PROJECT_DISCRIMINATOR,
  PROJECT_SIZE,
  SOLANA_NATIVE_ASSET,
  solanaAwardId,
  solanaConfigAddress,
  solanaDigest,
  solanaVaultAddress,
} from "../../contracts/solana/adapter";
import { bytes, encoder, le, pda } from "../../contracts/solana/transactions";
import { encodeBase58Bytes } from "../../src/lib/base58";
import { encodeBase64 } from "../../src/lib/byte-encoding";
import { memoryJournal, serveJsonRpc } from "../../tests/payment-test-journal";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { createSolanaAttester } from "./solana";

const seed = (label: string) => sha256(encoder.encode(label));
const address = (priv: Uint8Array) =>
  encodeBase58Bytes(ed25519.getPublicKey(priv));
const hexBytes = (hex: string) => hexToBytes(hex);
const putBytes = (target: Uint8Array, offset: number, value: Uint8Array) =>
  target.set(value, offset);
const putU64 = (target: Uint8Array, offset: number, value: bigint) =>
  new DataView(target.buffer, target.byteOffset).setBigUint64(
    offset,
    value,
    true,
  );
const putI64 = (target: Uint8Array, offset: number, value: bigint) =>
  new DataView(target.buffer, target.byteOffset).setBigInt64(
    offset,
    value,
    true,
  );
const account = (data: Uint8Array, owner: string) => ({
  value: { owner, data: [encodeBase64(data), "base64"] },
});

test("attester resign refuses an award paid between its reads", async () => {
  const programSeed = seed("solana-test-program");
  const projectSeed = seed("solana-test-project");
  const ownerSeed = seed("solana-test-owner");
  const identitySeed = seed("solana-test-identity");
  const feeSeed = seed("solana-test-fee");
  const rotationSeed = seed("solana-test-rotation");
  const destinationSeed = seed("solana-test-destination");
  const programId = address(programSeed);
  const projectPda = address(projectSeed);
  const owner = address(ownerSeed);
  const identityAuthority = address(identitySeed);
  const feeRecipient = address(feeSeed);
  const rotationAuthority = address(rotationSeed);
  const destination = address(destinationSeed);
  const vault = solanaVaultAddress(programId, projectPda);
  const networkDomain = "b".repeat(64);
  const sourceDigest = "a".repeat(64);
  const claimDigest = "c".repeat(64);
  const obligationId = solanaAwardId(projectPda, sourceDigest);
  const awardAddress = pda(programId, [
    encoder.encode("award"),
    bytes(projectPda),
    solanaDigest(obligationId),
  ]);
  const bindingAddress = pda(programId, [
    encoder.encode("wallet"),
    bytes(projectPda),
    le(123n),
  ]);

  const code = new Uint8Array(64).fill(7);
  const codeSha256 = bytesToHex(sha256(code));
  const programAccount = {
    value: {
      owner: "BPFLoader2111111111111111111111111111111111",
      executable: true,
      data: [encodeBase64(code), "base64"],
    },
  };
  const configData = new Uint8Array(105);
  putBytes(configData, 0, hexBytes(CONFIG_DISCRIMINATOR));
  putBytes(configData, 8, bytes(identityAuthority));
  putBytes(configData, 40, bytes(feeRecipient));
  putBytes(configData, 72, bytes(rotationAuthority));
  configData[104] = 255;
  const projectData = new Uint8Array(PROJECT_SIZE);
  putBytes(projectData, 0, hexBytes(PROJECT_DISCRIMINATOR));
  putBytes(projectData, 8, bytes(owner));
  putBytes(projectData, 72, solanaDigest(networkDomain));
  putBytes(projectData, 104, bytes(identityAuthority));
  putBytes(projectData, 136, bytes(feeRecipient));
  putBytes(projectData, 168, bytes(SOLANA_NATIVE_ASSET));
  putI64(projectData, 249, 0n);
  putI64(projectData, 298, 0n);
  projectData[306] = 0;
  const obligationData = (paid: boolean) => {
    const data = new Uint8Array(OBLIGATION_SIZE);
    putBytes(data, 0, hexBytes(OBLIGATION_DISCRIMINATOR));
    putU64(data, 8, 100n);
    putBytes(data, 16, hexBytes(sourceDigest));
    putBytes(data, 48, bytes(projectPda));
    putU64(data, 112, 123n);
    putU64(data, 120, 98n);
    putU64(data, 128, 2n);
    data[136] = paid ? 1 : 0;
    putI64(data, 137, 0n);
    return data;
  };
  const bindingData = (rotated: boolean) => {
    const data = new Uint8Array(BINDING_SIZE);
    putBytes(data, 0, hexBytes("33d3ccb9a84434b0"));
    putBytes(data, 8, hexBytes(rotated ? "d".repeat(64) : claimDigest));
    putBytes(data, 112, bytes(rotated ? feeRecipient : destination));
    putU64(data, 144, rotated ? 2n : 1n);
    return data;
  };

  // The award is unpaid for the first two finalized reads (both submits'
  // opening reads) and paid from the third read on, which is the refresh
  // read inside the second submit. The binding matches for the first two
  // reads and has rotated to another wallet by the refresh read, so the
  // attester's binding guard does not fire either.
  let awardReads = 0;
  let bindingReads = 0;
  const rpc = serveJsonRpc((method, params) => {
    if (method === "getGenesisHash") return "test-genesis";
    if (method === "getAccountInfo") {
      const addressParam = params[0] as string;
      if (addressParam === programId) return programAccount;
      if (addressParam === solanaConfigAddress(programId))
        return account(configData, programId);
      if (addressParam === projectPda) return account(projectData, programId);
      if (addressParam === awardAddress) {
        awardReads += 1;
        return account(obligationData(awardReads >= 3), programId);
      }
      if (addressParam === bindingAddress) {
        bindingReads += 1;
        return account(bindingData(bindingReads >= 3), programId);
      }
      return { value: null };
    }
    if (method === "getSignatureStatuses") return { value: [null] };
    if (method === "getBlockHeight") return 200;
    if (method === "getLatestBlockhash")
      return {
        value: {
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 100,
        },
      };
    if (method === "sendTransaction") return "11111111111111111111111111111111";
    throw new Error(`Unexpected RPC method ${method}`);
  });

  const { db, sqlite } = sqliteD1();
  const at = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  const message = buildPaymentWalletMessage({
    actorId: "123",
    chain: "solana",
    address: destination,
    claimId: "claim",
    claimDigest,
    nonce: "challenge-1",
    expiresAt,
  });
  const signature = Buffer.from(
    ed25519.sign(new TextEncoder().encode(message), destinationSeed),
  ).toString("base64");
  sqlite
    .query(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES('claim','123','alice',?,'d1_registry',?,?,?,?,'solana')",
    )
    .run(destination, "a".repeat(64), at, claimDigest, at);
  sqlite
    .query(
      "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES('challenge-1','claim','123',?,?,?)",
    )
    .run(message, expiresAt, new Date(Date.now() - 1000).toISOString());
  sqlite
    .query(
      "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES('claim','123',?,'challenge-1',?)",
    )
    .run(at, signature);
  sqlite
    .query(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?, 'project-1','123','solana-localnet','solana',?,?,9,'100','2',?,'reserved',?)",
    )
    .run(obligationId, vault, SOLANA_NATIVE_ASSET, sourceDigest, at);
  sqlite
    .query(
      "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state) VALUES('attempt-1',?,'claim',?,'prepared')",
    )
    .run(obligationId, at);

  const env = {
    PAYMENTS_DB: db as never,
    PAYMENT_DEPLOYMENTS: JSON.stringify([
      {
        network: "solana-localnet",
        chain: "solana",
        programId,
        projectPda,
        projectId: "project-1",
        vault,
        mint: SOLANA_NATIVE_ASSET,
        networkDomain,
        owner,
        identityAuthority,
        feeRecipient,
        rotationAuthority,
        codeSha256,
        upgradeAuthority: null,
        bindingDelaySeconds: "0",
        rotationDelaySeconds: "0",
        payoutPolicy: "ordinary",
      },
    ]),
    PAYMENT_RPC_URLS: JSON.stringify({ "solana-localnet": rpc.url }),
    SOLANA_SIGNER: {
      address: identityAuthority,
      signMessage: async (value: Uint8Array) =>
        ed25519.sign(value, identitySeed),
    },
    JOURNAL: memoryJournal(),
    ALLOW_LOCAL_TEST_CHAIN: true,
    LOCAL_SOLANA_GENESIS: "test-genesis",
  };
  const input = {
    obligationId,
    network: "solana-localnet",
    vault,
    githubUserId: "123",
    claimId: "claim",
    claimDigest,
    destination,
    idempotencyKey: "attempt-1",
  };
  try {
    const first = await createSolanaAttester(env).submit(input);
    expect(first.transactionId).toBeString();
    expect(first.transaction).toBeString();
    // The award was paid externally after the opening read; the expired
    // blockhash forces the refresh path, which must refuse to re-sign.
    await expect(createSolanaAttester(env).submit(input)).rejects.toThrow(
      "Paid outside known attempt; finalized receipt reconciliation required",
    );
  } finally {
    rpc.stop();
  }
});
