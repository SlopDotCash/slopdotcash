import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ed25519 } from "@noble/curves/ed25519.js";
import { privateKeyToAccount } from "viem/accounts";
import { solanaBase58 } from "../../contracts/solana/adapter";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import { validateBudget } from "./budget";
import { type KeeperConfiguration, runKeeper } from "./keeper";
import { openKeeperStore } from "./store";

const { values } = parseArgs({
  options: {
    config: { type: "string" },
    journal: { type: "string" },
    execute: { type: "boolean", default: false },
  },
  strict: true,
});
if (!values.config || !values.journal)
  throw new Error(
    "Use --config <operator.json> --journal <persistent.sqlite>; omit --execute for read-only chain checks",
  );
const config = JSON.parse(
  readFileSync(values.config, "utf8"),
) as KeeperConfiguration;
validateBudget(config.gas);
const family = ESCROW_NETWORKS[config.network]?.family;
if (!family) throw new Error("Choose a reviewed network");
const store = openKeeperStore(values.journal);
try {
  const result = await runKeeper(
    config,
    {
      store,
      ...(values.execute && family === "evm"
        ? {
            evmSigner: {
              address: config.signer,
              async signTransaction(
                input: Parameters<
                  ReturnType<typeof privateKeyToAccount>["signTransaction"]
                >[0],
              ) {
                const key = process.env.KEEPER_EVM_PRIVATE_KEY;
                if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key))
                  throw new Error("Dedicated operator EVM key unavailable");
                const account = privateKeyToAccount(key as `0x${string}`);
                if (
                  account.address.toLowerCase() !== config.signer.toLowerCase()
                )
                  throw new Error(
                    "Operator key does not match configured signer",
                  );
                return account.signTransaction(input);
              },
            },
          }
        : {}),
      ...(values.execute && family === "solana"
        ? {
            solanaSigner: {
              address: config.signer,
              async signMessage(message: Uint8Array) {
                const value = process.env.KEEPER_SOLANA_SIGNER_SEED;
                if (!value || !/^[0-9a-f]{64}$/.test(value))
                  throw new Error("Dedicated operator Solana seed unavailable");
                const seed = Uint8Array.from(value.match(/../g) ?? [], (byte) =>
                  Number.parseInt(byte, 16),
                );
                if (solanaBase58(ed25519.getPublicKey(seed)) !== config.signer)
                  throw new Error(
                    "Operator key does not match configured signer",
                  );
                return ed25519.sign(message, seed);
              },
            },
          }
        : {}),
    },
    values.execute,
  );
  console.log(
    JSON.stringify(
      {
        mode: values.execute ? "execute" : "dry-run",
        network: config.network,
        results: result,
      },
      null,
      2,
    ),
  );
  if (
    result.some(
      (item) =>
        item.state === "unavailable" ||
        item.state === "publication-unavailable" ||
        item.error,
    )
  )
    process.exitCode = 1;
} finally {
  store.close();
}
