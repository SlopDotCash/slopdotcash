/**
 * Writes the idempotent D1 import of reviewed GitHub records: every observed
 * transfer in the direct-payment disclosures, and every legacy wallet
 * observation from a GitHub profile README in the frozen preparations and
 * cycle proposals. The deploy runs it after the slop-private migrations. It
 * refuses to write anything unless every disclosure reproduces from its
 * frozen preparation, and the database refuses a row that contradicts an
 * earlier import. It reads no chain and authorizes no payment or wallet.
 * With no records it writes an empty file, and the deploy skips the import.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { githubUserIdFromNodeId } from "../src/lib/github-actor";
import { assertLeaderboardSnapshot } from "../src/lib/leaderboard";
import { createProjectView } from "../src/lib/project-view";
import type { ProfileReadmeWalletProof } from "../src/lib/rewards";
import { isWalletAddress } from "../src/lib/wallets";
import {
  checkDirectPaymentDisclosures,
  type Disclosure,
} from "./check-direct-payment-disclosures";
import { previousCycleId } from "./prior-cycle-accrual";
import {
  priorReadmeProofs,
  unboundReadmeProofReason,
} from "./readme-proof-binding";

const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;

const CHAINS: Record<string, "solana" | "base"> = {
  "solana-mainnet": "solana",
};

export function directPaymentsSql(root: string, importedAt: string): string {
  const failures = checkDirectPaymentDisclosures(root);
  if (failures.length) throw new Error(failures.join("\n"));
  const statements: string[] = [];
  for (const name of readdirSync(join(root, "disclosures"))
    .filter((n) => n.endsWith(".json"))
    .sort()) {
    const path = `disclosures/${name}`;
    const d = JSON.parse(
      readFileSync(join(root, path), "utf8"),
    ) as Disclosure & { network: string; asset: string };
    const chain = CHAINS[d.network];
    if (!chain || d.asset !== "USDC")
      throw new Error(`${path}: unsupported network or asset`);
    if (
      !/^[a-z0-9][a-z0-9-]*$/u.test(d.projectId) ||
      !/^\d{4}-(0[1-9]|1[0-2])$/u.test(d.contributionMonth)
    )
      throw new Error(`${path}: invalid project or month`);
    for (const row of d.rows) {
      if (row.state !== "paid-direct" || !row.observed) continue;
      const o = row.observed;
      const githubUserId = githubUserIdFromNodeId(row.actorId);
      if (
        !githubUserId ||
        !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/u.test(o.signature) ||
        !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(o.recipient) ||
        !/^[1-9]\d*$/u.test(o.amountMinor) ||
        !Number.isSafeInteger(o.slot) ||
        Number.isNaN(Date.parse(o.blockTime))
      )
        throw new Error(`${path}: invalid observed transfer for ${row.login}`);
      const values = [
        d.network,
        o.signature,
        d.projectId,
        d.contributionMonth,
        githubUserId,
        row.actorId,
        row.login,
        chain,
        o.recipient,
        o.amountMinor,
        o.blockTime,
        String(o.slot),
        path,
        importedAt,
      ].map(quote);
      statements.push(
        `INSERT INTO payment_direct_transfers VALUES(${values.join(",")}) ON CONFLICT(network,transaction_id) DO UPDATE SET github_login=excluded.github_login,source_path=excluded.source_path WHERE github_login!=excluded.github_login OR source_path!=excluded.source_path;`,
      );
    }
  }
  // No disclosure is valid input: the import only appends and updates, so
  // rows imported by earlier deploys stay in D1.
  if (!statements.length) return "";
  return `${statements.join("\n")}\n`;
}

interface FrozenWallet {
  address: string;
  chain: "solana" | "base";
  observedAt: string;
  sourceCommit?: string;
  sourceUrl: string;
}

interface FrozenCycleBindings {
  /** The login that the frozen inputs record for each actor id. */
  logins: Map<string, string>;
  /** The README proof that the prior cycle manifest froze for each actor id. */
  priorProofs: Map<string, ProfileReadmeWalletProof>;
}

/**
 * Returns what the frozen inputs of a cycle bind to each actor id: the login
 * of a project leader in this cycle's project view (a scored actor), else the
 * login in the prior cycle manifest (allocation.json, else proposal.json; a
 * carried actor), and the README proof of the prior manifest. Proposal
 * validation regenerates rows from the same inputs and the same project view,
 * so an actor that is a leader only in another project keeps its prior login.
 * A README proof has no actor id, so the import binds it only to these
 * values, never to a login or proof that the proposal itself states (ACC-01).
 */
