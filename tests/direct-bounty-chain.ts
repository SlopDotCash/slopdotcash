/** Disposable external-wallet actions for the real Pages/D1 bounty browser flow. */
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import type { ReviewedEvmFactory } from "../contracts/evm/factories";
import { childEnvironment } from "../scripts/child-environment.mjs";
import { REWARD_ASSET_NETWORKS } from "../src/lib/reward-asset.mjs";
import {
  type BountyWalletActor,
  seedVerifiedWalletRows,
} from "./bounty-wallet-seed";

const { REVIEWED_EVM_FACTORIES } = createRequire(import.meta.url)(
  "../contracts/evm/factories.ts",
) as { REVIEWED_EVM_FACTORIES: ReviewedEvmFactory[] };

function localDirectEvmRpc(port: number) {
  const rpcUrl = `http://127.0.0.1:${port}`;
  let sequence = 0;
  async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, params }),
    });
    const body = (await response.json()) as { result: T; error?: unknown };
    if (body.error) throw new Error("The disposable chain request failed");
    return body.result;
  }
  return { rpcUrl, rpc };
}

/** Connect to the runner-owned chain without resetting its payment history. */
export async function connectLocalDirectEvmFixture(port: number) {
  const { rpcUrl, rpc } = localDirectEvmRpc(port);
  const [payer, reporter, recoveryAddress] =
    await rpc<string[]>("eth_accounts");
  const fee = REVIEWED_EVM_FACTORIES.find(
    (entry) => entry.network === "base-mainnet",
  )?.feeRecipient;
  if (!fee) throw new Error("Missing reviewed Base fee recipient");
  const token = REWARD_ASSET_NETWORKS.base.stablecoin.address;
  return {
    rpcUrl,
    payer,
    reporter,
    recoveryAddress,
    request: rpc,
    mine: (blocks = 128) => rpc("anvil_mine", [`0x${blocks.toString(16)}`]),
    fee,
    token,
    /** The test actor's disposable external wallet signs and sends these requests. */
    async send(
      transactions: {
        from: string;
        to: string;
        value: string;
        data: string;
        chainId?: string;
        nonce?: string;
      }[],
      finalize = true,
    ) {
      const ids: string[] = [];
      for (const tx of transactions) {
        if (
          tx.from.toLowerCase() !== payer.toLowerCase() ||
          ![token, reporter, recoveryAddress, payer, fee].some(
            (address) => address.toLowerCase() === tx.to.toLowerCase(),
          )
        )
          throw new Error("Unexpected disposable wallet request");
        ids.push(await rpc<string>("eth_sendTransaction", [tx]));
      }
      if (finalize) await rpc("anvil_mine", ["0x80"]);
      return ids;
    },
    async balance(address: string, asset = token) {
      if (asset === "native")
        return BigInt(await rpc<string>("eth_getBalance", [address, "latest"]));
      return BigInt(
        await rpc<string>("eth_call", [
          {
            to: asset,
            data: `0x70a08231${address.slice(2).padStart(64, "0")}`,
          },
          "latest",
        ]),
      );
    },
  };
}

export async function startLocalDirectEvmFixture(port: number) {
  const { rpc } = localDirectEvmRpc(port);
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === "string")
    throw new Error("Missing disposable Anvil address");
  const anvilPort = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const upstream = `http://127.0.0.1:${anvilPort}`;
  // Anvil does not include OP Stack receipt fields. The fixture models a
  // zero-L1-fee Base chain explicitly; production never receives this override.
  const proxy = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 262144) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const input = JSON.parse(body.toString("utf8")) as { method?: string };
      const result = await fetch(upstream, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const raw = await result.text();
      response.writeHead(result.status, {
        "content-type": "application/json",
      });
      if (input.method === "eth_getTransactionReceipt") {
        const receipt = JSON.parse(raw) as {
          result?: null | Record<string, unknown>;
        };
        if (receipt.result) receipt.result.l1Fee = "0x0";
        response.end(JSON.stringify(receipt));
      } else response.end(raw);
    } catch {
      response.writeHead(503).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(port, "127.0.0.1", resolve);
  });
  const process = spawn(
    "anvil",
    ["--port", String(anvilPort), "--chain-id", "8453", "--silent"],
    { env: childEnvironment(), stdio: "ignore" },
  );
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        if ((await rpc<string>("eth_chainId")) !== "0x2105") throw new Error();
        break;
      } catch {
        if (attempt > 80 || process.exitCode !== null)
          throw new Error("Disposable Anvil did not start");
        await sleep(100);
      }
    }
    const client = await connectLocalDirectEvmFixture(port);
    const { payer, token } = client;
    await rpc("anvil_setCode", [
      "0x420000000000000000000000000000000000000f",
      "0x600060005260206000f3",
    ]);
    const code = execFileSync(
      "forge",
      [
        "inspect",
        "--root",
        "contracts/evm",
        "FeeConverterUSDC",
        "deployedBytecode",
      ],
      { env: childEnvironment(), encoding: "utf8" },
    ).trim();
    await rpc("anvil_setCode", [token, code]);
    await rpc("eth_sendTransaction", [
      {
        from: payer,
        to: token,
        data: `0x40c10f19${payer.slice(2).padStart(64, "0")}${(100_000n * 1_000_000n).toString(16).padStart(64, "0")}`,
      },
    ]);
    return {
      ...client,
      async close() {
        proxy.closeAllConnections();
        await new Promise<void>((resolve) => proxy.close(() => resolve()));
        process.kill();
        if (process.exitCode === null)
          await new Promise<void>((resolve) =>
            process.once("exit", () => resolve()),
          );
      },
    };
  } catch (error) {
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    process.kill();
    throw error;
  }
}

/** Seed only the already-tested wallet-possession boundary in disposable local D1. */
export function seedVerifiedBountyWallets(
  persistTo: string,
  actors: BountyWalletActor[],
) {
  seedVerifiedWalletRows(persistTo, actors, {
    chain: "base",
    idPrefix: "direct-browser-",
    valid: (actor) =>
      /^\d+$/u.test(actor.githubId) && /^0x[\da-f]{40}$/iu.test(actor.address),
    invalidMessage: "Invalid local wallet actor",
  });
}
