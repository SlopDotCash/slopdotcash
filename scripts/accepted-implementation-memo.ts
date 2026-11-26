/** Trusted collection's private cache of GitHub observations and native proofs. */
import { sha256Hex } from "../src/lib/sha256";
import {
  type AcceptedImplementationSource,
  acceptedOrdinaryCommitOid,
} from "./accepted-implementation-digests";
import type { AcceptedImplementationPredecessor } from "./accepted-implementation-history";
import {
  COLLECTION_MEMO_FULL_INTERVAL_MS,
  IMPLEMENTATION_MEMO_AUDIT_ONE_IN,
  IMPLEMENTATION_MEMO_CHANGED_CODE_AUDIT_ONE_IN,
  IMPLEMENTATION_MEMO_RULES_VERSION,
} from "./collection-memo";

export type PreviousImplementationObservation =
  | { kind: "ineligible" }
  | { kind: "accepted-ordinary"; source: AcceptedImplementationSource }
  | { kind: "candidate"; shape: string; source: AcceptedImplementationSource };

interface PreviousEntry {
  repositoryNodeId: string;
  prior: AcceptedImplementationPredecessor;
  observation: PreviousImplementationObservation;
  // A new observation gets the producer's timestamp when serialized.
  observedAt: string | null;
}

interface DigestEntry {
  repositoryNodeId: string;
  source: AcceptedImplementationSource;
  digest: string;
  observedAt: string | null;
}

const FORMAT = "slop-accepted-implementation-memo-v3";

/**
 * A saved entry read again live came out differently. Every saved entry has
 * been discarded; the caller reads the evidence again with nothing saved.
 */
export class ImplementationMemoAuditError extends Error {
  constructor() {
    super("A saved accepted implementation entry differs from its live read");
    this.name = "ImplementationMemoAuditError";
  }
}
const MAX_BYTES = 512 * 1024 * 1024;
const MAX_ROWS = 200_000;
const NODE_ID = /^[A-Za-z0-9_=+/-]{1,256}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const EMPTY_CHANGE = sha256Hex("");
const PULL_URL =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)$/u;

function invalid(field: string): never {
  throw new Error(`Invalid accepted implementation memo: ${field}`);
}

function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("expected object");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(row, key))
  )
    invalid("unexpected fields");
  return row;
}

function string(value: unknown, pattern: RegExp, field: string): string {
  if (typeof value !== "string" || !pattern.test(value)) invalid(field);
  return value;
}

function instant(value: unknown): string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    invalid("timestamp");
  return value;
}

function parsePredecessor(value: unknown): AcceptedImplementationPredecessor {
  const row = record(value, ["id", "number", "url", "mergedAt"]);
  const url = string(row.url, PULL_URL, "pull request URL");
  const match = PULL_URL.exec(url);
  if (
    !match ||
    [match[1], match[2]].some((part) => part === "." || part === "..") ||
    typeof row.number !== "number" ||
    !Number.isSafeInteger(row.number) ||
    String(row.number) !== match[3]
  )
    invalid("pull request number");
  return {
    id: string(row.id, NODE_ID, "pull request node ID"),
    number: row.number,
    url,
    mergedAt: instant(row.mergedAt),
  };
}

function parseSource(value: unknown): AcceptedImplementationSource {
  const row = record(value, [
    "id",
    "headSha",
    "mergeSha",
    "mergeParentShas",
    "mergeTreeSha",
    "firstParentTreeSha",
  ]);
  if (
    !Array.isArray(row.mergeParentShas) ||
    ![1, 2].includes(row.mergeParentShas.length)
  )
    invalid("acceptance parents");
  const mergeParentShas = row.mergeParentShas.map((part) =>
    string(part, SHA, "acceptance parent"),
  );
  const headSha = string(row.headSha, SHA, "submitted head");
  const mergeSha = string(row.mergeSha, SHA, "accepted commit");
  const mergeTreeSha = string(row.mergeTreeSha, SHA, "accepted tree");
  const firstParentTreeSha = string(
    row.firstParentTreeSha,
    SHA,
    "first-parent tree",
  );
  if (
    mergeParentShas.includes(mergeSha) ||
    mergeParentShas[0] === headSha ||
    (mergeParentShas.length === 2 && mergeParentShas[1] !== headSha) ||
    mergeTreeSha === firstParentTreeSha
  )
    invalid("acceptance topology");
  return {
    id: string(row.id, NODE_ID, "pull request node ID"),
    headSha,
    mergeSha,
    mergeParentShas,
    mergeTreeSha,
    firstParentTreeSha,
  };
}

