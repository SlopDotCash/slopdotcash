/** Trusted-main historical allocation runner; no valuation or payment writes. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  assertPointsJournalExtension,
  type PointsJournal,
} from "../src/lib/points";
import {
  applyPointsImplementationCorrections,
  type PointsCorrectionEligibility,
  type PointsImplementationCorrectionManifest,
  pointsImplementationCorrectionDigest,
} from "../src/lib/points-implementation-corrections";
import { GitHubClient } from "../workers/slopbot/github";
import { resolveGitHubToken } from "./generate-leaderboard";
import { loadPublishedPoints, pointsSql } from "./generate-points";
import {
  type PointProtectionScope,
  pointProtectionQuery,
} from "./points-protection-sql";
import { fetchProjectRegistry } from "./sync-project-registry.mjs";
import { loadParticipationBans } from "./value-ingestion";

const execute = promisify(execFile);
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Bind the same-run proof to its current collection authority before writes. */
export function verifyCorrectionCollection(
  manifest: PointsImplementationCorrectionManifest,
  value: unknown,
  currentRegistry: unknown,
  apply: boolean,
): void {
  const receipt = value as Record<string, unknown> | null;
  const complete = manifest.candidates.filter(
    (candidate) => candidate.proof.status === "complete",
  ).length;
  if (
    receipt?.schemaVersion !== "slop-implementation-correction-collection-v1" ||
    receipt.manifestDigest !== pointsImplementationCorrectionDigest(manifest) ||
    receipt.through !== manifest.generatedAt ||
    receipt.registryDigest !== digest(currentRegistry) ||
    receipt.totalPositivePools !== manifest.candidates.length ||
    receipt.completeProofs !== complete ||
    receipt.heldProofs !== manifest.candidates.length - complete ||
    typeof receipt.ownershipComplete !== "boolean" ||
    (!receipt.ownershipComplete && (apply || complete > 0))
  )
    throw new Error(
      "Collection receipt or current registry does not authorize this correction",
    );
}

export function correctionScopes(
  manifest: PointsImplementationCorrectionManifest,
): PointProtectionScope[] {
  const scopes = new Map<string, PointProtectionScope>();
  for (const candidate of manifest.candidates) {
    const scope = {
      projectId: candidate.projectId,
      period: candidate.occurredAt.slice(0, 7),
    };
    // Use the exact SQL validator even when no private query is made yet.
    pointProtectionQuery([scope]);
    scopes.set(JSON.stringify([scope.projectId, scope.period]), scope);
  }
  return [...scopes.values()];
}

/** A missing, duplicate, extra or malformed private row never means eligible. */
export function correctionEligibility(
  manifest: PointsImplementationCorrectionManifest,
  queryResults: unknown,
): PointsCorrectionEligibility[] {
  const expected = new Set(
    correctionScopes(manifest).map((scope) =>
      JSON.stringify([scope.projectId, scope.period]),
    ),
  );
  if (!Array.isArray(queryResults))
    throw new Error("Invalid private eligibility response");
  const rows = new Map<string, boolean>();
  for (const response of queryResults) {
    if (
      !response ||
      typeof response !== "object" ||
      response.success !== true ||
      !Array.isArray(response.results)
    )
      throw new Error("Incomplete private eligibility response");
    for (const row of response.results) {
      if (
        !row ||
        typeof row !== "object" ||
        typeof row.project_id !== "string" ||
        typeof row.period !== "string" ||
        ![0, 1].includes(row.protected)
      )
        throw new Error("Invalid private eligibility row");
      const key = JSON.stringify([row.project_id, row.period]);
      if (!expected.has(key) || rows.has(key))
        throw new Error("Unexpected private eligibility scope");
      rows.set(key, row.protected === 0);
    }
  }
  if (rows.size !== expected.size)
    throw new Error("Missing private eligibility scope");
  return manifest.candidates.map((candidate) => ({
    candidateId: candidate.id,
    eligible:
      rows.get(
        JSON.stringify([candidate.projectId, candidate.occurredAt.slice(0, 7)]),
      ) === true,
  }));
}

type PrivateQuery = (sql: string) => Promise<unknown>;
export async function readCorrectionEligibility(
  manifest: PointsImplementationCorrectionManifest,
  query: PrivateQuery,
): Promise<PointsCorrectionEligibility[]> {
  const scopes = correctionScopes(manifest);
  const responses: unknown[] = [];
  for (let offset = 0; offset < scopes.length; offset += 100) {
    const result = await query(
      pointProtectionQuery(scopes.slice(offset, offset + 100)),
    );
    if (!Array.isArray(result))
      throw new Error("Invalid private eligibility batch");
    responses.push(...result);
  }
  return correctionEligibility(manifest, responses);
}

