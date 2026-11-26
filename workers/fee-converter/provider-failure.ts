/** Shared provider diagnostics for the Worker and dependency-free operator inspection. */
const methods = {
  "evm-rpc": new Set([
    "eth_blockNumber",
    "eth_call",
    "eth_estimateGas",
    "eth_feeHistory",
    "eth_getBlockByNumber",
    "eth_getCode",
    "eth_getStorageAt",
    "eth_getTransactionCount",
    "eth_sendRawTransaction",
    "eth_getTransactionReceipt",
    "eth_maxPriorityFeePerGas",
    "eth_gasPrice",
  ]),
  "solana-rpc": new Set([
    "getAccountInfo",
    "getBalance",
    "getLatestBlockhash",
    "getMultipleAccounts",
    "getTokenAccountsByOwner",
    "getFeeForMessage",
    "simulateTransaction",
  ]),
  jupiter: new Set(["quote", "swap"]),
  kyberswap: new Set(["routes", "route/build"]),
};
type Provider = keyof typeof methods;
const stages = new Set(["deployment-check", "rpc-response", "response-json"]);
export interface ProviderFailure {
  provider: Provider;
  stage: string;
  method?: string;
  httpStatus?: number;
}

/** Only fixed fields survive either the worker log or the diagnostic read. */
export function sanitizeProviderFailure(
  value: unknown,
): ProviderFailure | undefined {
  if (!value || typeof value !== "object") return;
  const { provider, stage, method, httpStatus } =
    value as Partial<ProviderFailure>;
  if (
    typeof provider !== "string" ||
    !Object.hasOwn(methods, provider) ||
    typeof stage !== "string" ||
    !stages.has(stage)
  )
    return;
  const failure: ProviderFailure = { provider, stage };
  if (typeof method === "string" && methods[provider].has(method))
    failure.method = method;
  if (
    typeof httpStatus === "number" &&
    Number.isInteger(httpStatus) &&
    httpStatus >= 100 &&
    httpStatus <= 599
  )
    failure.httpStatus = httpStatus;
  return failure;
}
