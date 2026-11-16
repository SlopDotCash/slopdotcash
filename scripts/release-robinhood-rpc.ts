import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseBuybackConfig } from "../workers/fee-converter/buyback-config";
import { parseConfig } from "../workers/fee-converter/config";
import { createEvmClient } from "../workers/fee-converter/evm";
import {
  qualifySolanaRpcPair,
  SOLANA_PUBLIC_PAIR,
} from "./qualify-solana-rpc-pair";

const worker = "slop-fee-converter";
const configPath = "workers/fee-converter/wrangler.toml";
const wrangler = "./node_modules/.bin/wrangler";
const binding = "RPC_URL_ROBINHOOD";
const reference = "https://rpc.mainnet.chain.robinhood.com";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const sourceSha = /^[a-f0-9]{40}$/u;
const blockHash = /^0x[a-f0-9]{64}$/u;
const quantity = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const rotationLabel = "; Robinhood RPC rotation from ";
const solanaRotationLabel = "; Solana RPC rotation from ";

type VersionLabel = {
  id: string;
  number: number;
  annotations?: Record<string, string>;
};
type Binding = { name: string; type: string; [field: string]: unknown };
type Version = VersionLabel & {
  resources?: {
    bindings?: Binding[];
    script?: { etag?: string };
    script_runtime?: Record<string, unknown>;
  };
};
type WorkerState = {
  active: {
    id: string;
    annotations?: Record<string, string>;
    versions: { version_id: string; percentage: number }[];
  };
  latest: VersionLabel;
};

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RotationError(message);
}
class RotationError extends Error {}

function rotationLineage(version: VersionLabel, label = rotationLabel): string {
  const message = version.annotations?.["workers/message"] ?? "";
  if (!message.includes(label)) return "";
  const lineage = message
    .slice(message.lastIndexOf(label) + label.length)
    .split(";")[0];
  check(uuid.test(lineage), "Invalid retained RPC rotation marker.");
  return lineage;
}
function inheritedRotationSuffix(version: VersionLabel): string {
  return [rotationLabel, solanaRotationLabel]
    .map((label) => {
      const lineage = rotationLineage(version, label);
      return lineage ? label + lineage : "";
    })
    .join("");
}
export function rotationMessage(
  sha: string,
  before: VersionLabel,
  kind: "robinhood" | "solana",
) {
  const changed = kind === "solana" ? solanaRotationLabel : rotationLabel;
  const retained = kind === "solana" ? rotationLabel : solanaRotationLabel;
  const lineage = rotationLineage(before, retained);
  return `slop.cash release ${sha}${lineage ? retained + lineage : ""}${changed}${before.id}`;
}

export function checkInheritedVersion(
  state: WorkerState,
  active: VersionLabel,
) {
  const latestLineage = inheritedRotationSuffix(state.latest);
  const activeLineage = inheritedRotationSuffix(active);
  check(
    state.latest.id === active.id || latestLineage === activeLineage,
    "The latest fee-converter upload has a different Robinhood RPC rotation. Reconcile it before publishing.",
  );
  return rotationLineage(active);
}

export function requireRotationBase(
  state: WorkerState,
  expectedVersion: string,
  latestVersion = expectedVersion,
  deploymentId?: string,
) {
  check(
    state.active.versions.length === 1 &&
      state.active.versions[0].version_id === expectedVersion &&
      state.active.versions[0].percentage === 100 &&
      state.latest.id === latestVersion &&
      (deploymentId === undefined || state.active.id === deploymentId),
    "The pinned fee-converter deployment or latest upload changed.",
  );
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  }
  return value;
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

