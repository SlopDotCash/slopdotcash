// spec/fees/diagnostics.md, "A fee diagnostic starts only on protected main, reads the exact active Worker before and after, and writes nothing"; spec/fees/conversion.md, "Each evaluation records one outcome from the pinned order of checks"

const providerMethods = {
  "evm-rpc": [
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
  ],
  "solana-rpc": ["getAccountInfo", "getBalance", "getLatestBlockhash", "getMultipleAccounts", "getTokenAccountsByOwner", "getFeeForMessage", "simulateTransaction"],
  jupiter: ["quote", "swap"],
  kyberswap: ["routes", "route/build"],
} as const satisfies Readonly<Record<string, ReadonlyArray<string>>>;

export type Provider = keyof typeof providerMethods;

const providerStages = ["deployment-check", "rpc-response", "response-json"] as const;

export type ProviderStage = (typeof providerStages)[number];

export interface ProviderFailure {
  readonly provider: Provider;
  readonly stage: ProviderStage;
  readonly method?: string;
  readonly httpStatus?: number;
}

export type RpcProvider = "evm-rpc" | "solana-rpc";

export interface ProviderErrorLog {
  readonly error: string;
  readonly providerFailure?: ProviderFailure;
}

function fieldOf(value: object, key: string): unknown {
  return Object.hasOwn(value, key) ? (value as Readonly<Record<string, unknown>>)[key] : undefined;
}

function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && Object.hasOwn(providerMethods, value);
}

function isStage(value: unknown): value is ProviderStage {
  return typeof value === "string" && (providerStages as ReadonlyArray<string>).includes(value);
}

/** @throws {never} */
export function sanitizeProviderFailure(value: unknown): ProviderFailure | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const provider = fieldOf(value, "provider");
  const stage = fieldOf(value, "stage");
  if (!isProvider(provider) || !isStage(stage)) return undefined;
  const method = fieldOf(value, "method");
  const httpStatus = fieldOf(value, "httpStatus");
  const listed: ReadonlyArray<string> = providerMethods[provider];
  return {
    provider,
    stage,
    ...(typeof method === "string" && listed.includes(method) ? { method } : {}),
    ...(typeof httpStatus === "number" && Number.isSafeInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? { httpStatus } : {}),
  };
}

const noted = new WeakMap<object, ProviderFailure>();

/** @throws {never} */
export function noteProviderFailure<T extends object>(error: T, failure: ProviderFailure): T {
  const kept = sanitizeProviderFailure(failure);
  if (kept !== undefined) noted.set(error, kept);
  return error;
}

/** @throws {never} */
export function httpFailureStatus(message: unknown): number | undefined {
  if (typeof message !== "string") return undefined;
  const status = /^RPC HTTP failure: (\d{3})$/u.exec(message)?.[1];
  return status === undefined ? undefined : Number(status);
}

function rpcFailure(error: object, rpc: RpcProvider): ProviderFailure | undefined {
  const tag = fieldOf(error, "_tag");
  const method = fieldOf(error, "method");
  if (tag === "RpcUnavailable") {
    const httpStatus = httpFailureStatus(fieldOf(error, "message"));
    if (httpStatus === undefined || (rpc === "evm-rpc" && httpStatus !== 401 && httpStatus !== 403)) return undefined;
    return sanitizeProviderFailure({ provider: rpc, stage: "rpc-response", method, httpStatus });
  }
  if (tag === "RpcMalformed" && rpc === "solana-rpc" && fieldOf(error, "issue") === "answer is not JSON")
    return sanitizeProviderFailure({ provider: rpc, stage: "response-json", method });
  return undefined;
}

/** @throws {never} */
export function providerFailureOf(error: unknown, rpc: RpcProvider): ProviderFailure | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  return noted.get(error) ?? rpcFailure(error, rpc);
}

/** @throws {never} */
export function carryProviderFailure<T extends object>(from: unknown, to: T, rpc: RpcProvider): T {
  const failure = providerFailureOf(from, rpc);
  return failure === undefined ? to : noteProviderFailure(to, failure);
}

/** @throws {never} */
export function providerErrorLog(error: unknown, rpc: RpcProvider, fallback: string): ProviderErrorLog {
  const failure = providerFailureOf(error, rpc);
  if (failure === undefined) return { error: fallback };
  const label = failure.stage === "response-json" && failure.provider !== "kyberswap"
    ? "unparseable response"
    : failure.httpStatus === undefined
      ? "provider request failed"
      : `HTTP ${failure.httpStatus}`;
  return { error: label, providerFailure: failure };
}

/** @throws {never} */
export function rpcProviderOf(network: string): RpcProvider {
  return network === "Solana" ? "solana-rpc" : "evm-rpc";
}
