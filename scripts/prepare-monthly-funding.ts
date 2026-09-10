/** Derives preparation from one complete public snapshot; never an independent audit. */
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CycleWalletProof } from "../src/lib/cycle-index";
import {
  assertFundingPreparation,
  createFundingReview,
  type FundingPreparation,
} from "../src/lib/funding-review-data";
import { assertPublishableLeaderboardSnapshot } from "../src/lib/leaderboard";
import { createProjectView } from "../src/lib/project-view";
import { PROJECTS, type ProjectDefinition } from "../src/lib/projects.mjs";
import { fetchPublishedGithubWallet } from "./github-wallets";
import { fundingReviewSha256 } from "./prepare-funding-review";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function fundingCycle(cycleId: string, observedAt: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(cycleId))
    throw new TypeError("Cycle must be YYYY-MM");
  const start = `${cycleId}-01T00:00:00.000Z`;
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  if (
    !Number.isFinite(Date.parse(observedAt)) ||
    new Date(observedAt).toISOString() !== observedAt ||
    Date.parse(observedAt) < end.getTime()
  )
    throw new TypeError("Cycle must be closed at the exact observation time");
  return { start, end: end.toISOString() };
}
export interface MonthlyFundingOptions {
  cycleId: string;
  refreshWallets?: boolean;
  snapshotPath: string;
  evidenceDirectory: string;
  evidenceUrl: string;
  evidenceArtifact: string;
  projectId?: string;
  observedAt?: string;
  githubToken?: string;
  root?: string;
}
interface Dependencies {
  projects: readonly ProjectDefinition[];
  observeWallet: (
    actorId: string,
    login: string,
    observedAt: string,
    options: { token?: string },
  ) => Promise<CycleWalletProof | null>;
}
const defaults: Dependencies = {
  projects: PROJECTS,
  observeWallet: fetchPublishedGithubWallet,
};
async function absent(path: string) {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new TypeError(`Refusing existing preparation/evidence path: ${path}`);
}
export async function prepareMonthlyFunding(
  options: MonthlyFundingOptions,
  dependencies: Dependencies = defaults,
): Promise<FundingPreparation[]> {
  const observedAt = options.observedAt ?? new Date().toISOString();
  const period = fundingCycle(options.cycleId, observedAt);
  if (
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*$/u.test(
      options.evidenceUrl,
    ) ||
    !/^funding-preparation-[a-zA-Z0-9-]{1,100}$/u.test(options.evidenceArtifact)
  )
    throw new TypeError("Invalid evidence artifact reference");
  const root = resolve(options.root ?? ROOT);
  if (
    options.projectId !== undefined &&
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(options.projectId)
  )
    throw new TypeError("Invalid project id");
  const selected = dependencies.projects.filter(
    (p) => options.projectId === undefined || p.id === options.projectId,
  );
  if (!selected.length) throw new TypeError("Unknown project");
  const projects = selected.filter((p) => p.reward.rewardStartAt < period.end);
  if (!projects.length)
    throw new TypeError("No project reward period has opened");
  const paths = projects.map((p) =>
    join(root, "funding/preparations", `${p.id}-${options.cycleId}.json`),
  );
  const evidenceDirectory = resolve(options.evidenceDirectory);
  // Refuse before lookup or mutation; all existing audited preparations are immutable.
  for (const path of [...paths, evidenceDirectory]) await absent(path);
  const stat = await lstat(options.snapshotPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024)
    throw new TypeError("Invalid public snapshot file");
  const sourceBytes = await readFile(options.snapshotPath);
  const value: unknown = JSON.parse(sourceBytes.toString("utf8"));
  assertPublishableLeaderboardSnapshot(value);
  const snapshot = value;
  if (
    snapshot.stale ||
    snapshot.source.evidenceVerification.status !== "complete" ||
    snapshot.window.to !== period.end ||
    snapshot.source.cutoffAt !== period.end ||
    snapshot.source.verificationWindow.to !== period.end ||
    snapshot.source.verificationWindow.from !== snapshot.window.from ||
    snapshot.source.fetchedAt > observedAt
  )
    throw new TypeError(
      "Mismatched or incomplete snapshot cutoff/verification window",
    );
  const views = projects.map((project) => {
    const expectedFrom =
      project.reward.rewardStartAt > period.start
        ? project.reward.rewardStartAt
        : period.start;
    if (snapshot.window.from > expectedFrom)
      throw new TypeError("Incomplete project month in snapshot");
    const view = createProjectView(snapshot, project.id, options.cycleId);
    if (
      view.cycle.from !== expectedFrom ||
      view.cycle.to !== period.end ||
      view.cycle.status !== "closed"
    )
      throw new TypeError("Incomplete canonical project view");
    return view;
  });
  const actors = new Map<string, { id: string; login: string }>();
  for (const view of views)
    for (const row of view.leaders) {
      const previous = actors.get(row.actor.id);
      if (previous && previous.login !== row.actor.login)
        throw new TypeError("Conflicting actor identity");
      actors.set(row.actor.id, { id: row.actor.id, login: row.actor.login });
    }
  const wallets = [];
  for (const actor of [...actors.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    // Lookup failure aborts this generic publication. A null successful lookup is
    // a missing registration and retains its award. No raw API errors are copied.
    const wallet = await dependencies.observeWallet(
      actor.id,
      actor.login,
      observedAt,
      { token: options.githubToken },
    );
    wallets.push({
      actor,
      status: wallet ? "registered" : "missing",
      wallet,
      observedAt,
      cycleLocked: false,
    });
  }
  const sourceSnapshotSha256 = fundingReviewSha256(sourceBytes);
  const walletBytes = `${JSON.stringify({ observedAt, sourceSnapshotSha256, wallets }, null, 2)}\n`;
  const walletByActor = new Map(wallets.map((w) => [w.actor.id, w.wallet]));
  const inputs = views.map((view) => {
    const contributors = view.leaders.map((row) => {
      if (
        !Number.isSafeInteger(row.scoreThirds) ||
        !Number.isSafeInteger(row.adjustedWeight)
      )
        throw new TypeError("Nonexact score weight");
      const eventIds = view.ledger
        .filter((e) => e.actor.id === row.actor.id)
        .map((e) => e.id)
        .sort();
      return {
        actor: { id: row.actor.id, login: row.actor.login },
        scoreThirds: String(row.scoreThirds),
        weight: String(row.adjustedWeight),
        eventCount: eventIds.length,
        eventIdsSha256: fundingReviewSha256(JSON.stringify(eventIds)),
        wallet: walletByActor.get(row.actor.id) ?? null,
        lookupUnavailable: false,
      };
    });
    const input = assertFundingPreparation({
      projectId: view.project.id,
      cycleId: options.cycleId,
      sourceSnapshotSha256,
      sourceAuditSha256: null,
      observedAt,
      provenance: {
        derivation: "snapshot-derived",
        evidenceUrl: options.evidenceUrl,
        evidenceArtifact: options.evidenceArtifact,
        ruleVersion: snapshot.ruleVersion,
        walletObservationsSha256: fundingReviewSha256(walletBytes),
        snapshotFrom: snapshot.window.from,
        snapshotTo: snapshot.window.to,
        periodFrom: view.cycle.from,
        periodTo: view.cycle.to,
        snapshotLedgerCount: snapshot.ledger.length,
        sourceMergedPullRequests: snapshot.source.counts.mergedPullRequests,
        mergedCensus: null,
        scoredMerges: view.ledger.filter(
          (e) => e.category === "merged-pull-request",
        ).length,
      },
      counts: {
        contributors: contributors.length,
        events: contributors.reduce((s, r) => s + r.eventCount, 0),
        scoreThirds: contributors
          .reduce((s, r) => s + BigInt(r.scoreThirds), 0n)
          .toString(),
        weight: contributors
          .reduce((s, r) => s + BigInt(r.weight), 0n)
          .toString(),
      },
      contributors,
    });
    createFundingReview(input); // Validate current canonical cap and allocation before writing.
    return input;
  });
  // A newly owned evidence directory and exclusive input creation prevent partial
  // overwrites. On failure remove only files created by this invocation.
  await mkdir(dirname(evidenceDirectory), { recursive: true });
  await mkdir(evidenceDirectory);
  const written: string[] = [];
  try {
    await writeFile(
      join(evidenceDirectory, "source-snapshot.json"),
      sourceBytes,
      { flag: "wx" },
    );
    await writeFile(
      join(evidenceDirectory, "wallet-observations.json"),
      walletBytes,
      { flag: "wx" },
    );
    await writeFile(
      join(evidenceDirectory, "preparations.json"),
      `${JSON.stringify(inputs, null, 2)}\n`,
      { flag: "wx" },
    );
    await writeFile(
      join(evidenceDirectory, "SHA256SUMS"),
      `${sourceSnapshotSha256}  source-snapshot.json\n${fundingReviewSha256(walletBytes)}  wallet-observations.json\n`,
      { flag: "wx" },
    );
    await mkdir(join(root, "funding/preparations"), { recursive: true });
    for (let i = 0; i < inputs.length; i++) {
      const file = await open(paths[i], "wx");
      written.push(paths[i]);
      try {
        await file.writeFile(`${JSON.stringify(inputs[i], null, 2)}\n`);
      } finally {
        await file.close();
      }
    }
  } catch (error) {
    await Promise.all(written.map((path) => rm(path)));
    await rm(evidenceDirectory, { recursive: true });
    throw error;
  }
  return inputs;
}
export type WalletRefreshOptions = Omit<
  MonthlyFundingOptions,
  "snapshotPath" | "projectId"
> & { projectId: string };

/** Refresh only mutable registration observations; never replace the source census. */
export async function refreshPreparationWallets(
  options: WalletRefreshOptions,
  dependencies: Dependencies = defaults,
): Promise<FundingPreparation> {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(options.projectId) ||
    !dependencies.projects.some((p) => p.id === options.projectId)
  )
    throw new TypeError("Unknown refresh project");
  const observedAt = options.observedAt ?? new Date().toISOString();
  fundingCycle(options.cycleId, observedAt);
  const root = resolve(options.root ?? ROOT);
  const path = join(
    root,
    "funding/preparations",
    `${options.projectId}-${options.cycleId}.json`,
  );
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024)
    throw new TypeError("Invalid preparation file");
  const originalBytes = await readFile(path);
  const original = assertFundingPreparation(
    JSON.parse(originalBytes.toString("utf8")),
  );
  if (
    original.projectId !== options.projectId ||
    original.cycleId !== options.cycleId
  )
    throw new TypeError("Refresh project/cycle does not match preparation");
  if (observedAt <= original.observedAt)
    throw new TypeError("Refresh must follow the original wallet observation");
  const evidenceDirectory = resolve(options.evidenceDirectory);
  await absent(evidenceDirectory);
  const observations: Array<{
    actor: { id: string; login: string };
    wallet: CycleWalletProof | null;
    observedAt: string;
    status: string;
    cycleLocked: false;
    lookupUnavailable: boolean;
  }> = [];
  for (const row of original.contributors) {
    let wallet: CycleWalletProof | null = null;
    let lookupUnavailable = false;
    try {
      wallet = await dependencies.observeWallet(
        row.actor.id,
        row.actor.login,
        observedAt,
        { token: options.githubToken },
      );
    } catch {
      // A failed lookup is not evidence of missing registration. Do not retain
      // raw errors or imply an old proof was freshly confirmed.
      lookupUnavailable = true;
    }
    observations.push({
      actor: row.actor,
      wallet,
      observedAt,
      status: lookupUnavailable
        ? "lookup-unavailable"
        : wallet
          ? "registered"
          : "missing",
      cycleLocked: false,
      lookupUnavailable,
    });
  }
  const walletBytes = `${JSON.stringify({ projectId: original.projectId, cycleId: original.cycleId, observedAt, sourceSnapshotSha256: original.sourceSnapshotSha256, wallets: observations }, null, 2)}\n`;
  const updated = assertFundingPreparation({
    ...original,
    observedAt,
    provenance: {
      ...original.provenance,
      walletObservationsSha256: fundingReviewSha256(walletBytes),
    },
    contributors: original.contributors.map((row, i) => ({
      ...row,
      wallet: observations[i].wallet,
      lookupUnavailable: observations[i].lookupUnavailable,
    })),
  });
  const updatedBytes = `${JSON.stringify(updated, null, 2)}\n`;
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(evidenceDirectory), { recursive: true });
  await mkdir(evidenceDirectory);
  let temporaryCreated = false;
  try {
    await writeFile(
      join(evidenceDirectory, "preparation-before.json"),
      originalBytes,
      { flag: "wx" },
    );
    await writeFile(
      join(evidenceDirectory, "wallet-observations.json"),
      walletBytes,
      { flag: "wx" },
    );
    await writeFile(
      join(evidenceDirectory, "preparation-after.json"),
      updatedBytes,
      { flag: "wx" },
    );
    await writeFile(
      join(evidenceDirectory, "SHA256SUMS"),
      `${fundingReviewSha256(originalBytes)}  preparation-before.json\n${fundingReviewSha256(walletBytes)}  wallet-observations.json\n${fundingReviewSha256(updatedBytes)}  preparation-after.json\n`,
      { flag: "wx" },
    );
    const file = await open(temporary, "wx");
    temporaryCreated = true;
    try {
      await file.writeFile(updatedBytes);
    } finally {
      await file.close();
    }
    if (!(await readFile(path)).equals(originalBytes))
      throw new TypeError(
        "Preparation changed during wallet refresh; retry against new source",
      );
    await rename(temporary, path);
    temporaryCreated = false;
  } catch (error) {
    if (temporaryCreated) await rm(temporary);
    await rm(evidenceDirectory, { recursive: true });
    throw error;
  }
  return updated;
}

