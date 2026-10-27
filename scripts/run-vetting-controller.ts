/** Protected scheduled entry point. Source bytes and model output never enter job logs. */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { d1PublicationJournal } from "../workers/vetting/publication-journal";
import { runScanPass, serviceConfigFrom } from "../workers/vetting/run";
import type { ScannerProfile } from "../workers/vetting/scanners";
import { signedServiceHeaders } from "../workers/vetting/service";

/** Fixed step names only: the failure report never carries an error message. */
let stage = "checkout";

async function main() {
  const env = process.env;
  const branch = env.GITHUB_REF;
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    !["refs/heads/main", "refs/heads/development"].includes(branch ?? "") ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") ||
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !==
      env.GITHUB_SHA
  )
    throw new Error(
      "The protected branch's exact workflow checkout is required",
    );
  stage = "journal";
  if (!env.GITHUB_TOKEN)
    throw new Error("The workflow read-only GitHub credential is required");
  const production = branch === "refs/heads/main";
  const origin = production ? "https://slop.cash" : "https://staging.slop.cash";
  const wrangler = Bun.TOML.parse(
    await readFile(
      production ? "wrangler.toml" : "wrangler.staging.toml",
      "utf8",
    ),
  ) as {
    d1_databases: { binding: string; database_id: string }[];
  };
  const database = wrangler.d1_databases.filter((d) => d.binding === "SLOP_DB");
  if (database.length !== 1) throw new Error("Ambiguous scanner database");
  const journal = d1PublicationJournal({
    accountId: env.CLOUDFLARE_ACCOUNT_ID ?? "",
    databaseId: database[0].database_id,
    token: env.CLOUDFLARE_API_TOKEN ?? "",
  });
  // Check schema and access before acquiring source or spending model tokens.
  await journal.has("controller-readiness");
  stage = "rate-cards";
  const rates = JSON.parse(env.VETTING_RATE_CARDS ?? "null") as {
    primary: ScannerProfile["rateCard"];
    specialist: ScannerProfile["rateCard"];
  };
  for (const card of [rates?.primary, rates?.specialist]) {
    for (const key of [
      "uncachedInputNanoUsdPerToken",
      "cachedInputNanoUsdPerToken",
      "cacheCreationNanoUsdPerToken",
      "outputNanoUsdPerToken",
    ] as const) {
      if (!/^[0-9]{1,12}$/.test(card?.[key] ?? ""))
        throw new Error("Verified rate cards are required");
    }
  }
  const root = await mkdtemp(join(tmpdir(), "slop-vetting-controller-"));
  try {
    const configPath = join(root, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        origin,
        policyVersion: "slop-bounded-2026-10-24",
        workDirectory: join(root, "work"),
        journalDirectory: join(root, "unused-local-journal"),
        primary: {
          reviewer: "opus",
          transport: "anthropic-messages",
          endpoint: "https://api.surplusintelligence.ai/anthropic/v1/messages",
          model: "claude-opus-5.5",
          maxOutputTokens: 8192,
          rateCard: rates.primary,
        },
        specialist: {
          reviewer: "astra",
          transport: "openai-responses",
          endpoint: "https://api.surplusintelligence.ai/v1/responses",
          model: "gpt-6.1-sol",
          maxOutputTokens: 8192,
          rateCard: rates.specialist,
        },
      }),
      { mode: 0o600 },
    );
    stage = "scanner-config";
    const config = await serviceConfigFrom(configPath, env);
    config.journal = journal;
    stage = "bridge";
    const path = "/api/v1/vetting/sandbox";
    const response = await fetch(`${origin}${path}`, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: await signedServiceHeaders({
        signer: config.connection,
        method: "GET",
        pathAndQuery: path,
        body: new Uint8Array(),
      }),
    });
    if (!response.ok) throw new Error("Deployed scanner bridge is unavailable");
    const health = (await response.json()) as {
      ok?: boolean;
      revision?: string;
      imageSha256?: string;
    };
    stage = "runner-revision";
    if (health.revision !== env.GITHUB_SHA) {
      // Commit IDs are public. Name both so the operator knows to wait for
      // the release of this checkout, then dispatch again.
      const deployed = /^[a-f0-9]{40}$/.test(health.revision ?? "")
        ? health.revision
        : "no valid revision";
      console.error(
        `The isolated runner reports ${deployed}; this checkout is ${env.GITHUB_SHA}. Dispatch again after the release of this checkout succeeds.`,
      );
    }
    if (
      health.ok !== true ||
      health.revision !== env.GITHUB_SHA ||
      !/^[a-f0-9]{64}$/.test(health.imageSha256 ?? "")
    )
      throw new Error("The matching isolated runner has not been deployed");
    stage = "scan";
    const report = await runScanPass(config);
    console.log(JSON.stringify(report));
    if (
      !report.refreshed ||
      report.assessments.some(
        (a) =>
          a.state === "retry" ||
          a.state === "journaled" ||
          a.outcome !== "accepted",
      )
    )
      process.exitCode = 1;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
await main().catch((error: unknown) => {
  const kind = error instanceof Error ? error.name : "NonError";
  console.error(
    `Scanner controller failed at step ${stage} (${kind}); no source, provider response or credentials are logged.`,
  );
  process.exitCode = 1;
});
