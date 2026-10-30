// Slopbot GitHub App service (protocol/slopbot-v2.md).
// fetch: verify and deduplicate webhooks, then enqueue identifiers only.
// queue: re-read GitHub state and run the review pipeline.
import { readLimitedBody } from "../../backend/trace/validation";
import { dispatchDueAppeals } from "./appeals";
import { resumeBudgetBlocks } from "./budget-blocks";
import { APPEAL_COMMANDS, type Job } from "./contracts";
import { dispatchFailureAlert } from "./failure-alerts";
import { verifyWebhookSignature } from "./github";
import { dispatchMaintainerHolds } from "./maintainer-holds";
import { activePenaltyPage } from "./penalties";
import * as store from "./persistence";
import { QUALITY_MARKER } from "./quality";
import {
  registeredHistoryProject,
  registeredHistoryRepository,
  registeredRepository,
  reversalOnlyRegistration,
  reviewRegistration,
} from "./registry";
import { type ReopenItem, recordReopenSource } from "./reopen-source";
import { routeRepositoryAccess } from "./repository-access";
import {
  applyAppealCommand,
  applyMaintainerHold,
  escalateDueAppeal,
  recordHumanSignal,
  reviewItem,
} from "./review";
import { dispatchSpendAlert } from "./spend-alerts";
import {
  consumePendingValueRequests,
  type ValueConsumerEnv,
} from "./value-consumer";
import { valueHistory } from "./value-journal";
import { recordValueRequest } from "./value-requests";
import { workUnitHistory } from "./value-work-unit-journal";

type Queue = { send(body: Job): Promise<void> };
type Env = Omit<ValueConsumerEnv, "SLOPBOT_DB"> & {
  SLOPBOT_DB: store.D1TransactionalDatabase;
  SLOPBOT_WEBHOOK_SECRET: string;
  SLOPBOT_QUEUE: Queue;
  SLOP_NOTIFY?: { fetch(request: Request): Promise<Response> };
};

const MAX_WEBHOOK_BYTES = 25 * 1024 * 1024;
const REVIEW_ACTIONS: Record<string, ReadonlySet<string>> = {
  issues: new Set(["opened", "edited"]),
  pull_request: new Set([
    "opened",
    "edited",
    "synchronize",
    "ready_for_review",
  ]),
};

const VALUE_ACTIONS: Record<string, ReadonlySet<string>> = {
  pull_request: new Set(["closed", "reopened", "edited", "synchronize"]),
  pull_request_review: new Set(["submitted", "edited", "dismissed"]),
  pull_request_review_comment: new Set(["created", "edited", "deleted"]),
  issue_comment: new Set(["created", "edited", "deleted"]),
};

type Payload = {
  action?: string;
  installation?: {
    id: number;
    account?: { id: number; login: string; type: string };
    updated_at?: string | number;
  };
  repository?: {
    id: number;
    name: string;
    private: boolean;
    owner: { login: string };
  };
  sender?: { id: number; type: string };
  issue?: ReopenItem & { number: number; pull_request?: unknown };
  pull_request?: ReopenItem & { number: number };
  comment?: { body: string; id?: number };
};