function parseObservation(
  value: unknown,
  expectedSource: string,
): PreviousImplementationObservation {
  if ((value as { kind?: unknown } | null)?.kind === "ineligible") {
    record(value, ["kind"]);
    return { kind: "ineligible" };
  }
  if ((value as { kind?: unknown } | null)?.kind === "accepted-ordinary") {
    const row = record(value, ["kind", "source"]);
    const source = parseSource(row.source);
    if (source.id !== expectedSource || !acceptedOrdinaryCommitOid(source))
      invalid("ordinary accepted identity");
    return { kind: "accepted-ordinary", source };
  }
  const row = record(value, ["kind", "shape", "source"]);
  if (row.kind !== "candidate") invalid("observation kind");
  const shape = string(
    row.shape,
    /^(0|[1-9][0-9]*)(\/(0|[1-9][0-9]*)){2}$/u,
    "candidate shape",
  );
  if (shape.split("/").some((part) => !Number.isSafeInteger(Number(part))))
    invalid("candidate shape");
  const source = parseSource(row.source);
  if (source.id !== expectedSource) invalid("candidate pull request identity");
  return { kind: "candidate", shape, source };
}

function previousKey(
  repositoryNodeId: string,
  prior: AcceptedImplementationPredecessor,
): string {
  return JSON.stringify([
    repositoryNodeId,
    prior.id,
    prior.number,
    prior.url,
    prior.mergedAt,
  ]);
}

function digestKey(
  repositoryNodeId: string,
  source: AcceptedImplementationSource,
): string {
  return JSON.stringify([
    repositoryNodeId,
    source.id,
    source.headSha,
    source.mergeSha,
    source.mergeParentShas,
    source.mergeTreeSha,
    source.firstParentTreeSha,
  ]);
}

function observedAt(value: unknown, producedAt: string): string {
  const observed = instant(value);
  if (Date.parse(observed) > Date.parse(producedAt))
    invalid("observation is in the future");
  return observed;
}

function recent(observedAt: string, now: number): boolean {
  const age = now - Date.parse(observedAt);
  return age >= 0 && age <= COLLECTION_MEMO_FULL_INTERVAL_MS;
}

function rows(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS)
    invalid("too many rows");
  return value;
}

function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function storeRows<T extends { observedAt: string | null }>(
  entries: ReadonlyMap<string, T>,
  producedAt: string,
  retain: (entry: T) => boolean = () => true,
): (T & { observedAt: string })[] {
  return [...entries]
    .filter(([, entry]) => retain(entry))
    .map(
      ([key, entry]) =>
        [
          key,
          {
            ...entry,
            observedAt: observedAt(entry.observedAt ?? producedAt, producedAt),
          },
        ] as const,
    )
    .sort(
      ([leftKey, left], [rightKey, right]) =>
        compare(right.observedAt, left.observedAt) ||
        compare(leftKey, rightKey),
    )
    .slice(0, MAX_ROWS)
    .sort(([left], [right]) => compare(left, right))
    .map(([, entry]) => entry);
}

export class ImplementationMemo {
  readonly #previous = new Map<string, PreviousEntry>();
  readonly #digests = new Map<string, DigestEntry>();
  #codeDigest: string | undefined;
  #auditSeed = "";
  /** About one reused saved entry in this many is also read live. */
  auditOneIn = IMPLEMENTATION_MEMO_AUDIT_ONE_IN;
  readonly stats = {
    digestsReused: 0,
    digestsRead: 0,
    previousReused: 0,
    previousRead: 0,
    audited: 0,
    auditMismatches: 0,
  };