export function assertCorrectionPublication(
  expected: PointsJournal,
  actual: PointsJournal,
): void {
  // A later ordinary publication may append records. It cannot discard or
  // replace a single correction, reorder the prefix or remove source coverage.
  assertPointsJournalExtension(expected, actual);
}

/** This receipt is independent of the Pages projection and private scope mask. */
export function correctionBatchRecorded(
  value: unknown,
  batchDigest: string,
  revisionCount: number,
): boolean {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    value[0]?.success !== true ||
    !Array.isArray(value[0].results)
  )
    throw new Error("Invalid Points batch receipt");
  const rows = value[0].results;
  if (rows.length === 0) return false;
  if (
    rows.length !== 1 ||
    rows[0]?.digest !== batchDigest ||
    rows[0]?.revision_count !== revisionCount ||
    rows[0]?.staged !== 0
  )
    throw new Error("Points batch receipt does not reconcile");
  return true;
}

/** An uncertain import can succeed only after an independent D1 receipt. */
export async function recordCorrection(
  expected: PointsJournal,
  io: {
    verifyMain: () => Promise<void>;
    importBatch: () => Promise<void>;
    batchRecorded: () => Promise<boolean>;
    loadPublic: () => Promise<PointsJournal | null>;
    wait: () => Promise<void>;
  },
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    // A prior uncertain attempt may already be recorded. Reconcile it before
    // attempting any more writes, even when main has since advanced.
    if (!(await io.batchRecorded())) {
      await io.verifyMain();
      try {
        await io.importBatch();
      } catch {
        /* The next independent read distinguishes committed from refused. */
      }
    }
    if (await io.batchRecorded()) {
      const actual = await io.loadPublic();
      if (actual) {
        try {
          assertCorrectionPublication(expected, actual);
          return;
        } catch {
          /* Wait for the complete public checkpoint, never infer success. */
        }
      }
    }
    if (attempt < 2) await io.wait();
  }
  throw new Error(
    "Historical correction import was not verified; retain the run for reconciliation",
  );
}

