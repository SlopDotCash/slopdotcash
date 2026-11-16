/** Version-bound replacement of the qualified Solana RPC pair. No fee signing. */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { LOCK_MS } from "../workers/fee-converter/core";
import { requireSolanaProbeCandidate } from "./probe-fee-solana-rpc";
import {
  qualifySolanaRpcPair,
  SOLANA_PUBLIC_PAIR,
} from "./qualify-solana-rpc-pair";
import {
  cloudflare,
  inspectVersion,
  requireLiveMain,
  requireRotationBase,
  requireSameWorker,
  rotationMessage,
  runWrangler,
  workerState,
} from "./release-robinhood-rpc";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const sourceSha = /^[a-f0-9]{40}$/u;
const worker = "slop-fee-converter";
const configPath = "workers/fee-converter/wrangler.toml";
const leaseMs = LOCK_MS;
const pending = `(SELECT COUNT(*) FROM fee_conversions WHERE network='solana' AND mode='live' AND (state IN ('quoted','submitted','unknown') OR (approval_tx_id IS NOT NULL AND raw_tx IS NULL AND tx_id IS NULL) OR (kind='bridge' AND state='finalized' AND NOT EXISTS(SELECT 1 FROM fee_bridge_outcomes o WHERE o.bridge_id=fee_conversions.id))))`;
const gas = `(SELECT COUNT(*) FROM fee_native_gas WHERE network='solana' AND (state='reserved' OR (state='signed' AND actual_wei IS NULL)))`;
export const acquireRotationLeaseSql = `INSERT INTO fee_converter_locks(network,run_id,expires_at) SELECT 'solana',?,? WHERE ${pending}=0 AND ${gas}=0 ON CONFLICT(network) DO UPDATE SET run_id=excluded.run_id,expires_at=excluded.expires_at WHERE fee_converter_locks.expires_at < ?`;
export const renewRotationLeaseSql = `UPDATE fee_converter_locks SET expires_at=? WHERE network='solana' AND run_id=? AND expires_at>=? AND ${pending}=0 AND ${gas}=0`;
const releaseLeaseSql =
  "DELETE FROM fee_converter_locks WHERE network='solana' AND run_id=?";

function requireCondition(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}

/** Source-only workflow updates may preserve byte-identical deployed fee code. */
export async function verifyFeeSourceParity(
  deployedSource: string,
  checkout: string,
) {
  requireCondition(
    sourceSha.test(deployedSource) && sourceSha.test(checkout),
    "Invalid fee source pin",
  );
  try {
    execFileSync("git", ["cat-file", "-e", `${deployedSource}^{commit}`], {
      stdio: "ignore",
    });
  } catch {
    execFileSync(
      "git",
      [
        "fetch",
        "--no-tags",
        "--depth=1",
        "https://github.com/SlopDotCash/slopdotcash.git",
        deployedSource,
      ],
      { stdio: "pipe", timeout: 30000 },
    );
  }
  const result = await build({
    entryPoints: ["workers/fee-converter/index.ts"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    metafile: true,
    external: ["node:*"],
  });
  const paths = [
    ...new Set([
      configPath,
      "package.json",
      "bun.lock",
      ...Object.keys(result.metafile.inputs).filter(
        (path) => !path.split("/").includes("node_modules"),
      ),
    ]),
  ].sort();
  requireCondition(
    paths.every(
      (path) => !path.startsWith("/") && !path.split("/").includes(".."),
    ),
    "Unbound fee source input",
  );
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", deployedSource, checkout, "--", ...paths],
    { encoding: "utf8" },
  );
  requireCondition(
    changed.trim() === "",
    "Deployed fee runtime differs from the reviewed checkout",
  );
  const dirty = execFileSync("git", ["status", "--porcelain", "--", ...paths], {
    encoding: "utf8",
  });
  requireCondition(
    dirty.trim() === "",
    "Fee runtime checkout has local changes",
  );
  return paths;
}

