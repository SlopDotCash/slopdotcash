/** Read-only production metadata inspection. Secret values are never returned. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const worker = "slop-fee-converter";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
type Binding = { name: string; type: string; text?: unknown };
type Deployment = {
  id: string;
  versions: { version_id: string; percentage: number }[];
};
type Version = {
  id: string;
  annotations?: Record<string, string>;
  resources?: { bindings?: Binding[] };
};

function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export async function inspectFeeWorkerBindings(
  accountId: string,
  token: string,
  expected: Record<string, string>,
  checkedSource: string,
  request: typeof fetch = fetch,
) {
  requireThat(
    /^[a-f0-9]{32}$/u.test(accountId) && token,
    "Production credentials unavailable",
  );
  requireThat(/^[a-f0-9]{40}$/u.test(checkedSource), "Invalid checked source");
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${worker}`;
  async function get(path: string) {
    const response = await request(`${base}/${path}`, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: {
        authorization: `Bearer ${token}`,
        "cache-control": "no-cache",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json()) as {
      success?: boolean;
      result?: unknown;
    };
    requireThat(
      response.ok && body.success === true,
      "Production metadata unavailable",
    );
    return body.result;
  }
  function active(value: unknown): Deployment {
    const deployment = (value as { deployments?: Deployment[] })
      ?.deployments?.[0];
    requireThat(
      deployment &&
        uuid.test(deployment.id) &&
        deployment.versions?.length === 1 &&
        uuid.test(deployment.versions[0].version_id) &&
        deployment.versions[0].percentage === 100,
      "Production deployment is not pinned to one active version",
    );
    return deployment;
  }
  const before = active(await get("deployments"));
  const version = (await get(
    `versions/${before.versions[0].version_id}`,
  )) as Version;
  requireThat(
    version?.id === before.versions[0].version_id,
    "Version identity mismatch",
  );
  const bindings = version.resources?.bindings;
  requireThat(
    Array.isArray(bindings) &&
      bindings.every(
        (binding) =>
          /^[A-Z][A-Z0-9_]*$/u.test(binding.name) &&
          typeof binding.type === "string",
      ) &&
      new Set(bindings.map((binding) => binding.name)).size === bindings.length,
    "Invalid binding inventory",
  );
  const after = active(await get("deployments"));
  requireThat(
    JSON.stringify(before) === JSON.stringify(after),
    "Deployment changed during inspection",
  );
  const secretNames = bindings
    .filter((binding) => binding.type.startsWith("secret_"))
    .map((binding) => binding.name)
    .sort();
  const bindingNames = new Set(bindings.map((binding) => binding.name));
  const plaintext = new Map(
    bindings
      .filter((binding) => binding.type === "plain_text")
      .map((binding) => [binding.name, binding.text]),
  );
  const settings = Object.entries(expected)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({
      name,
      expected: value,
      present: plaintext.has(name),
      matchesReviewedConfiguration: plaintext.get(name) === value,
    }));
  const sourceCommit = version.annotations?.["workers/tag"];
  requireThat(
    /^[a-f0-9]{40}$/u.test(sourceCommit ?? ""),
    "Missing source commit tag",
  );
  return {
    schemaVersion: 1,
    worker,
    deploymentId: before.id,
    versionId: version.id,
    sourceCommit,
    checkedSource,
    sourceMatchesCheckout: sourceCommit === checkedSource,
    secretNames,
    settings,
    solanaPrimary: bindingNames.has("RPC_URL_SOLANA")
      ? "opaque-secret-binding"
      : sourceCommit === checkedSource
        ? "solana-public-default"
        : "binding-absent-source-not-matched",
    solanaRecovery: bindingNames.has("SOLANA_RECOVERY_RPC_URL")
      ? "opaque-secret-binding"
      : sourceCommit === checkedSource
        ? "allnodes-publicnode-default"
        : "binding-absent-source-not-matched",
    solanaKeyPresent: secretNames.includes("FEE_WALLET_KEY_SOLANA"),
    limitations: [
      "Secret names do not prove their values, operator identity or key/address match.",
      "Metadata inspection does not qualify runtime RPC recovery or activate processing.",
    ],
  };
}

if (import.meta.main) {
  try {
    requireThat(
      process.env.GITHUB_REF === "refs/heads/main",
      "Inspect only from main",
    );
    const config = Bun.TOML.parse(
      readFileSync("workers/fee-converter/wrangler.toml", "utf8"),
    ) as { vars: Record<string, string> };
    const expected = Object.fromEntries(
      Object.entries(config.vars).filter(([name]) =>
        /^(?:FEE_CONVERTER_|FEE_WALLET_|BUYBACK_)/u.test(name),
      ),
    );
    const report = await inspectFeeWorkerBindings(
      process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
      process.env.CLOUDFLARE_API_TOKEN ?? "",
      expected,
      process.env.GITHUB_SHA ?? "",
    );
    requireThat(
      process.env.RUNNER_TEMP,
      "Runner temporary directory unavailable",
    );
    writeFileSync(
      join(process.env.RUNNER_TEMP, "fee-worker-bindings.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      { mode: 0o600 },
    );
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch {
    process.stderr.write(
      "Fee-worker metadata inspection failed. No configuration was changed.\n",
    );
    process.exitCode = 1;
  }
}