async function privateD1(args: string[]): Promise<string> {
  try {
    const { stdout } = await execute(
      resolve("node_modules/.bin/wrangler"),
      [
        "d1",
        "execute",
        "slop-private",
        "--remote",
        "--config",
        "workers/identity/wrangler.toml",
        ...args,
      ],
      {
        env: {
          ...process.env,
          WRANGLER_LOG: "error",
          WRANGLER_WRITE_LOGS: "false",
        },
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    return stdout;
  } catch {
    // Child error objects embed stdout, stderr and queries. Never print them:
    // eligibility and settlement state remain inside this trusted process.
    throw new Error("Private Points database operation failed");
  }
}

async function queryPrivateD1(sql: string): Promise<unknown> {
  let result: unknown;
  try {
    result = JSON.parse(await privateD1(["--json", "--command", sql]));
  } catch {
    throw new Error("Private Points query failed");
  }
  return result;
}

async function main() {
  const [manifestPath, outputDirectory, mode] = process.argv.slice(2);
  if (
    !manifestPath ||
    !outputDirectory ||
    !["preview", "apply"].includes(mode) ||
    process.argv.length !== 5
  )
    throw new Error(
      "Usage: prepare-implementation-corrections.ts MANIFEST OUTPUT_DIRECTORY preview|apply",
    );
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    !/^[a-f0-9]{40}$/u.test(process.env.GITHUB_SHA ?? "")
  )
    throw new Error(
      "Historical corrections require the reviewed manual main workflow",
    );
  const checkout = (await execute("git", ["rev-parse", "HEAD"])).stdout.trim();
  const verifyMain = async () => {
    const mainHead = (
      await execute("git", ["ls-remote", "origin", "refs/heads/main"])
    ).stdout.split(/\s/u)[0];
    if (checkout !== process.env.GITHUB_SHA || mainHead !== checkout)
      throw new Error(
        "Historical correction source is no longer the exact main head",
      );
  };
  await verifyMain();
  const manifest: PointsImplementationCorrectionManifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  );
  const [collection, registry] = await Promise.all([
    readFile(
      join(dirname(manifestPath), "collection-receipt.json"),
      "utf8",
    ).then(JSON.parse),
    fetchProjectRegistry(),
  ]);
  verifyCorrectionCollection(manifest, collection, registry, mode === "apply");
  const journal = await loadPublishedPoints();
  if (!journal)
    throw new Error("Historical correction requires an existing journal");
  const eligibility = await readCorrectionEligibility(manifest, queryPrivateD1);
  const retainedActors = new Set<string>();
  for (const candidate of manifest.candidates) {
    if (candidate.proof.status !== "complete") continue;
    for (const source of candidate.proof.sources) {
      if (source.author?.kind === "User") retainedActors.add(source.author.id);
      for (const commit of source.commits)
        if (commit.author?.kind === "User")
          retainedActors.add(commit.author.id);
    }
  }
  const github = GitHubClient.forToken(await resolveGitHubToken(), fetch);
  const bans = await loadParticipationBans(github, fetch, retainedActors);
  const banDigest = (value: ReadonlyMap<string, string>) =>
    digest([...value].sort(([left], [right]) => left.localeCompare(right)));
  const verifyCurrentAuthority = async () => {
    await verifyMain();
    verifyCorrectionCollection(
      manifest,
      collection,
      await fetchProjectRegistry(),
      true,
    );
    if (
      banDigest(await loadParticipationBans(github, fetch, retainedActors)) !==
      banDigest(bans)
    )
      throw new Error("Account restrictions changed after correction planning");
  };
  const result = applyPointsImplementationCorrections(
    journal,
    manifest,
    eligibility,
    new Date().toISOString(),
    bans,
  );
  // Public output deliberately contains aggregate dispositions only. Never
  // expose which source is retained because of private settlement state.
  const report = {
    schemaVersion: "1",
    workflowSha: checkout,
    manifestDigest: result.manifestDigest,
    beforeDigest: digest(journal),
    afterDigest: digest(result.journal),
    beforeRevisions: journal.revisions.length,
    afterRevisions: result.journal.revisions.length,
    candidates: manifest.candidates.length,
    dispositions: Object.fromEntries(
      ["applied", "unchanged", "held", "retained", "already-applied"].map(
        (status) => [
          status,
          result.dispositions.filter((entry) => entry.status === status).length,
        ],
      ),
    ),
    mode,
    noChanges: result.journal === journal,
    recorded: false,
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, "before-journal.json"),
    `${JSON.stringify(journal)}\n`,
  );
  // The corrected journal is ordinary public Points history, unlike the mask.
  await writeFile(
    join(outputDirectory, "journal.json"),
    `${JSON.stringify(result.journal)}\n`,
  );
  // Retain a public pending receipt before any write, including if the runner
  // is interrupted after D1 accepts an import but before returning a response.
  await writeFile(
    join(outputDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (mode === "apply" && result.journal !== journal) {
    const temporaryRoot = process.env.RUNNER_TEMP;
    if (!temporaryRoot)
      throw new Error("Missing private runner temporary directory");
    const sqlPath = join(
      temporaryRoot,
      `points-correction-${result.manifestDigest}.sql`,
    );
    await writeFile(sqlPath, pointsSql(result.journal), { mode: 0o600 });
    // The unchanged atomic pointsSql guard checks protected state again at
    // import. Prefix triggers also reject a concurrent journal change.
    await recordCorrection(result.journal, {
      verifyMain: verifyCurrentAuthority,
      importBatch: async () => {
        await privateD1(["--file", sqlPath]);
      },
      batchRecorded: async () =>
        correctionBatchRecorded(
          await queryPrivateD1(
            `SELECT digest,revision_count,(SELECT COUNT(*) FROM points_staging WHERE batch_id='${report.afterDigest}') AS staged FROM points_batches WHERE digest='${report.afterDigest}'`,
          ),
          report.afterDigest,
          result.journal.revisions.length,
        ),
      loadPublic: loadPublishedPoints,
      wait: () => new Promise((resolve) => setTimeout(resolve, 30_000)),
    });
    report.recorded = true;
  } else if (mode === "apply") {
    assertCorrectionPublication(result.journal, journal);
  }
  await writeFile(
    join(outputDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report));
}

if (import.meta.main) {
  main().catch(() => {
    // Errors can include URLs or input data. A trusted runner keeps private
    // details private; the exit status is enough to refuse publication.
    console.error(
      "Historical Points correction refused or could not be verified.",
    );
    process.exitCode = 1;
  });
}