function frozenCycleBindings(root: string, path: string): FrozenCycleBindings {
  const match = /^cycles\/([^/]+)\/(\d{4}-\d{2})\/proposal\.json$/u.exec(path);
  if (!match) throw new Error(`${path}: not a cycle proposal path`);
  const [, projectId, cycleId] = match;
  const logins = new Map<string, string>();
  let priorProofs = new Map<string, ProfileReadmeWalletProof>();
  const priorDirectory = join(
    root,
    "cycles",
    projectId,
    previousCycleId(cycleId),
  );
  const priorPath = ["allocation.json", "proposal.json"]
    .map((name) => join(priorDirectory, name))
    .find((candidate) => existsSync(candidate));
  if (priorPath) {
    const prior = JSON.parse(readFileSync(priorPath, "utf8")) as {
      allocations?: {
        actor: { id: string; login: string };
        wallet?: unknown;
      }[];
    };
    for (const { actor } of prior.allocations ?? [])
      logins.set(actor.id, actor.login);
    priorProofs = priorReadmeProofs(prior);
  }
  const snapshotPath = join(
    root,
    "cycles",
    projectId,
    cycleId,
    "source-snapshot.json",
  );
  if (existsSync(snapshotPath)) {
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    assertLeaderboardSnapshot(snapshot);
    // A scored actor takes the login of the project view, as in proposal
    // validation. A leader of another project only is not scored here.
    for (const { actor } of createProjectView(snapshot, projectId, cycleId)
      .leaders)
      logins.set(actor.id, actor.login);
  }
  return { logins, priorProofs };
}

/** Legacy README observations; registry-sourced wallets are already in D1. */
export function walletObservationsSql(
  root: string,
  importedAt: string,
  report: (message: string) => void = (message) => console.warn(message),
): string {
  const files = [
    ...readdirSync(join(root, "funding/preparations"))
      .filter((n) => n.endsWith(".json"))
      .map((n) => `funding/preparations/${n}`),
    ...readdirSync(join(root, "cycles"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) =>
        readdirSync(join(root, "cycles", d.name)).map(
          (month) => `cycles/${d.name}/${month}/proposal.json`,
        ),
      ),
  ].sort();
  const rows: { observedAt: string; values: string[] }[] = [];
  for (const path of files) {
    let record: {
      contributors?: {
        actor: { id: string; login: string };
        wallet: FrozenWallet | null;
      }[];
      allocations?: {
        actor: { id: string; login: string };
        wallet: FrozenWallet | null;
      }[];
    };
    try {
      record = JSON.parse(readFileSync(join(root, path), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    let frozen: FrozenCycleBindings | undefined;
    for (const { actor, wallet } of [
      ...(record.contributors ?? []),
      ...(record.allocations ?? []),
    ]) {
      if (!wallet?.sourceCommit) continue;
      if (path.startsWith("cycles/")) {
        frozen ??= frozenCycleBindings(root, path);
        const [, projectId, cycleId] = path.split("/");
        // An unbound README proof is not imported. It is skipped and reported,
        // so one bad row does not stop the import of all others (PAY-07).
        // Proposal validation rejects the same row.
        const reason =
          frozen.logins.get(actor.id) !== actor.login
            ? `README wallet login ${actor.login} is not the frozen login of ${actor.id}`
            : unboundReadmeProofReason({
                projectId,
                cycleId,
                actorId: actor.id,
                wallet: wallet as ProfileReadmeWalletProof,
                priorProof: frozen.priorProofs.get(actor.id),
              });
        if (reason) {
          report(`${path}: ${reason}; not imported`);
          continue;
        }
      }
      const readme = new RegExp(
        `^https://github\\.com/([^/]+)/\\1/blob/${wallet.sourceCommit}/README\\.md$`,
        "iu",
      ).exec(wallet.sourceUrl);
      const githubUserId = githubUserIdFromNodeId(actor.id);
      if (
        !readme ||
        readme[1].toLowerCase() !== actor.login.toLowerCase() ||
        !/^[0-9a-f]{40}$/u.test(wallet.sourceCommit) ||
        !githubUserId ||
        !isWalletAddress(wallet.chain, wallet.address) ||
        Number.isNaN(Date.parse(wallet.observedAt))
      )
        throw new Error(`${path}: invalid README wallet for ${actor.login}`);
      rows.push({
        observedAt: wallet.observedAt,
        values: [
          githubUserId,
          actor.id,
          actor.login,
          wallet.chain,
          wallet.address,
          "profile_readme",
          wallet.sourceUrl,
          wallet.sourceCommit,
          wallet.observedAt,
          path,
          importedAt,
        ],
      });
    }
  }
  if (!rows.length) return "";
  // The earliest observation of each README commit is kept.
  return `${rows
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
    .map(
      (r) =>
        `INSERT INTO wallet_observations VALUES(${r.values.map(quote).join(",")}) ON CONFLICT(github_user_id,chain,address,source_commit) DO NOTHING;`,
    )
    .join("\n")}\n`;
}

if (import.meta.main) {
  if (process.argv.length !== 3)
    throw new Error("Usage: prepare-payments-import.ts OUTPUT_SQL");
  const importedAt = new Date().toISOString();
  writeFileSync(
    process.argv[2],
    directPaymentsSql(process.cwd(), importedAt) +
      walletObservationsSql(process.cwd(), importedAt),
  );
}