export async function rotateFeeSolanaRpc() {
  const sha = process.env.GITHUB_SHA ?? "";
  const expectedVersion = process.env.SLOP_SOLANA_RPC_EXPECTED_VERSION ?? "";
  const expectedSource = process.env.SLOP_SOLANA_RPC_EXPECTED_SOURCE ?? "";
  const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
  const candidateUrl = requireSolanaProbeCandidate(
    process.env.SLOP_SOLANA_RPC_CANDIDATE ?? "",
  );
  delete process.env.SLOP_SOLANA_RPC_CANDIDATE;
  requireCondition(
    process.env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      process.env.GITHUB_REF === "refs/heads/main" &&
      process.env.SLOP_FEE_CONVERTER_RELEASE === "enabled" &&
      sourceSha.test(sha) &&
      sourceSha.test(expectedSource) &&
      uuid.test(expectedVersion) &&
      /^[a-f0-9]{32}$/u.test(account) &&
      token &&
      process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
    "Solana RPC rotation requires protected manual main and exact active pins",
  );
  const root = process.env.RUNNER_TEMP;
  requireCondition(
    typeof root === "string" && root.startsWith("/"),
    "Protected runner output unavailable",
  );
  const get = cloudflare();
  const originalState = await workerState(get);
  requireRotationBase(originalState, expectedVersion);
  const before = await inspectVersion(get, expectedVersion);
  requireCondition(
    before.annotations?.["workers/tag"] === expectedSource,
    "Active fee source differs from the reviewed pin",
  );
  const inputs = await verifyFeeSourceParity(expectedSource, sha);
  const database = before.resources?.bindings?.find(
    (entry) => entry.name === "FEE_DB",
  );
  const config = Bun.TOML.parse(readFileSync(configPath, "utf8")) as {
    d1_databases: { binding: string; database_id: string }[];
  };
  const databaseId = config.d1_databases.find(
    (entry) => entry.binding === "FEE_DB",
  )?.database_id;
  requireCondition(
    uuid.test(databaseId ?? "") &&
      database?.type === "d1" &&
      (database.database_id ?? database.id) === databaseId,
    "Active fee database differs from the reviewed binding",
  );
  requireCondition(
    before.resources?.bindings?.some(
      (entry) =>
        entry.name === "FEE_WALLET_KEY_SOLANA" && entry.type === "secret_text",
    ),
    "Existing Solana signer binding unavailable",
  );
  const directory = mkdtempSync(join(root, "fee-solana-rotation-"));
  const output = join(root, "fee-solana-rpc-rotation.json");
  const receipt: Record<string, unknown> = {
    schemaVersion: 1,
    checkout: sha,
    previousVersion: expectedVersion,
    deployedSource: expectedSource,
    phase: "qualification",
    sourceFiles: inputs.length,
  };
  const save = () => {
    const temporary = `${output}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
      mode: 0o600,
    });
    const file = openSync(temporary, "r");
    fsyncSync(file);
    closeSync(file);
    renameSync(temporary, output);
    const parent = openSync(root, "r");
    fsyncSync(parent);
    closeSync(parent);
  };
  save();
  try {
    await qualifySolanaRpcPair(directory, [
      candidateUrl,
      SOLANA_PUBLIC_PAIR[1],
    ]);
  } finally {
    // Retain complete or partial public history even when qualification fails.
    const proofPath = join(directory, "solana-rpc-public-pair-proof.json");
    if (existsSync(proofPath))
      writeFileSync(
        join(root, "solana-rpc-rotation-proof.json"),
        readFileSync(proofPath),
        { mode: 0o600 },
      );
  }
  receipt.proofSha256 = createHash("sha256")
    .update(readFileSync(join(root, "solana-rpc-rotation-proof.json")))
    .digest("hex");
  save();
  requireLiveMain(sha);
  requireRotationBase(
    await workerState(get),
    expectedVersion,
    expectedVersion,
    originalState.active.id,
  );

  async function query(sql: string, params: unknown[]) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${databaseId}/query`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const value = await response.json();
    requireCondition(
      response.ok &&
        value.success === true &&
        value.result?.length === 1 &&
        value.result[0].success === true,
      "Fee rotation database operation unavailable",
    );
    return value.result[0];
  }
  const runId = `rpc-rotation-${randomUUID()}`;
  const now = new Date();
  receipt.runId = runId;
  receipt.phase = "acquiring-lease";
  save();
  const acquired = await query(acquireRotationLeaseSql, [
    runId,
    new Date(now.getTime() + leaseMs).toISOString(),
    now.toISOString(),
  ]);
  requireCondition(
    acquired.meta?.changes === 1,
    "Solana fee activity prevents RPC rotation",
  );
  let uncertainDeploy = false;
  const renew = async () => {
    const at = new Date();
    const result = await query(renewRotationLeaseSql, [
      new Date(at.getTime() + leaseMs).toISOString(),
      runId,
      at.toISOString(),
    ]);
    requireCondition(
      result.meta?.changes === 1,
      "Solana rotation lease or quiet journal changed",
    );
  };
  try {
    receipt.phase = "leased";
    save();
    await renew();
    requireLiveMain(sha);
    requireRotationBase(
      await workerState(get),
      expectedVersion,
      expectedVersion,
      originalState.active.id,
    );
    const secrets = join(directory, "secrets.json");
    writeFileSync(
      secrets,
      JSON.stringify({
        RPC_URL_SOLANA: candidateUrl,
        SOLANA_RECOVERY_RPC_URL: SOLANA_PUBLIC_PAIR[1],
      }),
      { mode: 0o600, flag: "wx" },
    );
    let uploaded: string;
    try {
      uploaded = runWrangler([
        "versions",
        "upload",
        "--config",
        configPath,
        `--secrets-file=${secrets}`,
        `--tag=${sha}`,
        `--message=${rotationMessage(sha, before, "solana")}`,
      ]);
    } finally {
      rmSync(secrets, { force: true });
    }
    const ids = [
      ...uploaded.matchAll(/^Worker Version ID:\s*([0-9a-f-]+)\s*$/gmu),
    ];
    const candidate = ids[0]?.[1] ?? "";
    requireCondition(
      ids.length === 1 && uuid.test(candidate),
      "Candidate fee version unavailable",
    );
    receipt.candidateVersion = candidate;
    receipt.phase = "uploaded";
    save();
    requireSameWorker(
      before,
      await inspectVersion(get, candidate),
      sha,
      "solana",
    );
    await renew();
    requireRotationBase(
      await workerState(get),
      expectedVersion,
      candidate,
      originalState.active.id,
    );
    requireLiveMain(sha);
    const deploymentConfig = join(directory, "wrangler.json");
    writeFileSync(deploymentConfig, JSON.stringify({ name: worker }), {
      mode: 0o600,
      flag: "wx",
    });
    receipt.phase = "deploying";
    save();
    uncertainDeploy = true;
    runWrangler([
      "versions",
      "deploy",
      "--config",
      deploymentConfig,
      "--name",
      worker,
      `--version-id=${candidate}`,
      "--percentage=100",
      `--message=slop.cash release ${sha}`,
      "--yes",
    ]);
    requireRotationBase(await workerState(get), candidate);
    requireSameWorker(
      before,
      await inspectVersion(get, candidate),
      sha,
      "solana",
    );
    await renew();
    receipt.phase = "verified";
    receipt.verifiedAt = new Date().toISOString();
    save();
    uncertainDeploy = false;
    console.log(JSON.stringify(receipt));
  } finally {
    // An uncertain activation retains its lease until expiry for reconciliation.
    try {
      if (!uncertainDeploy) await query(releaseLeaseSql, [runId]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  rotateFeeSolanaRpc().catch(() => {
    console.error(
      "Solana fee RPC rotation refused; review the safe phase receipt",
    );
    process.exitCode = 1;
  });
}
