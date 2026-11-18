// spec/operations/notifications.md, "Story: Read, acknowledge and escalate private case notices"
import type { InboxNotice, NotificationsPage } from "@repo/operations/client";
import type { DisputeDetail, DisputedAwards } from "@repo/points/client";
import type { IncompleteAssessments } from "@repo/slopbot/client";

export type AwardList = typeof DisputedAwards.Type;
export type Dispute = typeof DisputeDetail.Type;

const at = "2026-11-17T09:30:00.000Z";

export const notices = {
  caseNotice: {
    eventKey: "security-case:sc_7f3a91c2d4e5b6a7:4",
    kind: "security_case",
    subject: "sc_7f3a91c2d4e5b6a7",
    detail: "The reporter answered your request for information.",
    actionPath: "/inbox?view=reports&case=sc_7f3a91c2d4e5b6a7",
    sourceAt: at,
    createdAt: at,
    readAt: null,
    acknowledgedAt: null,
    emailDelivery: "delivered",
  },
  payment: {
    eventKey: "payment-paid:acme-vault:2026-10",
    kind: "payment_paid",
    subject: "acme-vault",
    detail: null,
    actionPath: "/payouts",
    sourceAt: "2026-11-16T12:00:00.000Z",
    createdAt: "2026-11-16T12:00:00.000Z",
    readAt: "2026-11-16T13:00:00.000Z",
    emailDelivery: "failed",
  },
  appeal: {
    eventKey: "appeal-review:appeal:node-5:revision",
    kind: "slopbot_appeal_review",
    subject: "example/project",
    detail: "A contribution appeal needs your decision on GitHub.",
    actionPath: "/api/v1/notifications/appeals/appeal%3Anode-5%3Arevision",
    sourceAt: at,
    createdAt: at,
    readAt: null,
  },
  acknowledged: {
    eventKey: "security-case:sc_0a1b2c3d4e5f6a7b:2",
    kind: "security_case",
    subject: "sc_0a1b2c3d4e5f6a7b",
    detail: null,
    actionPath: "/inbox?view=reports&case=sc_0a1b2c3d4e5f6a7b",
    sourceAt: "2026-11-15T08:00:00.000Z",
    createdAt: "2026-11-15T08:00:00.000Z",
    readAt: "2026-11-15T09:00:00.000Z",
    acknowledgedAt: "2026-11-15T09:00:00.000Z",
  },
} satisfies Record<string, InboxNotice>;

export const inboxPage: NotificationsPage = {
  recipientGithubId: "7",
  nextCursor: null,
  notifications: [notices.caseNotice, notices.appeal, notices.payment, notices.acknowledged],
  unread: 2,
};

export const emptyInbox: NotificationsPage = { recipientGithubId: "7", nextCursor: null, notifications: [], unread: 0 };

export const queueReadAt = Date.parse(at);

export const queue: IncompleteAssessments = {
  recipientGithubId: "7",
  items: [
    { projectId: "acme-vault", projectName: "Acme Vault", repository: "acme/vault", pullRequest: 42, since: "2026-11-16T10:00:00.000Z", retryAt: "2026-11-17T12:00:00.000Z", running: false },
    { projectId: "acme-vault", projectName: "Acme Vault", repository: "acme/vault-cli", pullRequest: 7, since: "2026-11-16T11:00:00.000Z", retryAt: null, running: true },
    { projectId: "slop-cli", projectName: "slop-cli", repository: "slop/cli", pullRequest: 311, since: "2026-11-17T08:00:00.000Z", retryAt: null, running: false },
  ],
  next: "eyJhIjoxfQ",
};

const digest = (fill: string) => fill.repeat(64);

const award = {
  key: digest("a"),
  actor: { id: "MDQ6VXNlcjc=", login: "octo" },
  projectId: "acme-vault",
  category: "merged-pull-request",
  amount: 1250,
  occurredAt: "2026-11-02T15:04:00.000Z",
  sourceId: "PR_kwDOacme42",
  sourceUrl: "https://github.com/acme/vault/pull/42",
  workUnitId: "acme/vault#42",
  provisional: false,
} as const;

export const awards: AwardList = {
  awards: [
    { revisionId: digest("b"), disputeId: null, award },
    { revisionId: digest("c"), disputeId: `points-dispute:${digest("d")}`, award: { ...award, key: digest("e"), amount: 300, sourceUrl: "https://github.com/acme/vault/pull/43" } },
  ],
  next: "12",
};

export const dispute: Dispute = {
  id: `points-dispute:${digest("d")}`,
  openedAt: "2026-11-10T10:00:00.000Z",
  dueAt: "2026-11-17T10:00:00.000Z",
  draft: "deny",
  escalatedAt: "2026-11-10T10:05:00.000Z",
  resolution: null,
  resolvedAt: null,
  state: "review",
  revision: { id: digest("c"), previous: null, recordedAt: "2026-11-02T16:00:00.000Z", sourceDigest: digest("f"), sourceRule: "slop-score-v2", award: { ...award, amount: 300 } },
  reason: "The pull request was reverted the next day.",
  resolutionReason: null,
  mayDecide: true,
};
