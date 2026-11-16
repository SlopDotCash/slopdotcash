/** Disposable native-SOL wallet for the real Pages/D1 browser workflow. */
import { createPrivateKey, sign } from "node:crypto";
import { closeSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { startLocalSolanaValidator } from "../scripts/local-solana-validator.mjs";
import { SOLANA_NATIVE_ASSET } from "../src/lib/escrow-policy.mjs";
import { seedVerifiedWalletRows } from "./bounty-wallet-seed";

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
  let launched: Awaited<ReturnType<typeof startLocalSolanaValidator>>;
  try {
    launched = await startLocalSolanaValidator({
      rpcPort: port,
      args: [
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
      stdio: ["ignore", log, log],
      receiptPath: process.env.SLOP_SOLANA_CONTAINER_RECEIPT,
    });
  } catch (error) {
    closeSync(log);
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  const validator = launched.process;
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
    try {
      await launched.close();
    } finally {
      closeSync(log);
      rmSync(directory, { recursive: true, force: true });
    }
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
      /** Sign only this disposable wallet's server-issued possession message. */
      signWalletAuthorization(address: string, message: string): string {
        const key =
          address === reporter
            ? reporterKey
            : address === recoveryAddress
              ? recoveryKey
              : null;
        if (
          !key ||
          !message.startsWith(
            "Authorize Slop automatic contributor payouts\nAudience: slop.cash\n",
          ) ||
          !message.includes(`\nChain: solana\nWallet: ${address}\n`)
        )
          throw new Error("Unexpected disposable wallet authorization");
        const privateKey = createPrivateKey({
          key: Buffer.concat([
            Buffer.from("302e020100300506032b657004220420", "hex"),
            Buffer.from(key.secretKey.subarray(0, 32)),
          ]),
          type: "pkcs8",
          format: "der",
        });
        return sign(null, Buffer.from(message, "utf8"), privateKey).toString(
          "base64",
        );
      },
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
  seedVerifiedWalletRows(persistTo, actors, {
    chain: "solana",
    idPrefix: "direct-solana-browser-",
    valid: (actor) =>
      /^[1-9]\d{0,19}$/u.test(actor.githubId) &&
      decodeBase58Bytes(actor.address).length === 32,
    invalidMessage: "Invalid disposable Solana wallet actor",
  });
}