export function jobFor(
  event: string,
  deliveryId: string,
  payload: Payload,
  appUserId: string,
): Job | null {
  const { installation, repository, sender, action } = payload;
  if (
    installation === undefined ||
    repository === undefined ||
    repository.private !== false ||
    sender === undefined ||
    action === undefined
  )
    return null;
  const qualityReceipt =
    event === "issue_comment" &&
    action === "created" &&
    payload.comment?.body.startsWith(`${QUALITY_MARKER}\n`) &&
    Number.isSafeInteger(payload.comment.id) &&
    Number(payload.comment.id) > 0;
  if (String(sender.id) === appUserId && !qualityReceipt) return null;
  const base = {
    deliveryId,
    installationId: installation.id,
    repositoryId: repository.id,
    owner: repository.owner.login,
    repo: repository.name,
  };
  const item =
    event === "pull_request" && payload.pull_request !== undefined
      ? {
          itemKind: "pull_request" as const,
          number: payload.pull_request.number,
        }
      : payload.issue !== undefined
        ? {
            itemKind:
              payload.issue.pull_request === undefined
                ? ("issue" as const)
                : ("pull_request" as const),
            number: payload.issue.number,
          }
        : null;
  if (item === null) return null;
  if (event === "issue_comment") {
    if (qualityReceipt && item.itemKind === "pull_request")
      return {
        kind: "review",
        ...base,
        ...item,
        qualityCommentId: payload.comment?.id,
      };
    if (action !== "created") return null;
    const text = (payload.comment?.body ?? "").trim();
    if (/^\/slopbot dispute(?:\s|$)/u.test(text))
      return {
        kind: "appeal",
        subject: "value",
        ...base,
        ...item,
        senderId: sender.id,
      };
    if (text.startsWith("/slopbot appeal"))
      return { kind: "appeal", ...base, ...item, senderId: sender.id };
    const command = APPEAL_COMMANDS.find(
      (name) =>
        text === `/slopbot ${name}` ||
        text.startsWith(`/slopbot ${name}\n`) ||
        text.startsWith(`/slopbot ${name} `),
    );
    if (command === undefined) return null;
    const target = text.slice(`/slopbot ${command}`.length).trim();
    if (
      /^(?:appeal|value-appeal):/u.test(target) &&
      !/^(?:appeal|value-appeal):[A-Za-z0-9_:=.-]{1,180}$/u.test(target)
    )
      return null;
    const appealKey = /^(?:appeal|value-appeal):[A-Za-z0-9_:=.-]{1,180}$/u.test(
      target,
    )
      ? target
      : undefined;
    return {
      kind: "appeal_command",
      command,
      ...(appealKey ? { appealKey } : {}),
      ...base,
      ...item,
      senderId: sender.id,
    };
  }
  if (action === "reopened")
    return { kind: "human_reopen", ...base, ...item, senderId: sender.id };
  if (REVIEW_ACTIONS[event]?.has(action))
    return { kind: "review", ...base, ...item };
  return null;
}

