/** Trusted immutable Git reads; never execute a proposal checkout. */
import { execFileSync } from "node:child_process";
import {
  PAYMENT_RESERVATION_CHECK,
  PAYMENT_RESERVATION_PATH,
  parsePaymentReservationLedger,
} from "../src/lib/payment-reservations";
export const PAYMENT_REPOSITORY = "SlopDotCash/slopdotcash";
export function reservationGit(root: string, args: string[]): Buffer {
  return execFileSync(
    "git",
    ["--no-replace-objects", "--literal-pathspecs", ...args],
    {
      cwd: root,
      timeout: 30000,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}
export function gitReservationBlob(
  root: string,
  revision: string,
  path: string,
): Uint8Array;
export function gitReservationBlob(
  root: string,
  revision: string,
  path: string,
  optional: true,
): Uint8Array | null;
export function gitReservationBlob(
  root: string,
  revision: string,
  path: string,
  optional = false,
): Uint8Array | null {
  if (
    !/^[a-f0-9]{40}$/u.test(revision) ||
    !/^[a-zA-Z0-9_./-]+$/u.test(path) ||
    path.split("/").some((part) => part === ".." || part === "")
  )
    throw new TypeError("Invalid immutable Git reference");
  const entries = reservationGit(root, ["ls-tree", "-z", revision, "--", path])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  if (optional && entries.length === 0) return null;
  const match =
    entries.length === 1
      ? /^100644 blob ([a-f0-9]{40})\t(.+)$/u.exec(entries[0])
      : null;
  if (!match || match[2] !== path)
    throw new TypeError("Expected exact regular Git blob");
  const size = Number(
    reservationGit(root, ["cat-file", "-s", match[1]]).toString().trim(),
  );
  if (!Number.isSafeInteger(size) || size < 1 || size > 16 * 1024 * 1024)
    throw new TypeError("Git blob exceeds bound");
  return new Uint8Array(reservationGit(root, ["cat-file", "blob", match[1]]));
}
export function gitReservationLedger(root: string, revision: string) {
  const bytes = gitReservationBlob(
    root,
    revision,
    PAYMENT_RESERVATION_PATH,
    true,
  );
  return bytes ? parsePaymentReservationLedger(bytes) : [];
}
export function reservationJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
export function reservationGithub(path: string): unknown {
  return JSON.parse(
    execFileSync("gh", ["api", path], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString("utf8"),
  );
}
/** Deliberately refuses unknown/ruleset-only configurations rather than assuming
 * equivalent protection. Administration must configure and verify this baseline.
 * This check is read-only and never installs or changes branch protections. */
export function assertPaymentBranchProtection(
  value: unknown,
  actionsAppId = 15368,
): void {
  const p = value as {
    enforce_admins?: { enabled?: boolean };
    required_status_checks?: {
      strict?: boolean;
      checks?: { context: string; app_id: number }[];
    };
    required_pull_request_reviews?: {
      required_approving_review_count?: number;
      dismiss_stale_reviews?: boolean;
      require_last_push_approval?: boolean;
      bypass_pull_request_allowances?: Record<string, unknown[]>;
    };
    required_conversation_resolution?: { enabled?: boolean };
    allow_force_pushes?: { enabled?: boolean };
    allow_deletions?: { enabled?: boolean };
  };
  const review = p?.required_pull_request_reviews;
  if (
    !p?.enforce_admins?.enabled ||
    !p.required_status_checks?.strict ||
    !p.required_status_checks.checks?.some(
      (c) =>
        c.context === PAYMENT_RESERVATION_CHECK &&
        Number.isSafeInteger(c.app_id) &&
        c.app_id === actionsAppId,
    ) ||
    (review?.required_approving_review_count ?? 0) < 1 ||
    !review?.dismiss_stale_reviews ||
    !review.require_last_push_approval ||
    Object.values(review.bypass_pull_request_allowances ?? {}).some(
      (v) => !Array.isArray(v) || v.length !== 0,
    ) ||
    !p.required_conversation_resolution?.enabled ||
    p.allow_force_pushes?.enabled !== false ||
    p.allow_deletions?.enabled !== false
  )
    throw new TypeError(
      "Canonical payment release requires verified strict protected develop, required reservation check, review, and no bypass/force-push/deletion",
    );
}
export function verifyPaymentAuthority(root: string): string {
  const remote = reservationGit(root, ["remote", "get-url", "origin"])
    .toString()
    .trim();
  if (
    ![
      "https://github.com/SlopDotCash/slopdotcash.git",
      "git@github.com:SlopDotCash/slopdotcash.git",
    ].includes(remote)
  )
    throw new TypeError("Reservation authority must be the canonical origin");
  const app = reservationGithub("apps/github-actions") as {
    id?: number;
    slug?: string;
  };
  if (
    app.slug !== "github-actions" ||
    !Number.isSafeInteger(app.id) ||
    Number(app.id) <= 0
  )
    throw new TypeError("Cannot verify required check publisher");
  assertPaymentBranchProtection(
    reservationGithub(
      `repos/${PAYMENT_REPOSITORY}/branches/develop/protection`,
    ),
    app.id,
  );
  reservationGit(root, [
    "fetch",
    "--no-tags",
    "origin",
    "+refs/heads/develop:refs/remotes/origin/develop",
  ]);
  const revision = reservationGit(root, [
    "rev-parse",
    "refs/remotes/origin/develop",
  ])
    .toString()
    .trim();
  const branch = reservationGithub(
    `repos/${PAYMENT_REPOSITORY}/branches/develop`,
  ) as {
    protected?: boolean;
    commit?: { sha?: string };
  };
  if (!branch.protected || branch.commit?.sha !== revision)
    throw new TypeError("Canonical develop moved or is not protected; retry");
  return revision;
}
