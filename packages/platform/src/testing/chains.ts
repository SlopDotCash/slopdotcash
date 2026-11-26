// spec/operations/localValidator.md, "Story: Run tests only against the validator owned by the current stage"; spec/settlement/evmScan.md, "A run first authenticates the RPC chain, including for an empty page"; spec/settlement/solanaScan.md, "A fresh scan invocation verifies the selected endpoint's network"
import { rpc } from "./chains/faults.ts";

export { type Account, type Anvil, type AnvilOptions, type Artifact, type ForgeOutput, type Receipt, type Transaction, anvil, artifact, deploy, forgeBuild } from "./chains/anvil.ts";
export { type Fault, type FaultRule, type Fired, type Served, forward, portsFree, rpc, rpcFaults, serve } from "./chains/faults.ts";
export { type Payer, type ProgramBuild, type Validator, type ValidatorOptions, type ValidatorReceipt, SOLANA_TEST_BINARY_SHA256, SOLANA_TEST_IMAGE, SOLANA_TEST_VERSION, sbfBuild, solanaValidator } from "./chains/validator.ts";

export type Observed =
  | { readonly family: "evm"; readonly chainId: bigint; readonly client: string }
  | { readonly family: "solana"; readonly genesis: string };

const publicSolanaClusters: Readonly<Record<string, string>> = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "mainnet",
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: "devnet",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY": "testnet",
};

const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);

export async function refuseMainnet(chain: { readonly url: string; readonly family: "evm" | "solana" }): Promise<Observed> {
  const { hostname } = new URL(chain.url);
  if (!loopback.has(hostname)) throw new Error(`Refusing a non-loopback RPC endpoint (${hostname})`);
  if (chain.family === "solana") {
    const genesis = await rpc(chain.url, "getGenesisHash");
    if (typeof genesis !== "string") throw new Error("getGenesisHash answered no hash");
    const cluster = publicSolanaClusters[genesis];
    if (cluster !== undefined) throw new Error(`Refusing Solana ${cluster}`);
    return { family: "solana", genesis };
  }
  const id = await rpc(chain.url, "eth_chainId");
  const client = await rpc(chain.url, "web3_clientVersion");
  if (typeof id !== "string" || !/^0x[0-9a-f]+$/iu.test(id)) throw new Error("eth_chainId answered no quantity");
  if (typeof client !== "string" || !client.startsWith("anvil/")) throw new Error(`Refusing chain id ${BigInt(id)}: the endpoint is not a local anvil`);
  return { family: "evm", chainId: BigInt(id), client };
}
