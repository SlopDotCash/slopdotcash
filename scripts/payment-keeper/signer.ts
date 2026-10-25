import { ed25519 } from "@noble/curves/ed25519.js";
import { privateKeyToAccount } from "viem/accounts";
import { solanaBase58 } from "../../contracts/solana/adapter";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import type { KeeperConfiguration, KeeperDependencies } from "./keeper";

/** The operator's runtime supplies secrets only when a reviewed operation reaches signing. */
export function keeperSigners(
  config: KeeperConfiguration,
  secret: (
    name: "KEEPER_EVM_PRIVATE_KEY" | "KEEPER_SOLANA_SIGNER_SEED",
  ) => string | undefined,
): Pick<KeeperDependencies, "evmSigner" | "solanaSigner"> {
  const family = ESCROW_NETWORKS[config.network].family;
  return {
    ...(family === "evm"
      ? {
          evmSigner: {
            address: config.signer,
            async signTransaction(
              input: Parameters<
                ReturnType<typeof privateKeyToAccount>["signTransaction"]
              >[0],
            ) {
              const key = secret("KEEPER_EVM_PRIVATE_KEY");
              if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key))
                throw new Error("Dedicated operator EVM key unavailable");
              const account = privateKeyToAccount(key as `0x${string}`);
              if (account.address.toLowerCase() !== config.signer.toLowerCase())
                throw new Error(
                  "Operator key does not match configured signer",
                );
              return account.signTransaction(input);
            },
          },
        }
      : {}),
    ...(family === "solana"
      ? {
          solanaSigner: {
            address: config.signer,
            async signMessage(message: Uint8Array) {
              const value = secret("KEEPER_SOLANA_SIGNER_SEED");
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
  };
}
