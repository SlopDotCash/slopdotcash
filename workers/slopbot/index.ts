// Slopbot GitHub App service (draft, docs/slopbot-v2-proposal.md).
// fetch: verify and deduplicate webhooks, then enqueue identifiers only.
// queue: re-read GitHub state and run the review pipeline.
import { findRegisteredRepositoryById } from "../../src/lib/repositories.mjs";
import { resumeBudgetBlocks } from "./budget-blocks";
import type { Job } from "./contracts";
import { verifyWebhookSignature } from "./github";
import * as store from "./persistence";
import { QUALITY_MARKER } from "./quality";
import { registeredRepository } from "./registry";
import {
  handleRepositoryAccess,
  REPOSITORY_ACCESS_URL,
} from "./repository-access";
import { recordHumanSignal, reviewItem } from "./review";
import { dispatchSpendAlert } from "./spend-alerts";
import {
  consumePendingValueRequest,
  type ValueConsumerEnv,
} from "./value-consumer";
import { valueHistory } from "./value-journal";
import { recordValueRequest } from "./value-requests";
import { workUnitHistory } from "./value-work-unit-journal";
import { readWebhookBody } from "./webhook-body";

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
  issue?: { number: number; pull_request?: unknown };
  pull_request?: { number: number };
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
    if (
      action !== "created" ||
      !(payload.comment?.body ?? "").trim().startsWith("/slopbot appeal")
    )
      return null;
    return { kind: "appeal", ...base, ...item, senderId: sender.id };
  }
  if (action === "reopened")
    return { kind: "human_reopen", ...base, ...item, senderId: sender.id };
  if (REVIEW_ACTIONS[event]?.has(action))
    return { kind: "review", ...base, ...item };
  return null;
}

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
  if (
    payload.action === "created" ||
    payload.action === "new_permissions_accepted"
  ) {
    await store.completeInstallationDelivery(env.SLOPBOT_DB, deliveryId, {
      kind: "upsert",
      installation: { id: installation.id, account: installation.account },
      sourceUpdatedAt,
    });
  } else if (payload.action === "deleted") {
    await store.completeInstallationDelivery(env.SLOPBOT_DB, deliveryId, {
      kind: "state",
      installation: { id: installation.id, account: installation.account },
      state: "removed",
      sourceUpdatedAt,
    });
  } else if (payload.action === "suspend") {
    await store.completeInstallationDelivery(env.SLOPBOT_DB, deliveryId, {
      kind: "state",
      installation: { id: installation.id, account: installation.account },
      state: "suspended",
      sourceUpdatedAt,
    });
  } else if (payload.action === "unsuspend") {
    await store.completeInstallationDelivery(env.SLOPBOT_DB, deliveryId, {
      kind: "state",
      installation: { id: installation.id, account: installation.account },
      state: "active",
      sourceUpdatedAt,
    });
  } else {
    await store.completeInstallationDelivery(env.SLOPBOT_DB, deliveryId, null);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ service: "slopbot", ok: true });
    }
    const jointHistory = url.pathname === "/v1/work-unit-assessments";
    if (
      request.method === "GET" &&
      (jointHistory || url.pathname === "/v1/value-assessments")
    ) {
      const repository = findRegisteredRepositoryById(
        url.searchParams.get("repository") ?? "",
      );
      const number = url.searchParams.get("pull") ?? "";
      const after = url.searchParams.get("after") ?? "0";
      const through = jointHistory ? url.searchParams.get("through") : null;
      if (
        !repository ||
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
        const history = jointHistory
          ? await workUnitHistory(
              env.SLOPBOT_DB,
              repository.id,
              Number(number),
              Number(after),
              through === null ? null : Number(through),
            )
          : await valueHistory(
              env.SLOPBOT_DB,
              repository.id,
              Number(number),
              Number(after),
            );
        return Response.json(
          {
            schemaVersion: jointHistory
              ? "slop-work-unit-history:v1"
              : "slop-value-history:v1",
            repository: repository.id,
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
        return Response.json(
          { error: "Value history is unavailable" },
          { status: 503, headers: { "cache-control": "no-store" } },
        );
      }
    }
    if (
      request.method === "GET" &&
      url.origin === new URL(REPOSITORY_ACCESS_URL).origin &&
      url.pathname === new URL(REPOSITORY_ACCESS_URL).pathname
    )
      return handleRepositoryAccess(request, env);
    if (request.method !== "POST" || url.pathname !== "/github/webhook") {
      return new Response("not found", { status: 404 });
    }
    const body = await readWebhookBody(request, MAX_WEBHOOK_BYTES);
    if (body === null) {
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
        if (!(await registeredRepository(env.SLOPBOT_DB, job))) {
          await store.completeDelivery(env.SLOPBOT_DB, deliveryId);
          return new Response("repository is not active in the Slop registry", {
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
    await resumeBudgetBlocks(env.SLOPBOT_DB, env.SLOPBOT_QUEUE);
    if (env.SLOP_NOTIFY)
      await dispatchSpendAlert(env.SLOPBOT_DB, env.SLOP_NOTIFY);
    await consumePendingValueRequest(env);
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
            : await recordHumanSignal(env, message.body);
        console.log(
          JSON.stringify({
            delivery: message.body.deliveryId,
            kind: message.body.kind,
            outcome,
          }),
        );
        message.ack();
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
