// Slopbot GitHub App service (draft, docs/slopbot-v2-proposal.md).
// fetch: verify and deduplicate webhooks, then enqueue identifiers only.
// queue: re-read GitHub state and run the review pipeline.
import type { Job } from "./contracts";
import { verifyWebhookSignature } from "./github";
import * as store from "./persistence";
import { type ReviewEnv, recordHumanSignal, reviewItem } from "./review";

type Queue = { send(body: Job): Promise<void> };
type Env = ReviewEnv & { SLOPBOT_WEBHOOK_SECRET: string; SLOPBOT_QUEUE: Queue };

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

type Payload = {
  action?: string;
  installation?: {
    id: number;
    account?: { id: number; login: string; type: string };
  };
  repository?: { id: number; name: string; owner: { login: string } };
  sender?: { id: number; type: string };
  issue?: { number: number; pull_request?: unknown };
  pull_request?: { number: number };
  comment?: { body: string };
};

function jobFor(
  event: string,
  deliveryId: string,
  payload: Payload,
  appUserId: string,
): Job | null {
  const { installation, repository, sender, action } = payload;
  if (
    installation === undefined ||
    repository === undefined ||
    sender === undefined ||
    action === undefined
  )
    return null;
  if (String(sender.id) === appUserId) return null;
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

async function handleInstallation(env: Env, event: string, payload: Payload) {
  const installation = payload.installation;
  if (event !== "installation" || installation?.account === undefined) return;
  if (
    payload.action === "created" ||
    payload.action === "new_permissions_accepted"
  ) {
    await store.upsertInstallation(env.SLOPBOT_DB, {
      id: installation.id,
      account: installation.account,
    });
  } else if (payload.action === "deleted") {
    await store.setInstallationState(
      env.SLOPBOT_DB,
      installation.id,
      "removed",
    );
  } else if (payload.action === "suspend") {
    await store.setInstallationState(
      env.SLOPBOT_DB,
      installation.id,
      "suspended",
    );
  } else if (payload.action === "unsuspend") {
    await store.setInstallationState(env.SLOPBOT_DB, installation.id, "active");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ service: "slopbot", ok: true });
    }
    if (request.method !== "POST" || url.pathname !== "/github/webhook") {
      return new Response("not found", { status: 404 });
    }
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > MAX_WEBHOOK_BYTES)
      return new Response("payload too large", { status: 413 });
    const body = await request.text();
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
    if (!(await store.recordDelivery(env.SLOPBOT_DB, deliveryId, event))) {
      return new Response("duplicate delivery", { status: 202 });
    }
    const payload = JSON.parse(body) as Payload;
    await handleInstallation(env, event, payload);
    const job = jobFor(event, deliveryId, payload, env.SLOPBOT_APP_USER_ID);
    if (job !== null) await env.SLOPBOT_QUEUE.send(job);
    return new Response(job === null ? "ignored" : "queued", { status: 202 });
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
        message.retry({ delaySeconds: 60 });
      }
    }
  },
};
