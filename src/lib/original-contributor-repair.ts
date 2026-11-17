import {
  githubLinkDestinations,
  sameRepositoryCommitHints,
} from "../../workers/slopbot/value-commit-hints";
import type { Comment, Pull } from "../../workers/slopbot/value-evidence-types";
import { isCreditEligibleCommitAuthor } from "./commit-credit";
import type {
  CorrectionCommit,
  CorrectionSource,
  OriginalContributorFollowup,
} from "./points-implementation-corrections";
import { sha256Hex } from "./sha256";

const sha = /^[a-f0-9]{40}$/u;
const digest = /^[a-f0-9]{64}$/u;
export interface OriginalContributorRepair {
  sourceId: string;
  commitSha: string;
  authorNodeId: string | null;
  reference: {
    sourceDigests: Record<string, string>;
    pull: Pull;
    acceptingPull: Pull & { created_at?: string };
    acknowledgement?: NonNullable<
      OriginalContributorFollowup["reference"]
    >["acknowledgement"];
    originalAcknowledgement?: {
      pull: Pull & { created_at: string };
      comment: Comment;
    };
    headSha: string;
    resolvedHead?: { hint: string; commitSha: string };
    bodyEdit?: {
      id: string;
      body: string;
      headRefOid: string;
      mergedAt: string;
      updatedAt: string;
      lastEditedAt: string | null;
      editor: { id: string; type: string } | null;
      author: { id: string; type: string };
    };
    historicalBodyEdit?: {
      id: string;
      createdAt: string;
      editedAt: string;
      updatedAt: string;
      deletedAt: null;
      diff: string;
      editor: { id: string; type: string };
      headCommit: { sha: string; committedAt: string };
    };
    digest: string;
  };
}
/** A resolved direct reference retains the authenticated carrier statement. */
export function referencesOriginalContributorSource(
  body: string,
  repository: string,
  number: number,
): boolean {
  const text = githubLinkDestinations(body).replace(
    /\[[^[\]\n]*\](?:\[[^[\]\n]*\])?/gu,
    " ",
  );
  return [
    ...text.matchAll(
      /(?:https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/|(?<![\w/?.:=&-])([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#)([1-9]\d*)\b/gu,
    ),
  ].some(
    (match) =>
      Number(match[3]) === number &&
      (match[1] ?? match[2] ?? repository).toLowerCase() ===
        repository.toLowerCase(),
  );
}

/** The accepting merger acknowledges a repair at its exact retained source head. */
export function isOriginalContributorRepair(
  repair: OriginalContributorRepair,
  original: CorrectionSource,
  accepted: CorrectionSource,
  commit: CorrectionCommit,
): boolean {
  const { digest: referenceDigest, ...reference } = repair.reference;
  const pull = reference.pull;
  const acknowledgement = reference.acknowledgement;
  const source = repair.sourceId === original.sourceId ? original : accepted;
  const historical = reference.historicalBodyEdit;
  const text = acknowledgement?.body ?? historical?.diff ?? pull.body ?? "";
  const bodyEdit = reference.bodyEdit;
  const resolvedHead = reference.resolvedHead;
  const headHints = sameRepositoryCommitHints(source.repository, text);
  const resolvedOriginalBodyHead =
    resolvedHead !== undefined &&
    repair.sourceId === original.sourceId &&
    acknowledgement === undefined &&
    historical === undefined &&
    bodyEdit !== undefined &&
    /^[a-f0-9]{7,39}$/u.test(resolvedHead.hint) &&
    headHints.includes(resolvedHead.hint) &&
    resolvedHead.commitSha === reference.headSha &&
    reference.headSha.startsWith(resolvedHead.hint);
  const bodyActor =
    bodyEdit?.lastEditedAt === null ? bodyEdit.author : bodyEdit?.editor;
  const actorId =
    acknowledgement?.user?.node_id ?? historical?.editor?.id ?? bodyActor?.id;
  const actorType =
    acknowledgement?.user?.type ?? historical?.editor?.type ?? bodyActor?.type;
  const occurredAt =
    acknowledgement?.created_at ??
    acknowledgement?.submitted_at ??
    historical?.editedAt ??
    bodyEdit?.lastEditedAt ??
    pull.updated_at;
  const edited = acknowledgement?.updated_at;
  const originalAcknowledgement = reference.originalAcknowledgement;
  const originalComment = originalAcknowledgement?.comment;
  const originalPull = originalAcknowledgement?.pull;
  const pairedNullRepair =
    commit.author === null &&
    repair.authorNodeId === null &&
    commit.parentCount <= 1 &&
    repair.sourceId === accepted.sourceId &&
    historical === undefined &&
    bodyEdit === undefined &&
    originalPull?.node_id === original.sourceId &&
    originalPull.html_url === original.sourceUrl &&
    Number.isSafeInteger(originalPull.number) &&
    originalPull.number > 0 &&
    original.sourceUrl.endsWith(`/pull/${originalPull.number}`) &&
    original.repository === accepted.repository &&
    original.repositoryNodeId === accepted.repositoryNodeId &&
    originalPull.head.sha === original.headSha &&
    originalPull.state === "closed" &&
    (original.occurredAt === null
      ? originalPull.merged_at === null
      : originalPull.merged_at !== null &&
        Date.parse(originalPull.merged_at) ===
          Date.parse(original.occurredAt)) &&
    originalComment?.user?.node_id ===
      reference.acceptingPull.merged_by?.node_id &&
    originalComment?.user?.type === "User" &&
    originalComment.node_id.length > 0 &&
    originalComment.html_url.startsWith(
      `${original.sourceUrl}#issuecomment-`,
    ) &&
    /^\d+$/u.test(originalComment.html_url.split("#issuecomment-")[1] ?? "") &&
    originalComment.created_at === originalComment.updated_at &&
    Number.isFinite(Date.parse(originalPull.created_at)) &&
    Number.isFinite(Date.parse(reference.acceptingPull.created_at ?? "")) &&
    Date.parse(originalComment.created_at) >=
      Date.parse(originalPull.created_at) &&
    Date.parse(occurredAt ?? "") >=
      Date.parse(reference.acceptingPull.created_at ?? "") &&
    Date.parse(originalComment.created_at) <= Date.parse(occurredAt ?? "") &&
    Date.parse(occurredAt ?? "") <= Date.parse(accepted.occurredAt ?? "") &&
    referencesOriginalContributorSource(
      originalComment.body,
      accepted.repository,
      reference.acceptingPull.number,
    ) &&
    typeof acknowledgement?.html_url === "string" &&
    acknowledgement.html_url.startsWith(
      `${accepted.sourceUrl}#issuecomment-`,
    ) &&
    /^\d+$/u.test(acknowledgement.html_url.split("#issuecomment-")[1] ?? "");
  const linkedRepair =
    originalAcknowledgement === undefined &&
    repair.authorNodeId === commit.author?.id &&
    commit.author?.kind === "User" &&
    /^[A-Za-z0-9_=-]{4,256}$/u.test(commit.author.id) &&
    isCreditEligibleCommitAuthor(commit.author);
  return (
    (repair.sourceId === original.sourceId ||
      repair.sourceId === accepted.sourceId) &&
    repair.commitSha === commit.sha &&
    (pairedNullRepair || linkedRepair) &&
    Object.keys(reference.sourceDigests).length === 2 &&
    digest.test(reference.sourceDigests[original.sourceId] ?? "") &&
    digest.test(reference.sourceDigests[accepted.sourceId] ?? "") &&
    pull.node_id === source.sourceId &&
    Number.isSafeInteger(pull.number) &&
    pull.number > 0 &&
    source.sourceUrl.endsWith(`/pull/${pull.number}`) &&
    pull.html_url === source.sourceUrl &&
    pull.head.sha === source.headSha &&
    pull.state === "closed" &&
    (source.occurredAt === null
      ? pull.merged_at === null
      : pull.merged_at !== null &&
        Date.parse(pull.merged_at) === Date.parse(source.occurredAt)) &&
    accepted.occurredAt !== null &&
    actorType === "User" &&
    reference.acceptingPull.node_id === accepted.sourceId &&
    Number.isSafeInteger(reference.acceptingPull.number) &&
    accepted.sourceUrl.endsWith(`/pull/${reference.acceptingPull.number}`) &&
    reference.acceptingPull.head.sha === accepted.headSha &&
    reference.acceptingPull.html_url === accepted.sourceUrl &&
    reference.acceptingPull.merged_at !== null &&
    Date.parse(reference.acceptingPull.merged_at) ===
      Date.parse(accepted.occurredAt) &&
    reference.acceptingPull.merged_by?.type === "User" &&
    actorId === reference.acceptingPull.merged_by.node_id &&
    Number.isFinite(Date.parse(occurredAt ?? "")) &&
    Date.parse(occurredAt ?? "") <= Date.parse(pull.updated_at) &&
    (acknowledgement !== undefined ||
      Date.parse(occurredAt ?? "") <= Date.parse(accepted.occurredAt)) &&
    (historical === undefined ||
      (acknowledgement === undefined &&
        repair.sourceId === accepted.sourceId &&
        typeof historical.id === "string" &&
        historical.id.length > 0 &&
        historical.deletedAt === null &&
        historical.editor?.type === "User" &&
        historical.editor.id === reference.acceptingPull.merged_by?.node_id &&
        historical.createdAt === historical.editedAt &&
        historical.updatedAt === historical.editedAt &&
        typeof historical.diff === "string" &&
        historical.diff.length > 0 &&
        historical.headCommit?.sha === reference.headSha &&
        Number.isFinite(Date.parse(historical.headCommit.committedAt)) &&
        Date.parse(historical.headCommit.committedAt) <=
          Date.parse(historical.editedAt))) &&
    (acknowledgement === undefined || acknowledgement.node_id.length > 0) &&
    (edited === undefined || edited === occurredAt) &&
    (acknowledgement !== undefined ||
      (bodyEdit?.id === pull.node_id &&
        bodyEdit.body === pull.body &&
        bodyEdit.headRefOid === pull.head.sha &&
        bodyEdit.mergedAt === pull.merged_at &&
        bodyEdit.updatedAt === pull.updated_at)) &&
    digest.test(referenceDigest) &&
    sha256Hex(JSON.stringify(reference)) === referenceDigest &&
    sha.test(reference.headSha) &&
    (pairedNullRepair ||
      repair.sourceId === original.sourceId ||
      referencesOriginalContributorSource(
        text,
        original.repository,
        Number(original.sourceUrl.split("/").at(-1)),
      )) &&
    (resolvedHead === undefined || resolvedOriginalBodyHead) &&
    (headHints.includes(reference.headSha) || resolvedOriginalBodyHead) &&
    (reference.headSha === original.headSha ||
      reference.headSha === accepted.headSha)
  );
}
