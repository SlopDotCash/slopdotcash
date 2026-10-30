/** Disposable native-SOL wallet for the real Pages/D1 browser workflow. */
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { childEnvironment } from "../scripts/child-environment.mjs";
import { SOLANA_NATIVE_ASSET } from "../src/lib/escrow-policy.mjs";

const fixtureRequire = createRequire(import.meta.url);
const { REVIEWED_SOLANA_PROGRAMS } = fixtureRequire(
  "../contracts/solana/programs.ts",
) as { REVIEWED_SOLANA_PROGRAMS: { network: string; feeRecipient: string }[] };
const require = createRequire(
  new URL("../contracts/solana/package.json", import.meta.url),
);
const bs58 = require("bs58");
const decodeBase58Bytes = (value: string): Uint8Array =>
  new Uint8Array((bs58.default ?? bs58).decode(value));
const {
  Connection,
  Keypair,
  Transaction,
  SystemProgram,
  SystemInstruction,
} = require("@solana/web3.js");

export async function startLocalDirectSolanaFixture(port: number) {
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65490)
    throw new Error("Invalid disposable Solana port");
  const directory = mkdtempSync(join(tmpdir(), "slop-browser-solana-"));
  const log = openSync(join(directory, "validator.log"), "w", 0o600);
  const validator = spawn(
    "solana-test-validator",
    [
      "--reset",
      "--quiet",
      "--ticks-per-slot",
      "8",
      "--ledger",
      join(directory, "ledger"),
      "--rpc-port",
      String(port),
      "--faucet-port",
      String(port + 41),
      "--dynamic-port-range",
      `${port + 2}-${port + 31}`,
      "--bind-address",
      "127.0.0.1",
    ],
    { env: childEnvironment(), stdio: ["ignore", log, log] },
  );
  const rpcUrl = `http://127.0.0.1:${port}`;
  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 180_000,
  });
  const payerKey = Keypair.generate(),
    reporterKey = Keypair.generate(),
    recoveryKey = Keypair.generate();
  const payer = String(payerKey.publicKey.toBase58()),
    reporter = String(reporterKey.publicKey.toBase58()),
    recoveryAddress = String(recoveryKey.publicKey.toBase58());
  const fee = REVIEWED_SOLANA_PROGRAMS.find(
    (entry) => entry.network === "solana-mainnet",
  )?.feeRecipient;
  const history = createServer(async (request, response) => {
    try {
      const parts: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 65536) throw new Error("Oversized fixture RPC");
        parts.push(chunk);
      }
      const result = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: Buffer.concat(parts),
        signal: AbortSignal.timeout(15_000),
      });
      response.writeHead(result.status, { "content-type": "application/json" });
      response.end(await result.text());
    } catch {
      response.writeHead(503).end();
    }
  });
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    connection._rpcWebSocket.close();
    if (history.listening)
      await new Promise<void>((resolve) => history.close(() => resolve()));
    if (validator.exitCode === null && validator.signalCode === null) {
      const exited = new Promise<void>((resolve) =>
        validator.once("exit", () => resolve()),
      );
      validator.kill("SIGTERM");
      await Promise.race([exited, sleep(5000)]);
      if (validator.exitCode === null && validator.signalCode === null) {
        validator.kill("SIGKILL");
        await exited;
      }
    }
    closeSync(log);
    rmSync(directory, { recursive: true, force: true });
  }
  try {
    if (!fee) throw new Error("Missing reviewed Solana fee recipient");
    let genesisHash = "";
    for (let attempt = 0; attempt < 100; attempt++) {
      if (validator.exitCode !== null || validator.signalCode !== null)
        throw new Error("Disposable Solana validator stopped");
      try {
        genesisHash = String(await connection.getGenesisHash());
        break;
      } catch {
        await sleep(200);
      }
    }
    if (!genesisHash)
      throw new Error("Disposable Solana validator did not start");
    const airdrop = await connection.requestAirdrop(
      payerKey.publicKey,
      10_000_000_000,
    );
    const funded = await connection.confirmTransaction(airdrop, "finalized");
    if (funded.value.err)
      throw new Error("Disposable payer could not be funded");
    await new Promise<void>((resolve, reject) => {
      history.once("error", reject);
      history.listen(0, "127.0.0.1", () => resolve());
    });
    const address = history.address();
    if (!address || typeof address === "string")
      throw new Error("Missing recovery fixture address");
    return {
      rpcUrl,
      recoveryRpcUrl: `http://127.0.0.1:${address.port}`,
      genesisHash,
      payer,
      reporter,
      recoveryAddress,
      fee,
      asset: SOLANA_NATIVE_ASSET,
      publicKey: decodeBase58Bytes(payer),
      async balance(
        address: string,
        asset: "native" | "token" = "native",
      ): Promise<bigint> {
        if (asset !== "native")
          throw new Error("This browser fixture covers native SOL only");
        const { PublicKey } = require("@solana/web3.js");
        return BigInt(
          await connection.getBalance(new PublicKey(address), "finalized"),
        );
      },
      /** Sign only the exact retained native transfer message; never refresh its blockhash. */
      async signAndSend(raw: Uint8Array): Promise<Uint8Array> {
        const transaction = Transaction.from(Buffer.from(raw));
        if (
          String(transaction.feePayer?.toBase58()) !== payer ||
          transaction.signatures.length !== 1 ||
          transaction.instructions.length < 1 ||
          transaction.instructions.length > 2
        )
          throw new Error("Unexpected disposable Solana payer or message");
        for (const instruction of transaction.instructions) {
          if (!instruction.programId.equals(SystemProgram.programId))
            throw new Error("The browser fixture signs native transfers only");
          const transfer = SystemInstruction.decodeTransfer(instruction);
          if (
            String(transfer.fromPubkey.toBase58()) !== payer ||
            ![reporter, recoveryAddress, fee].includes(
              String(transfer.toPubkey.toBase58()),
            ) ||
            BigInt(transfer.lamports) <= 0n ||
            BigInt(transfer.lamports) > 1_000_000_000n
          )
            throw new Error("Unexpected disposable Solana transfer");
        }
        const message = Buffer.from(transaction.serializeMessage());
        transaction.sign(payerKey);
        if (!message.equals(Buffer.from(transaction.serializeMessage())))
          throw new Error("Wallet changed the retained message");
        const signature = String(
          await connection.sendRawTransaction(transaction.serialize()),
        );
        const confirmed = await connection.confirmTransaction(
          signature,
          "finalized",
        );
        if (confirmed.value.err) throw new Error("Disposable transfer failed");
        return decodeBase58Bytes(signature);
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Seed the existing wallet-possession boundary, restricted to disposable D1. */
export function seedVerifiedSolanaBountyWallets(
  persistTo: string,
  actors: { githubId: string; githubLogin: string; address: string }[],
) {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const statements: string[] = [];
  for (const actor of actors) {
    if (
      !/^[1-9]\d{0,19}$/u.test(actor.githubId) ||
      decodeBase58Bytes(actor.address).length !== 32
    )
      throw new Error("Invalid disposable Solana wallet actor");
    const id = `direct-solana-browser-${actor.githubId}`,
      challenge = `${id}-challenge`,
      at = new Date().toISOString();
    statements.push(
      `INSERT OR IGNORE INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES(${[id, actor.githubId, actor.githubLogin, actor.address, "d1_registry", hash(id), at, hash(`${id}:${actor.address}`), at, "solana"].map(quote).join(",")});`,
    );
    statements.push(
      `INSERT OR IGNORE INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(${[challenge, id, actor.githubId, "disposable browser fixture", new Date(Date.now() + 86_400_000).toISOString(), at].map(quote).join(",")});`,
    );
    statements.push(
      `INSERT OR IGNORE INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(${[id, actor.githubId, at, challenge, "disposable verified wallet fixture"].map(quote).join(",")});`,
    );
  }
  execFileSync(
    "node",
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "slop-private",
      "--local",
      "--persist-to",
      persistTo,
      "--command",
      statements.join("\n"),
    ],
    { stdio: "pipe", maxBuffer: 4 * 1024 * 1024 },
  );
}

/** Append a verified successor in disposable D1; the wallet keys stay in this fixture. */
export function rotateVerifiedSolanaBountyWallet(
  persistTo: string,
  actor: { githubId: string; githubLogin: string; address: string },
) {
  if (
    !/^[1-9]\d{0,19}$/u.test(actor.githubId) ||
    decodeBase58Bytes(actor.address).length !== 32
  )
    throw new Error("Invalid disposable Solana wallet actor");
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const digest = createHash("sha256")
    .update(`${actor.githubId}:${actor.address}`)
    .digest("hex");
  const id = `direct-solana-rotated-${actor.githubId}-${randomUUID()}`,
    challenge = `${id}-challenge`,
    at = new Date().toISOString();
  const recordDigest = createHash("sha256")
    .update(`${id}:${digest}:${at}`)
    .digest("hex");
  const sql = [
    `INSERT OR IGNORE INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain,supersedes_claim_id) SELECT ${quote(id)},github_user_id,${quote(actor.githubLogin)},${quote(actor.address)},'d1_registry',${quote(digest)},${quote(at)},${quote(recordDigest)},${quote(at)},chain,id FROM effective_payment_wallet_claims WHERE github_user_id=${quote(actor.githubId)} AND chain='solana' AND wallet_address<>${quote(actor.address)};`,
    `INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) SELECT ${[challenge, id, actor.githubId, "disposable browser rotation", new Date(Date.now() + 86_400_000).toISOString(), at].map(quote).join(",")} WHERE EXISTS(SELECT 1 FROM wallet_claims WHERE id=${quote(id)});`,
    `INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) SELECT ${[id, actor.githubId, at, challenge, "disposable verified wallet fixture"].map(quote).join(",")} WHERE EXISTS(SELECT 1 FROM wallet_claims WHERE id=${quote(id)});`,
    `SELECT id FROM effective_payment_wallet_claims WHERE github_user_id=${quote(actor.githubId)} AND chain='solana' AND wallet_address=${quote(actor.address)};`,
  ].join("\n");
  const output = execFileSync(
    "node",
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "slop-private",
      "--local",
      "--persist-to",
      persistTo,
      "--command",
      sql,
      "--json",
    ],
    { stdio: "pipe", encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  const results = JSON.parse(output) as { results?: { id?: string }[] }[];
  const current = results
    .flatMap((result) => result.results ?? [])
    .find((result) => typeof result.id === "string")?.id;
  if (!current)
    throw new Error(
      "Solana fixture wallet rotation did not resolve a current claim",
    );
  return current;
}