function normalizedBindings(
  version: Version,
  changedSecrets: readonly string[] = [],
) {
  const bindings = version.resources?.bindings;
  check(
    Array.isArray(bindings) &&
      bindings.every(
        (entry) =>
          typeof entry.name === "string" && typeof entry.type === "string",
      ) &&
      new Set(bindings.map((entry) => entry.name)).size === bindings.length &&
      bindings.some(
        (entry) => entry.name === binding && entry.type === "secret_text",
      ) &&
      bindings.some(
        (entry) => entry.name === "FEE_DB" && entry.type === "d1",
      ) &&
      ["FEE_CONVERTER_MODE", "BUYBACK_MODE"].every((name) =>
        bindings.some(
          (entry) =>
            entry.name === name &&
            entry.type === "plain_text" &&
            entry.text === "live",
        ),
      ),
    "The active fee-converter binding inventory did not match the live program.",
  );
  return bindings
    .filter((entry) => !changedSecrets.includes(entry.name))
    .map((entry) =>
      entry.type.startsWith("secret_")
        ? { name: entry.name, type: entry.type }
        : entry,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function requireSameWorker(
  before: Version,
  after: Version,
  sha: string,
  kind: "robinhood" | "solana" = "robinhood",
) {
  const changedSecrets =
    kind === "solana" ? ["RPC_URL_SOLANA", "SOLANA_RECOVERY_RPC_URL"] : [];
  const label = kind === "solana" ? solanaRotationLabel : rotationLabel;
  check(
    Number.isSafeInteger(before.number) &&
      before.number > 0 &&
      Number.isSafeInteger(after.number) &&
      after.number === before.number + 1,
    "The candidate is not the immediate successor of the pinned fee-converter version.",
  );
  const original = before.resources;
  const uploaded = after.resources;
  check(
    after.annotations?.["workers/tag"] === sha &&
      rotationLineage(after, label) === before.id &&
      rotationLineage(
        after,
        kind === "solana" ? rotationLabel : solanaRotationLabel,
      ) ===
        rotationLineage(
          before,
          kind === "solana" ? rotationLabel : solanaRotationLabel,
        ) &&
      (kind !== "solana" ||
        changedSecrets.every((name) =>
          after.resources?.bindings?.some(
            (entry) => entry.name === name && entry.type === "secret_text",
          ),
        )) &&
      typeof original?.script?.etag === "string" &&
      original.script.etag.length > 0 &&
      original.script.etag === uploaded?.script?.etag &&
      original.script_runtime &&
      same(original.script_runtime, uploaded.script_runtime) &&
      same(
        normalizedBindings(before, changedSecrets),
        normalizedBindings(after, changedSecrets),
      ),
    "The uploaded fee-converter code, runtime or bindings differ from the pinned version.",
  );
}

export function secureRpcUrl(value: string | undefined) {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new RotationError(
      "Supply the protected Robinhood RPC environment secret as an HTTPS URL.",
    );
  }
  check(
    value === value?.trim() &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.origin !== reference,
    "The candidate must use TLS and be independent of the public reference.",
  );
  return url.href;
}

export async function qualifyRpc(
  url: string,
  vars: Parameters<typeof parseConfig>[0],
  rpcFetch: typeof fetch = fetch,
) {
  const converter = parseConfig({ ...vars, RPC_URL_ROBINHOOD: url });
  const buyback = parseBuybackConfig(vars, converter.mode);
  const config = converter.networks.find(
    (entry) => entry.network === "robinhood",
  );
  check(
    converter.mode === "live" &&
      buyback.mode === "live" &&
      config &&
      buyback.limits,
    "The reviewed production buyback configuration is unavailable.",
  );
  const market = createEvmClient({
    config,
    limits: converter.limits,
    kyberClientId: converter.kyberClientId,
    buyback: { limits: buyback.limits, receiver: config.feeWallet },
    fetch: rpcFetch,
  }).buyback?.market;
  const observed = await market?.observeFinalizedRpc?.();
  check(
    observed?.status === "verified" &&
      observed.chainId === 4663 &&
      /^(0|[1-9][0-9]*)$/u.test(observed.blockNumber) &&
      blockHash.test(observed.blockHash),
    "The candidate failed the finalized Robinhood contract read.",
  );

  const signal = AbortSignal.timeout(5_000);
  async function read(method: string, params: unknown[]) {
    const response = await rpcFetch(reference, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal,
    });
    const body = await response.json();
    check(
      response.ok && body?.jsonrpc === "2.0" && body.id === 1 && !body.error,
      "The independent Robinhood RPC did not verify the candidate block.",
    );
    return body.result;
  }
  const number = BigInt(observed.blockNumber);
  const [chain, finalized, canonical] = await Promise.all([
    read("eth_chainId", []),
    read("eth_getBlockByNumber", ["finalized", false]),
    read("eth_getBlockByNumber", [`0x${number.toString(16)}`, false]),
  ]);
  check(
    chain === "0x1237" &&
      typeof finalized?.number === "string" &&
      quantity.test(finalized.number) &&
      blockHash.test(finalized.hash ?? "") &&
      BigInt(finalized.number) >= number &&
      (BigInt(finalized.number) !== number ||
        finalized.hash === observed.blockHash) &&
      canonical?.number === `0x${number.toString(16)}` &&
      canonical.hash === observed.blockHash,
    "The independent Robinhood RPC did not verify the candidate block.",
  );
  return observed;
}

