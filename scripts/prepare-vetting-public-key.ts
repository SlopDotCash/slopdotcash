/** Protected release tooling: only the scanner's public key enters Pages config. */
import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { sha256Hex } from "../backend/trace/validation";
import { vettingServiceSigner } from "../workers/vetting/service";

class PublicKeyPreparationError extends Error {}

export const SCANNER_PUBLIC_KEYS = "VETTING_RESULT_PUBLIC_KEYS";
export type PagesMetadata = {
  production_branch: string;
  deployment_configs: {
    production: { env_vars?: Record<string, { type: string; value?: string }> };
  };
};
export type PublicScannerKey = {
  schema: "slop-scanner-public-key-v1";
  target: "staging" | "production";
  sourceSha: string;
  publicKey: string;
  sha256: string;
};
const targets = {
  staging: {
    branch: "development",
    project: "slop-staging",
    origin: "https://staging.slop.cash",
  },
  production: {
    branch: "main",
    project: "eliza-computer",
    origin: "https://slop.cash",
  },
};
export async function publicScannerKey(
  raw: string | undefined,
  target: PublicScannerKey["target"],
  sourceSha: string,
): Promise<PublicScannerKey> {
  const signer = await vettingServiceSigner(raw);
  const bytes = new Uint8Array(
    await crypto.subtle.exportKey("raw", signer.publicKey),
  );
  return {
    schema: "slop-scanner-public-key-v1",
    target,
    sourceSha,
    publicKey: Buffer.from(bytes).toString("base64"),
    sha256: await sha256Hex(bytes),
  };
}
export type ScannerPagesConfig = {
  name?: string;
  vars?: Record<string, unknown>;
  env?: { preview?: { vars?: Record<string, unknown> } };
  [key: string]: unknown;
};
export function scannerPagesConfiguration(
  config: ScannerPagesConfig,
  remote: PagesMetadata,
  key: PublicScannerKey,
) {
  const target = targets[key.target];
  if (
    remote.production_branch !== target.branch ||
    config.name !== target.project ||
    config.vars?.PUBLIC_SITE_URL !== target.origin
  )
    throw new PublicKeyPreparationError(
      "Scanner Pages environment does not match",
    );
  const variables = remote.deployment_configs.production.env_vars ?? {};
  const existing = variables[SCANNER_PUBLIC_KEYS];
  if (
    existing &&
    (existing.type !== "plain_text" || existing.value !== key.publicKey)
  )
    throw new PublicKeyPreparationError(
      "Existing scanner public keys differ; rotation is not authorized",
    );
  if (
    config.vars?.[SCANNER_PUBLIC_KEYS] !== undefined &&
    config.vars[SCANNER_PUBLIC_KEYS] !== key.publicKey
  )
    throw new PublicKeyPreparationError("Source scanner public keys differ");
  if (config.env?.preview?.vars?.[SCANNER_PUBLIC_KEYS] !== undefined)
    throw new PublicKeyPreparationError(
      "Scanner key must not enter preview configuration",
    );
  const plain = Object.fromEntries(
    Object.entries(variables)
      .filter(([, v]) => v.type === "plain_text")
      .map(([name, v]) => {
        if (typeof v.value !== "string")
          throw new PublicKeyPreparationError(
            "Pages plaintext configuration is invalid",
          );
        return [name, v.value];
      }),
  );
  return {
    ...config,
    vars: { ...plain, ...config.vars, [SCANNER_PUBLIC_KEYS]: key.publicKey },
  };
}
export function verifyScannerPublicKey(
  remote: PagesMetadata,
  key: PublicScannerKey,
) {
  const value =
    remote.deployment_configs.production.env_vars?.[SCANNER_PUBLIC_KEYS];
  if (
    remote.production_branch !== targets[key.target].branch ||
    value?.type !== "plain_text" ||
    value.value !== key.publicKey
  )
    throw new PublicKeyPreparationError(
      "Pages scanner public key readback does not match",
    );
}
export async function pagesMetadata(
  target: PublicScannerKey["target"],
  env = process.env,
): Promise<PagesMetadata> {
  const account = env.CLOUDFLARE_ACCOUNT_ID,
    token = env.CLOUDFLARE_API_TOKEN;
  if (!/^[a-f0-9]{32}$/.test(account ?? "") || !token)
    throw new PublicKeyPreparationError(
      "Protected Cloudflare configuration is required",
    );
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${targets[target].project}`,
    {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok)
    throw new PublicKeyPreparationError(
      "Pages configuration could not be read",
    );
  const body = (await response.json()) as {
    success?: boolean;
    result?: PagesMetadata;
  };
  if (body.success !== true || !body.result?.deployment_configs?.production)
    throw new PublicKeyPreparationError("Pages configuration is unavailable");
  return body.result;
}
function release(target: string) {
  if (!(target in targets))
    throw new PublicKeyPreparationError("Unknown scanner environment");
  const chosen = targets[target as PublicScannerKey["target"]];
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY !== "SlopDotCash/slopdotcash" ||
    process.env.GITHUB_REF !== `refs/heads/${chosen.branch}` ||
    !["push", "workflow_dispatch"].includes(
      process.env.GITHUB_EVENT_NAME ?? "",
    ) ||
    process.env.GITHUB_WORKFLOW_REF !==
      `SlopDotCash/slopdotcash/.github/workflows/deploy.yml@refs/heads/${chosen.branch}` ||
    !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? "") ||
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !==
      process.env.GITHUB_SHA
  )
    throw new PublicKeyPreparationError(
      "The exact protected Pages release is required",
    );
}
function temporary(path: string) {
  const root = process.env.RUNNER_TEMP;
  if (!root || !resolve(path).startsWith(`${resolve(root)}${sep}`))
    throw new PublicKeyPreparationError(
      "Output must stay in the release temporary directory",
    );
  return resolve(path);
}
async function main() {
  const [mode, target, keyFile, configFile] = process.argv.slice(2);
  release(target);
  const path = temporary(keyFile);
  if (mode === "derive") {
    const key = await publicScannerKey(
      process.env.SLOP_VETTING_SIGNING_JWK,
      target as PublicScannerKey["target"],
      process.env.GITHUB_SHA ?? "",
    );
    await writeFile(path, `${JSON.stringify(key)}\n`, { mode: 0o600 });
    console.log(
      JSON.stringify({
        scannerPublicKeySha256: key.sha256,
        target,
        sourceSha: key.sourceSha,
      }),
    );
    return;
  }
  const key = JSON.parse(await readFile(path, "utf8")) as PublicScannerKey;
  const raw = Buffer.from(key.publicKey, "base64");
  if (
    key.schema !== "slop-scanner-public-key-v1" ||
    key.target !== target ||
    key.sourceSha !== process.env.GITHUB_SHA ||
    raw.length !== 32 ||
    raw.toString("base64") !== key.publicKey ||
    (await sha256Hex(raw)) !== key.sha256
  )
    throw new PublicKeyPreparationError(
      "Derived public key metadata does not match this release",
    );
  const remote = await pagesMetadata(key.target);
  if (mode === "verify") {
    verifyScannerPublicKey(remote, key);
    const expected = JSON.parse(
      await readFile(temporary(configFile), "utf8"),
    ) as ScannerPagesConfig;
    for (const [name, value] of Object.entries(expected.vars ?? {})) {
      const actual = remote.deployment_configs.production.env_vars?.[name];
      if (actual?.type !== "plain_text" || actual.value !== String(value))
        throw new PublicKeyPreparationError(
          "Pages plaintext configuration readback differs",
        );
    }
    return;
  }
  if (mode !== "assemble")
    throw new PublicKeyPreparationError("Unknown scanner preparation command");
  const configPath = temporary(configFile);
  if (!configPath.endsWith(`${sep}wrangler.toml`))
    throw new PublicKeyPreparationError(
      "A copied standard Pages config is required",
    );
  const config = Bun.TOML.parse(
    await readFile(configPath, "utf8"),
  ) as ScannerPagesConfig;
  const assembled = scannerPagesConfiguration(config, remote, key);
  await writeFile(
    resolve(dirname(configPath), "wrangler.jsonc"),
    `${JSON.stringify(assembled, null, 2)}\n`,
    { mode: 0o600 },
  );
  await rm(configPath);
}
if (import.meta.main)
  await main().catch((error: unknown) => {
    console.error(
      error instanceof PublicKeyPreparationError
        ? error.message
        : "Scanner public-key preparation failed; private material is not logged.",
    );
    process.exitCode = 1;
  });
