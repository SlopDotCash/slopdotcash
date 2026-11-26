/** Protected scheduled entry point. Source bytes and model output never enter job logs. */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { servicePublicationJournal } from "../workers/vetting/publication-journal";
import { runScanPass, serviceConfigFrom } from "../workers/vetting/run";
import type { ScannerProfile } from "../workers/vetting/scanners";
import { signedServiceHeaders } from "../workers/vetting/service";
import {
  type ComparedFile,
  runnerEquivalence,
  scannerInputs,
} from "./vetting-runner-equivalence";

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
  if (!env.GITHUB_TOKEN)
    throw new Error("The workflow read-only GitHub credential is required");
  const production = branch === "refs/heads/main";
  const origin = production ? "https://slop.cash" : "https://staging.slop.cash";
  // The publication journal is recorded through the signed service, so this
  // job holds no account-wide Cloudflare credential of its own (#1411 C-09).
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
          model: "claude-sonnet-5.5",
          maxOutputTokens: 8192,
          rateCard: rates.primary,
        },
        specialist: {
          reviewer: "astra",
          transport: "openai-responses",
          endpoint: "https://api.surplusintelligence.ai/v1/responses",
          model: "gpt-6.1-terra",
          maxOutputTokens: 8192,
          rateCard: rates.specialist,
        },
      }),
      { mode: 0o600 },
    );
    stage = "scanner-config";
    const config = await serviceConfigFrom(configPath, env);
    const journal = servicePublicationJournal({
      origin: config.connection.origin,
      signer: config.connection,
    });
    // Confirm the signed journal route answers before acquiring source or
    // spending model tokens. This probe reads the intent table, so it proves the
    // route, its signature and a readable journal; a refusal stops the pass here
    // and is reported under this stage.
    stage = "journal";
    await journal.has("controller-readiness");
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
    if (
      health.ok !== true ||
      !/^[a-f0-9]{40}$/.test(health.revision ?? "") ||
      !/^[a-f0-9]{64}$/.test(health.imageSha256 ?? "")
    )
      throw new Error("The isolated runner is not deployed");
    const deployed = health.revision as string;
    const checkout = env.GITHUB_SHA as string;
    // An earlier commit of this branch with no scanner input changed since
    // runs the same scanner, so the scan need not wait for the release of
    // every later merge (operator decision, 23 November 2026).
    let compare: { status: string; files: ComparedFile[] } | undefined;
    if (deployed !== checkout) {
      // The scan's read token first, then the workflow's own token; a read
      // that neither answers leaves the pass waiting for the release.
      for (const token of [env.GITHUB_TOKEN, env.GITHUB_COMPARE_TOKEN]) {
        if (!token || compare) continue;
        const answer = await fetch(
          `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/compare/${deployed}...${checkout}`,
          {
            redirect: "error",
            signal: AbortSignal.timeout(30_000),
            headers: {
              accept: "application/vnd.github+json",
              authorization: `Bearer ${token}`,
              "user-agent": "slop-vetting-controller",
              "x-github-api-version": "2022-11-28",
            },
          },
        ).catch(() => null);
        if (!answer?.ok) continue;
        const body = (await answer.json()) as {
          status?: unknown;
          files?: unknown;
        };
        if (typeof body.status === "string" && Array.isArray(body.files))
          compare = {
            status: body.status,
            files: body.files.filter(
              (file): file is ComparedFile =>
                typeof file?.filename === "string",
            ),
          };
      }
    }
    const decision = runnerEquivalence({
      deployed,
      checkout,
      compare,
      inputs: deployed === checkout ? new Set() : scannerInputs(process.cwd()),
    });
    if (decision.result === "equivalent")
      console.log(
        `The isolated runner reports ${deployed}, an earlier commit of this branch; no scanner input changed up to ${checkout}, so this pass runs.`,
      );
    if (decision.result === "refused") {
      // Commit IDs and repository paths are public. Name them so the
      // operator knows to wait for the release of this checkout.
      console.error(
        `The isolated runner reports ${deployed}; this checkout is ${checkout} (${decision.reason}${decision.touched ? `: ${decision.touched.slice(0, 10).join(", ")}` : ""}). Dispatch again after the release of this checkout succeeds.`,
      );
      throw new Error("The matching isolated runner has not been deployed");
    }
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
