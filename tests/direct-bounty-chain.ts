/** Disposable external-wallet actions for the real Pages/D1 bounty browser flow. */
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { REVIEWED_EVM_FACTORIES } from "../contracts/evm/factories";
import { REWARD_ASSET_NETWORKS } from "../src/lib/reward-asset.mjs";

export async function startLocalDirectEvmFixture(port: number) {
  const rpcUrl = `http://127.0.0.1:${port}`;
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
    { stdio: "ignore" },
  );
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
    const [payer, reporter, recoveryAddress] =
      await rpc<string[]>("eth_accounts");
    const fee = REVIEWED_EVM_FACTORIES.find(
      (entry) => entry.network === "base-mainnet",
    )?.feeRecipient;
    if (!fee) throw new Error("Missing reviewed Base fee recipient");
    const token = REWARD_ASSET_NETWORKS.base.stablecoin.address;
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
      { encoding: "utf8" },
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
          return BigInt(
            await rpc<string>("eth_getBalance", [address, "latest"]),
          );
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
  actors: { githubId: string; githubLogin: string; address: string }[],
) {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const statements: string[] = [];
  for (const actor of actors) {
    if (
      !/^\d+$/u.test(actor.githubId) ||
      !/^0x[\da-f]{40}$/iu.test(actor.address)
    )
      throw new Error("Invalid local wallet actor");
    const id = `direct-browser-${actor.githubId}`;
    const challenge = `${id}-challenge`,
      at = new Date().toISOString();
    statements.push(
      `INSERT OR IGNORE INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES(${[id, actor.githubId, actor.githubLogin, actor.address, "d1_registry", hash(id), at, hash(`${id}:${actor.address}`), at, "base"].map(quote).join(",")});`,
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
    { stdio: "pipe" },
  );
}

/** A new, verified successor claim in the same disposable local D1 lineage. */
export function rotateVerifiedBountyWallet(
  persistTo: string,
  actor: { githubId: string; githubLogin: string; address: string },
) {
  if (
    !/^\d+$/u.test(actor.githubId) ||
    !/^0x[\da-f]{40}$/iu.test(actor.address)
  )
    throw new Error("Invalid local wallet actor");
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const digest = createHash("sha256")
    .update(`${actor.githubId}:${actor.address}`)
    .digest("hex");
  const id = `direct-rotated-${actor.githubId}-${randomUUID()}`,
    challenge = `${id}-challenge`,
    at = new Date().toISOString();
  const recordDigest = createHash("sha256")
    .update(`${id}:${digest}:${at}`)
    .digest("hex");
  const sql = [
    `INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain,supersedes_claim_id) SELECT ${quote(id)},github_user_id,${quote(actor.githubLogin)},${quote(actor.address)},'d1_registry',${quote(digest)},${quote(at)},${quote(recordDigest)},${quote(at)},chain,id FROM effective_payment_wallet_claims WHERE github_user_id=${quote(actor.githubId)} AND chain='base' AND lower(wallet_address)<>lower(${quote(actor.address)});`,
    `INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) SELECT ${[challenge, id, actor.githubId, "disposable browser rotation", new Date(Date.now() + 86_400_000).toISOString(), at].map(quote).join(",")} WHERE EXISTS(SELECT 1 FROM wallet_claims WHERE id=${quote(id)});`,
    `INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) SELECT ${[id, actor.githubId, at, challenge, "disposable verified wallet fixture"].map(quote).join(",")} WHERE EXISTS(SELECT 1 FROM wallet_claims WHERE id=${quote(id)});`,
    `SELECT id FROM effective_payment_wallet_claims WHERE github_user_id=${quote(actor.githubId)} AND chain='base' AND lower(wallet_address)=lower(${quote(actor.address)});`,
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
      "EVM fixture wallet rotation did not resolve a current claim",
    );
  return current;
}