export function cloudflare() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  check(
    /^[a-f0-9]{32}$/u.test(account ?? "") && token,
    "Production Cloudflare credentials are unavailable.",
  );
  return async (path: string) => {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}/${path}`,
      {
        redirect: "error",
        cache: "no-store",
        headers: {
          authorization: `Bearer ${token}`,
          "cache-control": "no-cache",
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
    const body = await response.json();
    check(
      response.ok && body?.success === true,
      "Fee-converter version metadata is unavailable.",
    );
    return body.result;
  };
}

export async function inspectVersion(
  get: ReturnType<typeof cloudflare>,
  id: string,
): Promise<Version> {
  const version = await get(`versions/${id}`);
  check(
    version?.id === id,
    "Fee-converter version metadata returned a different ID.",
  );
  return version;
}

export async function workerState(
  get: ReturnType<typeof cloudflare>,
): Promise<WorkerState> {
  const [{ deployments }, { items }] = await Promise.all([
    get("deployments"),
    get("versions"),
  ]);
  const active = deployments?.[0];
  check(
    uuid.test(active?.id ?? "") &&
      Array.isArray(active.versions) &&
      active.versions.length > 0 &&
      active.versions.every(
        (entry: WorkerState["active"]["versions"][number]) =>
          uuid.test(entry.version_id) && Number.isFinite(entry.percentage),
      ) &&
      Array.isArray(items) &&
      items.length > 0 &&
      items.every(
        (entry: VersionLabel) =>
          uuid.test(entry.id) &&
          Number.isSafeInteger(entry.number) &&
          entry.number > 0,
      ),
    "Fee-converter deployment or upload history is unavailable.",
  );
  const latest = (items as VersionLabel[]).reduce((a, b) =>
    a.number > b.number ? a : b,
  );
  return { active, latest };
}

export const unresolvedFeeWork = `SELECT
  (SELECT COUNT(*) FROM fee_conversions
    WHERE mode = 'live' AND (state IN ('submitted', 'unknown')
      OR (approval_tx_id IS NOT NULL AND raw_tx IS NULL AND tx_id IS NULL))) AS openSends,
  (SELECT COUNT(*) FROM fee_conversions c
    WHERE c.mode = 'live' AND c.kind = 'bridge' AND c.state = 'finalized'
      AND NOT EXISTS (SELECT 1 FROM fee_bridge_outcomes o WHERE o.bridge_id = c.id)) AS openBridgeOrders,
  (SELECT COUNT(*) FROM fee_native_gas
    WHERE network = 'robinhood' AND state = 'signed' AND actual_wei IS NULL) AS openRobinhoodGas`;

export function requireQuietJournal(response: {
  success?: boolean;
  result?: { success?: boolean; results?: Record<string, unknown>[] }[];
}) {
  const results = response?.result?.[0]?.results;
  const row = results?.[0];
  const counts = [row?.openSends, row?.openBridgeOrders, row?.openRobinhoodGas];
  check(
    response?.success === true &&
      response.result?.length === 1 &&
      response.result[0].success === true &&
      results?.length === 1 &&
      counts.every(
        (count) => Number.isSafeInteger(count) && Number(count) >= 0,
      ),
    "Could not verify the bound fee-converter journal.",
  );
  check(
    counts.every((count) => count === 0),
    "The fee-converter journal has unresolved sends, bridge orders or Robinhood gas. Review recovery before rotating.",
  );
}

export const unresolvedSolanaWork = `SELECT
  (SELECT COUNT(*) FROM fee_conversions c WHERE c.network='solana' AND c.mode='live'
    AND (c.state IN ('submitted','unknown') OR
      (c.kind='bridge' AND c.state='finalized' AND NOT EXISTS(SELECT 1 FROM fee_bridge_outcomes o WHERE o.bridge_id=c.id)))) AS openSends,
  (SELECT COUNT(*) FROM fee_native_gas WHERE network='solana'
    AND (state='reserved' OR (state='signed' AND actual_wei IS NULL))) AS openGas,
  (SELECT COUNT(*) FROM fee_converter_locks WHERE network='solana' AND expires_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS activeLocks`;
export function requireQuietSolanaJournal(response: {
  success?: boolean;
  result?: { success?: boolean; results?: Record<string, unknown>[] }[];
}) {
  const row = response.result?.[0]?.results?.[0];
  const counts = [row?.openSends, row?.openGas, row?.activeLocks];
  check(
    response.success === true &&
      response.result?.length === 1 &&
      response.result[0].success === true &&
      response.result[0].results?.length === 1 &&
      counts.every(
        (value) => Number.isSafeInteger(value) && Number(value) >= 0,
      ),
    "Could not verify the Solana fee journal.",
  );
  check(
    counts.every((value) => value === 0),
    "Solana has unresolved fee sends, gas reservations or an active lease. Reconcile before changing RPC bindings.",
  );
}

async function checkJournal(
  version: Version,
  databaseId: string,
  solana = false,
) {
  const database = version.resources?.bindings?.find(
    (entry) => entry.name === "FEE_DB",
  );
  check(
    uuid.test(databaseId) &&
      database?.type === "d1" &&
      (database.database_id ?? database.id) === databaseId,
    "The active fee-converter D1 binding differs from the reviewed database.",
  );
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sql: solana ? unresolvedSolanaWork : unresolvedFeeWork,
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  check(response.ok, "Could not verify the bound fee-converter journal.");
  if (solana) requireQuietSolanaJournal(await response.json());
  else requireQuietJournal(await response.json());
}

export function requireLiveMain(sha: string) {
  const main = execFileSync(
    "git",
    [
      "ls-remote",
      "--exit-code",
      "--refs",
      "https://github.com/SlopDotCash/slopdotcash.git",
      "refs/heads/main",
    ],
    { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "pipe"] },
  );
  check(
    main.trim() === `${sha}\trefs/heads/main`,
    "Main advanced before the fee-converter rotation.",
  );
}

export function runWrangler(args: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WRANGLER_LOG: "log",
    WRANGLER_WRITE_LOGS: "false",
    WRANGLER_LOG_SANITIZE: "true",
    WRANGLER_SEND_METRICS: "false",
  };
  delete env.SLOP_ROBINHOOD_RPC_REPLACEMENT;
  return execFileSync(wrangler, args, {
    env,
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function main() {
  const mode = process.argv[2];
  const sha = process.env.GITHUB_SHA ?? "";
  check(
    sourceSha.test(sha) &&
      process.env.GITHUB_REF === "refs/heads/main" &&
      process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
    "The fee-converter release requires trusted main and verified TLS.",
  );
  const get = cloudflare();
  if (mode === "inherit") {
    const state = await workerState(get);
    const ids = state.active.versions.map((entry) => entry.version_id);
    const [latest, ...active] = await Promise.all(
      [state.latest.id, ...ids].map((id) => inspectVersion(get, id)),
    );
    const lineages = active.map((version) => {
      checkInheritedVersion({ ...state, latest }, version);
      return inheritedRotationSuffix(version);
    });
    check(
      new Set(lineages).size === 1,
      "Active fee-converter versions have different RPC rotations.",
    );
    const suffix = inheritedRotationSuffix(active[0]);
    console.log(`slop.cash release ${sha}${suffix}`);
    return;
  }
  const solana = mode === "rotate-solana";
  const expectedVersion =
    (solana
      ? process.env.SLOP_SOLANA_RPC_EXPECTED_VERSION
      : process.env.SLOP_ROBINHOOD_RPC_EXPECTED_VERSION) ?? "";
  check(
    (mode === "rotate" || solana) &&
      process.env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      process.env.SLOP_FEE_CONVERTER_RELEASE === "enabled" &&
      uuid.test(expectedVersion),
    "Use manual main rotation with the expected active version and the fee-converter release enabled.",
  );
  const output = process.env.GITHUB_STEP_SUMMARY ?? "";
  const runnerTemp = process.env.RUNNER_TEMP ?? "";
  check(
    isAbsolute(output) && isAbsolute(runnerTemp),
    "The protected release runner and summary paths are unavailable.",
  );
  const url = solana
    ? null
    : secureRpcUrl(process.env.SLOP_ROBINHOOD_RPC_REPLACEMENT);
  delete process.env.SLOP_ROBINHOOD_RPC_REPLACEMENT;
  const state = await workerState(get);
  requireRotationBase(state, expectedVersion);
  const before = await inspectVersion(get, expectedVersion);
  const description = `slop.cash release ${sha}`;
  check(
    before.annotations?.["workers/tag"] === sha &&
      state.active.annotations?.["workers/message"] === description,
    "First publish this main revision without a rotation input.",
  );
  normalizedBindings(before);
  const config = Bun.TOML.parse(await Bun.file(configPath).text()) as {
    d1_databases?: { binding: string; database_id: string }[];
    vars?: Parameters<typeof parseConfig>[0];
  };
  const database =
    config.d1_databases?.find((entry) => entry.binding === "FEE_DB")
      ?.database_id ?? "";
  if (solana) {
    const networks = parseConfig(config.vars ?? {}).networks.map(
      (entry) => entry.network,
    );
    check(
      !networks.includes("solana") &&
        before.resources?.bindings?.some(
          (entry) =>
            entry.name === "FEE_CONVERTER_NETWORKS" &&
            entry.type === "plain_text" &&
            entry.text === networks.join(","),
        ),
      "Solana must remain disabled while its RPC bindings are qualified.",
    );
    check(
      before.resources?.bindings?.some(
        (entry) =>
          entry.name === "FEE_WALLET_KEY_SOLANA" &&
          entry.type === "secret_text",
      ),
      "The existing Solana fee key is unavailable.",
    );
  }
  await checkJournal(before, database, solana);
  if (solana) await qualifySolanaRpcPair(runnerTemp);
  else {
    check(url !== null, "Robinhood candidate URL unavailable");
    const observed = await qualifyRpc(url, config.vars ?? {});
    console.log(
      JSON.stringify({
        event: "robinhood_rpc_candidate_verified",
        ...observed,
      }),
    );
  }

  const temporary = mkdtempSync(join(runnerTemp, "slop-robinhood-rpc-"));
  try {
    const secrets = join(temporary, "secrets.json");
    const promotionConfig = join(temporary, "wrangler.json");
    // A versions deploy may synchronize non-versioned settings from its config.
    // Use only the Worker name so this endpoint rotation leaves them untouched.
    writeFileSync(promotionConfig, JSON.stringify({ name: worker }), {
      mode: 0o600,
      flag: "wx",
    });
    requireRotationBase(
      await workerState(get),
      expectedVersion,
      expectedVersion,
      state.active.id,
    );
    requireLiveMain(sha);
    writeFileSync(
      secrets,
      JSON.stringify(
        solana
          ? {
              RPC_URL_SOLANA: SOLANA_PUBLIC_PAIR[0],
              SOLANA_RECOVERY_RPC_URL: SOLANA_PUBLIC_PAIR[1],
            }
          : { [binding]: url },
      ),
      {
        mode: 0o600,
        flag: "wx",
      },
    );
    const upload = runWrangler([
      "versions",
      "upload",
      "--config",
      configPath,
      `--secrets-file=${secrets}`,
      `--tag=${sha}`,
      `--message=${rotationMessage(sha, before, solana ? "solana" : "robinhood")}`,
    ]);
    rmSync(secrets);
    const ids = [
      ...upload.matchAll(/^Worker Version ID:\s*([0-9a-f-]+)\s*$/gmu),
    ];
    const candidate = ids[0]?.[1] ?? "";
    check(
      ids.length === 1 && uuid.test(candidate) && candidate !== expectedVersion,
      "Could not bind a candidate fee-converter version.",
    );
    console.log(
      JSON.stringify({
        event: "robinhood_rpc_version_uploaded",
        source: sha,
        previousVersion: expectedVersion,
        candidate,
      }),
    );
    const after = await inspectVersion(get, candidate);
    requireSameWorker(before, after, sha, solana ? "solana" : "robinhood");
    await checkJournal(before, database, solana);
    requireRotationBase(
      await workerState(get),
      expectedVersion,
      candidate,
      state.active.id,
    );
    requireLiveMain(sha);
    runWrangler([
      "versions",
      "deploy",
      "--config",
      promotionConfig,
      "--name",
      worker,
      `--version-id=${candidate}`,
      "--percentage=100",
      `--message=${description}`,
      "--yes",
    ]);
    const [deployed, immutable] = await Promise.all([
      workerState(get),
      inspectVersion(get, candidate),
    ]);
    requireRotationBase(deployed, candidate);
    check(
      deployed.active.annotations?.["workers/message"] === description,
      "The active deployment source tag could not be verified after rotation.",
    );
    requireSameWorker(before, immutable, sha, solana ? "solana" : "robinhood");
    const summary = `Fee converter ${solana ? "Solana public-pair" : "Robinhood RPC"} rotation from ${expectedVersion} to ${candidate} at 100% on ${sha}.\n`;
    appendFileSync(output, summary);
    console.log(summary.trim());
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    // Never print RPC, Wrangler, or Cloudflare error bodies.
    console.error(
      error instanceof RotationError
        ? error.message
        : "Fee-converter RPC release check failed.",
    );
    process.exitCode = 1;
  });
}