const INSTALLATION_STATES = new Map<string, "removed" | "suspended" | "active">(
  [
    ["deleted", "removed"],
    ["suspend", "suspended"],
    ["unsuspend", "active"],
  ],
);
async function handleInstallation(
  env: Env,
  payload: Payload,
  deliveryId: string,
) {
  const installation = payload.installation;
  if (installation?.account === undefined) {
    await store.completeInstallationDelivery(env.SLOPBOT_DB, deliveryId, null);
    return;
  }
  const rawUpdatedAt = installation.updated_at;
  const sourceUpdatedAt =
    typeof rawUpdatedAt === "number"
      ? rawUpdatedAt * 1000
      : typeof rawUpdatedAt === "string"
        ? Date.parse(rawUpdatedAt)
        : Number.NaN;
  if (!Number.isSafeInteger(sourceUpdatedAt) || sourceUpdatedAt < 0) {
    throw new Error("installation.updated_at is invalid");
  }
  const identity = { id: installation.id, account: installation.account };
  const state = INSTALLATION_STATES.get(payload.action ?? "");
  await store.completeInstallationDelivery(
    env.SLOPBOT_DB,
    deliveryId,
    payload.action === "created" ||
      payload.action === "new_permissions_accepted"
      ? { kind: "upsert", installation: identity, sourceUpdatedAt }
      : state
        ? { kind: "state", installation: identity, state, sourceUpdatedAt }
        : null,
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ service: "slopbot", ok: true });
    }
    if (request.method === "GET" && url.pathname === "/v1/penalties") {
      // The score producer's read of unreversed debits (PRD section 7). The
      // published score applies each one once; a reversal removes it.
      const project = url.searchParams.get("project") ?? "";
      const after = url.searchParams.get("after") ?? "";
      const history = url.searchParams.get("history");
      if (
        !/^[A-Za-z0-9_=-]{0,100}$/u.test(after) ||
        (history !== null && history !== "1")
      )
        return Response.json(
          { error: "Invalid penalty query" },
          { status: 400 },
        );
      try {
        if (!(await registeredHistoryProject(env.SLOPBOT_DB, project)))
          return Response.json(
            { error: "Invalid penalty query" },
            { status: 400 },
          );
        return Response.json(
          {
            schemaVersion: history
              ? "slop-penalty-history:v1"
              : "slop-penalties:v1",
            project,
            ...(await activePenaltyPage(
              env.SLOPBOT_DB,
              project,
              after,
              history === "1",
            )),
          },
          {
            headers: {
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          },
        );
      } catch {
        console.error("slopbot penalty history unavailable");
        return Response.json(
          { error: "Penalties are unavailable" },
          { status: 503, headers: { "cache-control": "no-store" } },
        );
      }
    }
    const jointHistory = url.pathname === "/v1/work-unit-assessments";
    if (
      request.method === "GET" &&
      (jointHistory || url.pathname === "/v1/value-assessments")
    ) {
      const number = url.searchParams.get("pull") ?? "";
      const after = url.searchParams.get("after") ?? "0";
      const through = jointHistory ? url.searchParams.get("through") : null;
      const repositoryNodeId = url.searchParams.get("repositoryNodeId");
      if (
        (repositoryNodeId !== null &&
          (url.searchParams.has("repository") ||
            !/^[A-Za-z0-9_=-]{1,100}$/u.test(repositoryNodeId))) ||
        !/^[1-9][0-9]*$/u.test(number) ||
        !/^(0|[1-9][0-9]*)$/u.test(after) ||
        !Number.isSafeInteger(Number(number)) ||
        !Number.isSafeInteger(Number(after)) ||
        (jointHistory && Number(after) > 0 && through === null) ||
        (through !== null &&
          (!/^(0|[1-9][0-9]*)$/u.test(through) ||
            !Number.isSafeInteger(Number(through)) ||
            Number(through) < Number(after)))
      )
        return Response.json(
          { error: "Invalid value-history query" },
          { status: 400 },
        );
      try {
        const repository = await registeredHistoryRepository(
          env.SLOPBOT_DB,
          url.searchParams.get("repository") ?? "",
          repositoryNodeId,
        );
        if (repository === null)
          return Response.json(
            { error: "Invalid value-history query" },
            { status: 400 },
          );
        const history = jointHistory
          ? await workUnitHistory(
              env.SLOPBOT_DB,
              repository.id,
              Number(number),
              Number(after),
              through === null ? null : Number(through),
              repository.nodeId ?? undefined,
            )
          : await valueHistory(
              env.SLOPBOT_DB,
              repository.id,
              Number(number),
              Number(after),
              repository.nodeId ?? undefined,
            );
        return Response.json(
          {
            schemaVersion: jointHistory
              ? "slop-work-unit-history:v1"
              : "slop-value-history:v1",
            repository: repository.id,
            repositoryNodeId: repository.nodeId,
            pullRequestNumber: Number(number),
            ...history,
          },
          {
            headers: {
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          },
        );
      } catch {
        console.error("slopbot value history unavailable");
        return Response.json(
          { error: "Value history is unavailable" },
          { status: 503, headers: { "cache-control": "no-store" } },
        );
      }
    }
    const repositoryRoute = routeRepositoryAccess(request, env);
    if (repositoryRoute) return repositoryRoute;
    if (request.method !== "POST" || url.pathname !== "/github/webhook") {
      return new Response("not found", { status: 404 });
    }
    // The HMAC covers the exact received bytes. A missing or false
    // Content-Length never makes the read unbounded.
    let body: Uint8Array<ArrayBuffer>;
    try {
      // readLimitedBody returns a fresh, unshared buffer.
      body = (await readLimitedBody(
        request,
        MAX_WEBHOOK_BYTES,
      )) as Uint8Array<ArrayBuffer>;
    } catch {
      return new Response("payload too large", { status: 413 });
    }
    if (
      !(await verifyWebhookSignature(
        env.SLOPBOT_WEBHOOK_SECRET,
        body,
        request.headers.get("x-hub-signature-256"),
      ))
    ) {
      return new Response("invalid signature", { status: 401 });
    }
    const event = request.headers.get("x-github-event") ?? "";
    const deliveryId = request.headers.get("x-github-delivery") ?? "";
    if (deliveryId === "")
      return new Response("missing delivery id", { status: 400 });
    // Decode strictly before any durable write. A lossy decode would record
    // the delivery id, and a corrected redelivery would then be dropped.
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      return new Response("invalid body", { status: 400 });
    }
    let payload: Payload;
    try {
      payload = JSON.parse(text) as Payload;
      if (
        typeof payload !== "object" ||
        payload === null ||
        Array.isArray(payload)
      )
        return new Response("invalid payload", { status: 400 });
    } catch {
      return new Response("invalid JSON", { status: 400 });
    }
    if (event === "installation") {
      if (
        !(await store.claimInstallationDelivery(
          env.SLOPBOT_DB,
          deliveryId,
          event,
        ))
      ) {
        return new Response("duplicate delivery", { status: 202 });
      }
      await handleInstallation(env, payload, deliveryId);
      return new Response("ignored", { status: 202 });
    }
    if (!(await store.recordDelivery(env.SLOPBOT_DB, deliveryId, event))) {
      return new Response("duplicate delivery", { status: 202 });
    }
    try {
      // Changes to accepted outcomes and their reviews must survive restarts.
      // This receipt is pending assessment, never a successful valuation.
      let valuationPending = false;
      const valueNumber =
        event === "issue_comment"
          ? payload.issue?.pull_request
            ? payload.issue.number
            : undefined
          : payload.pull_request?.number;
      if (
        payload.action &&
        VALUE_ACTIONS[event]?.has(payload.action) &&
        payload.installation &&
        payload.repository &&
        valueNumber !== undefined
      ) {
        const request = {
          deliveryId,
          installationId: payload.installation.id,
          repositoryId: payload.repository.id,
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          number: valueNumber,
        };
        if (await registeredRepository(env.SLOPBOT_DB, request)) {
          await recordValueRequest(env.SLOPBOT_DB, request);
          valuationPending = true;
        }
      }
      const job = jobFor(event, deliveryId, payload, env.SLOPBOT_APP_USER_ID);
      if (job !== null) {
        // Paused projects stay registered: their review is security-only.
        // A retired project gets no review, but an appeal, a maintainer
        // reopen or a moderator decision may still reverse an existing
        // penalty there; the consumer permits nothing else.
        if (
          (await reviewRegistration(env.SLOPBOT_DB, job)) === null &&
          !(
            (job.kind === "appeal" ||
              job.kind === "human_reopen" ||
              job.kind === "appeal_command") &&
            (await reversalOnlyRegistration(env.SLOPBOT_DB, job)) !== null
          )
        ) {
          await store.completeDelivery(env.SLOPBOT_DB, deliveryId);
          return new Response(
            "repository is not registered in the Slop registry",
            { status: 202 },
          );
        }
        if (
          job.kind === "human_reopen" &&
          !(await recordReopenSource(
            env.SLOPBOT_DB,
            job,
            job.itemKind === "pull_request"
              ? payload.pull_request
              : payload.issue,
          ))
        ) {
          await store.completeDelivery(env.SLOPBOT_DB, deliveryId);
          return new Response("reopen source unavailable; no decision", {
            status: 202,
          });
        }
        await env.SLOPBOT_QUEUE.send(job);
      }
      await store.completeDelivery(env.SLOPBOT_DB, deliveryId);
      return new Response(
        job === null
          ? valuationPending
            ? "valuation pending"
            : "ignored"
          : "queued",
        {
          status: 202,
        },
      );
    } catch (error) {
      await store.releaseDelivery(env.SLOPBOT_DB, deliveryId);
      throw error;
    }
  },

  async scheduled(_event: unknown, env: Env) {
    // Independent dispatchers and assessment must progress even when another
    // task fails. Their journals retain retries; the invocation still fails.
    const outcomes = await Promise.allSettled([
      resumeBudgetBlocks(env.SLOPBOT_DB, env.SLOPBOT_QUEUE),
      dispatchMaintainerHolds(env.SLOPBOT_DB, env.SLOPBOT_QUEUE),
      dispatchDueAppeals(env.SLOPBOT_DB, env.SLOPBOT_QUEUE),
      consumePendingValueRequests(env),
      ...(env.SLOP_NOTIFY
        ? [
            dispatchSpendAlert(env.SLOPBOT_DB, env.SLOP_NOTIFY),
            dispatchFailureAlert(env.SLOPBOT_DB, env.SLOP_NOTIFY),
          ]
        : []),
    ]);
    if (outcomes.some((result) => result.status === "rejected"))
      throw new Error("Slopbot scheduled work or notification needs attention");
  },

  async queue(
    batch: {
      messages: {
        body: Job;
        ack(): void;
        retry(options?: { delaySeconds?: number }): void;
      }[];
    },
    env: Env,
  ) {
    for (const message of batch.messages) {
      try {
        const outcome =
          message.body.kind === "review"
            ? await reviewItem(env, message.body)
            : message.body.kind === "maintainer_hold"
              ? await applyMaintainerHold(env, message.body)
              : message.body.kind === "appeal_command"
                ? await applyAppealCommand(env, message.body)
                : message.body.kind === "appeal_due"
                  ? await escalateDueAppeal(env, message.body)
                  : await recordHumanSignal(env, message.body);
        console.log(
          JSON.stringify({
            delivery: message.body.deliveryId,
            kind: message.body.kind,
            outcome,
          }),
        );
        // A changed source leaves the review failed. Retry it against the
        // current source instead of acknowledging unfinished work.
        if (
          outcome === "review source or authorization changed before action" ||
          outcome === "related original or review source changed before label"
        )
          message.retry({ delaySeconds: 60 });
        else message.ack();
      } catch (error) {
        console.error(
          JSON.stringify({
            delivery: message.body.deliveryId,
            error: String(error).slice(0, 300),
          }),
        );
        // Back off for GitHub's secondary content-creation limits (BOT-13).
        message.retry({
          delaySeconds:
            error instanceof store.ReviewBusyError ? error.delaySeconds : 60,
        });
      }
    }
  },
};