  /**
   * A memo written under other code is kept: its entries are facts about
   * immutable Git objects and merged pull requests. Only another rules
   * version discards it; changed code enlarges the audit sample instead.
   */
  static parse(
    bytes: string,
    codeDigest: string,
    now: Date,
    rulesVersion: number = IMPLEMENTATION_MEMO_RULES_VERSION,
  ): ImplementationMemo {
    if (Buffer.byteLength(bytes, "utf8") > MAX_BYTES)
      invalid("file is too large");
    const value = record(JSON.parse(bytes), [
      "format",
      "rulesVersion",
      "codeDigest",
      "producedAt",
      "previous",
      "digests",
    ]);
    if (value.format !== FORMAT || value.rulesVersion !== rulesVersion)
      invalid("format or rules version");
    const writtenUnder = string(value.codeDigest, DIGEST, "code digest");
    string(codeDigest, DIGEST, "code digest");
    const producedAt = instant(value.producedAt);
    if (!recent(producedAt, now.getTime())) invalid("stale or future artifact");
    const memo = new ImplementationMemo();
    memo.#codeDigest = codeDigest;
    memo.#auditSeed = producedAt;
    if (writtenUnder !== codeDigest)
      memo.auditOneIn = IMPLEMENTATION_MEMO_CHANGED_CODE_AUDIT_ONE_IN;
    for (const entry of rows(value.digests)) {
      const row = record(entry, [
        "repositoryNodeId",
        "source",
        "digest",
        "observedAt",
      ]);
      const repositoryNodeId = string(
        row.repositoryNodeId,
        NODE_ID,
        "repository node ID",
      );
      const source = parseSource(row.source);
      const digest = string(row.digest, DIGEST, "native digest");
      const key = digestKey(repositoryNodeId, source);
      if (digest === EMPTY_CHANGE || memo.#digests.has(key))
        invalid("empty or repeated native digest");
      memo.#digests.set(key, {
        repositoryNodeId,
        source,
        digest,
        observedAt: observedAt(row.observedAt, producedAt),
      });
    }
    const seen = new Set<string>();
    for (const entry of rows(value.previous)) {
      const row = record(entry, [
        "repositoryNodeId",
        "prior",
        "observation",
        "observedAt",
      ]);
      const repositoryNodeId = string(
        row.repositoryNodeId,
        NODE_ID,
        "repository node ID",
      );
      const prior = parsePredecessor(row.prior);
      const observation = parseObservation(row.observation, prior.id);
      const observed = observedAt(row.observedAt, producedAt);
      if (Date.parse(prior.mergedAt) > Date.parse(observed))
        invalid("pull request is in the future");
      const key = previousKey(repositoryNodeId, prior);
      if (seen.has(key)) invalid("repeated pull request observation");
      seen.add(key);
      if (
        recent(observed, now.getTime()) ||
        memo.#hasNativeProof(repositoryNodeId, observation)
      )
        memo.#previous.set(key, {
          repositoryNodeId,
          prior,
          observation,
          observedAt: observed,
        });
    }
    return memo;
  }

  #hasNativeProof(
    repositoryNodeId: string,
    observation: PreviousImplementationObservation,
  ): boolean {
    return (
      observation.kind === "candidate" &&
      this.#digests.has(digestKey(repositoryNodeId, observation.source))
    );
  }

  /** Recollect live metadata after a failed census while retaining native proofs. */
  beginPass(): void {
    this.#resetReuseCounts();
    for (const [key, entry] of this.#previous) {
      if (entry.observedAt === null) this.#previous.delete(key);
    }
  }

  serialize(codeDigest: string, producedAt: string): string {
    string(codeDigest, DIGEST, "code digest");
    if (this.#codeDigest !== undefined && this.#codeDigest !== codeDigest)
      invalid("cannot change the evidence code digest");
    this.#codeDigest = codeDigest;
    const now = Date.parse(instant(producedAt));
    const previous = storeRows(
      this.#previous,
      producedAt,
      ({ prior, observedAt, repositoryNodeId, observation }) => {
        if (Date.parse(prior.mergedAt) > Date.parse(observedAt ?? producedAt))
          invalid("pull request is in the future");
        // Old observations need a fresh read unless exact native proof was
        // retained. Current canonical prior Points are checked by the caller.
        return (
          observedAt === null ||
          recent(observedAt, now) ||
          this.#hasNativeProof(repositoryNodeId, observation)
        );
      },
    );
    const bytes = `${JSON.stringify({
      format: FORMAT,
      rulesVersion: IMPLEMENTATION_MEMO_RULES_VERSION,
      codeDigest,
      producedAt,
      previous,
      digests: storeRows(this.#digests, producedAt),
    })}\n`;
    if (Buffer.byteLength(bytes, "utf8") > MAX_BYTES)
      invalid("file is too large");
    for (const entry of this.#previous.values())
      entry.observedAt ??= producedAt;
    for (const entry of this.#digests.values()) entry.observedAt ??= producedAt;
    return bytes;
  }

  /**
   * Whether a saved entry for this pull request is in this run's audit
   * sample. Deterministic for one restored memo; entries read in this run are
   * never audited.
   */
  audits(repositoryNodeId: string, pullRequestId: string): boolean {
    if (!this.#auditSeed) return false;
    if (!Number.isSafeInteger(this.auditOneIn) || this.auditOneIn < 1)
      invalid("audit rate");
    return (
      Number.parseInt(
        sha256Hex(
          `${this.#auditSeed}\0${repositoryNodeId}\0${pullRequestId}`,
        ).slice(0, 8),
        16,
      ) %
        this.auditOneIn ===
      0
    );
  }

  /** Compare a saved observation with a definitive live one. */
  auditPrevious(
    saved: PreviousImplementationObservation,
    prior: AcceptedImplementationPredecessor,
    live: PreviousImplementationObservation,
  ): void {
    this.#audit(
      JSON.stringify(parseObservation(saved, prior.id)) ===
        JSON.stringify(parseObservation(live, prior.id)),
    );
  }

  /** Compare a saved native digest with a definitive live result. */
  auditDigest(saved: string, live: string | undefined): void {
    this.#audit(saved === live);
  }

  #resetReuseCounts(): void {
    this.stats.digestsReused = 0;
    this.stats.digestsRead = 0;
    this.stats.previousReused = 0;
    this.stats.previousRead = 0;
  }

  #audit(same: boolean): void {
    this.stats.audited += 1;
    if (same) return;
    this.stats.auditMismatches += 1;
    this.#resetReuseCounts();
    // One difference means the saved entries cannot be trusted as a set.
    for (const [key, entry] of this.#previous)
      if (entry.observedAt !== null) this.#previous.delete(key);
    for (const [key, entry] of this.#digests)
      if (entry.observedAt !== null) this.#digests.delete(key);
    this.#auditSeed = "";
    throw new ImplementationMemoAuditError();
  }

  previous(
    repositoryNodeId: string,
    prior: AcceptedImplementationPredecessor,
  ): PreviousImplementationObservation | undefined {
    const entry = this.#previous.get(previousKey(repositoryNodeId, prior));
    return entry && structuredClone(entry.observation);
  }

  rememberPrevious(
    repositoryNodeId: string,
    prior: AcceptedImplementationPredecessor,
    observation: PreviousImplementationObservation,
  ): void {
    string(repositoryNodeId, NODE_ID, "repository node ID");
    const source = parsePredecessor(prior);
    this.#previous.set(previousKey(repositoryNodeId, source), {
      repositoryNodeId,
      prior: source,
      observation: parseObservation(observation, source.id),
      observedAt: null,
    });
  }

  digest(
    repositoryNodeId: string,
    source: AcceptedImplementationSource,
  ): string | undefined {
    return this.#digests.get(digestKey(repositoryNodeId, source))?.digest;
  }

  rememberDigest(
    repositoryNodeId: string,
    source: AcceptedImplementationSource,
    digest: string,
  ): void {
    string(repositoryNodeId, NODE_ID, "repository node ID");
    const accepted = parseSource(source);
    string(digest, DIGEST, "native digest");
    const key = digestKey(repositoryNodeId, accepted);
    const existing = this.#digests.get(key);
    if (digest === EMPTY_CHANGE || (existing && existing.digest !== digest))
      invalid("empty or contradictory native digest");
    this.#digests.set(key, {
      repositoryNodeId,
      source: accepted,
      digest,
      observedAt: null,
    });
  }
}