export function parseMonthlyFundingArguments(
  args: string[],
): MonthlyFundingOptions {
  const flags = new Map<string, string>();
  const allowed = new Set([
    "--cycle",
    "--snapshot",
    "--project",
    "--evidence-directory",
    "--evidence-url",
    "--evidence-artifact",
  ]);
  let refreshWallets = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--refresh-wallets") {
      if (refreshWallets) throw new TypeError("Repeated wallet refresh flag");
      refreshWallets = true;
      continue;
    }
    if (
      !allowed.has(args[i]) ||
      flags.has(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new TypeError("Invalid monthly funding arguments");
    flags.set(args[i], args[i + 1]);
    i++;
  }
  for (const key of allowed) {
    const required = refreshWallets
      ? ["--cycle", "--project", "--evidence-directory"].includes(key)
      : key !== "--project";
    if (required && !flags.has(key))
      throw new TypeError(`Required argument: ${key}`);
  }
  if (refreshWallets && flags.has("--snapshot"))
    throw new TypeError("Wallet refresh cannot ingest a new snapshot");
  return {
    refreshWallets,
    cycleId: flags.get("--cycle") ?? "",
    snapshotPath: resolve(flags.get("--snapshot") ?? ""),
    projectId: flags.get("--project"),
    evidenceDirectory: resolve(flags.get("--evidence-directory") ?? ""),
    evidenceUrl: flags.get("--evidence-url") ?? "",
    evidenceArtifact: flags.get("--evidence-artifact") ?? "",
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = {
    ...parseMonthlyFundingArguments(process.argv.slice(2)),
    githubToken: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
  };
  if (args.refreshWallets) {
    await refreshPreparationWallets({
      ...args,
      projectId: args.projectId ?? "",
    });
    console.log(
      "Refreshed preparation wallet observations only; published cycle wallets remain unchanged.",
    );
  } else {
    const inputs = await prepareMonthlyFunding(args);
    console.log(
      `Prepared ${inputs.length} project review(s); no proposals frozen or payments authorized.`,
    );
  }
}
