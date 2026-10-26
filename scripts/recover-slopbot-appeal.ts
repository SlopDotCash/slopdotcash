// Operator recovery for one `/slopbot appeal` delivery that Slopbot received
// and completed before structured appeals were deployed. GitHub redelivery of
// that event returns the duplicate acknowledgement, so it cannot start triage.
//
// The job comes from GitHub's own delivery record for the Slopbot App and the
// same `jobFor` mapping the webhook uses, with the original delivery ID. The
// consumer re-reads GitHub state and keys the appeal by item revision, so this
// adds no authority. The script reads D1 only; one queue send is the only
// write, and only with `--send` after every check passes.
//
//   bun scripts/recover-slopbot-appeal.ts --delivery <guid> [--send]
//
// Environment: SLOPBOT_APP_ID, SLOPBOT_APP_USER_ID, SLOPBOT_APP_PRIVATE_KEY_B64
// (base64 PKCS#8), CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.
import type { Job } from "../workers/slopbot/contracts";
import { appJwt, GitHubClient } from "../workers/slopbot/github";
import { jobFor } from "../workers/slopbot/index";

const GITHUB = "https://api.github.com";
const CLOUDFLARE = "https://api.cloudflare.com/client/v4";
const DATABASE_ID = "1b453124-2709-45af-8389-151a8105c461";
const QUEUE = "slopbot-jobs";

type AppealJob = Extract<Job, { kind: "appeal" | "human_reopen" }>;
type Delivery = {
  guid: string;
  event: string;
  action: string | null;
  request: {
    payload: Parameters<typeof jobFor>[2] & {
      comment?: { id?: number; body: string; user?: { id: number } };
    };
  };
};

/** Current state the recovery must match. Any difference refuses. */
export type RecoveryState = {
  issue: { state: string; node_id: string; user: { id: number } } | null;
  comment: { body: string; user: { id: number } } | null;
  deliveryProcessedAt: string | null | undefined;
  appealCount: number;
};

/** The exact webhook job for one completed, unchanged author appeal. */
export function recoverAppealJob(
  delivery: Delivery,
  appUserId: string,
  state: RecoveryState,
): AppealJob {
  const payload = delivery.request.payload;
  const job = jobFor(delivery.event, delivery.guid, payload, appUserId);
  if (job?.kind !== "appeal")
    throw new Error("The delivery is not a Slopbot appeal");
  if (state.issue === null || state.issue.state !== "open")
    throw new Error("The appealed item is not open");
  if (state.issue.user.id !== job.senderId)
    throw new Error("The appellant is not the current author");
  if (
    state.comment === null ||
    state.comment.user.id !== job.senderId ||
    state.comment.body !== payload.comment?.body
  )
    throw new Error("The appeal comment is missing or changed");
  if (!state.deliveryProcessedAt)
    throw new Error(
      "The delivery receipt is not completed; use GitHub redelivery instead",
    );
  if (state.appealCount !== 0)
    throw new Error("The item already has a structured appeal");
  return job;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function githubApp<T>(jwt: string, url: string) {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${jwt}`,
      "user-agent": "slopbot-appeal-recovery",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok)
    throw new Error(`GitHub App read returned ${response.status}`);
  const next = /<([^>]+)>;\s*rel="next"/u.exec(
    response.headers.get("link") ?? "",
  )?.[1];
  // Delivery IDs exceed the safe integer range; keep them as exact text.
  const text = (await response.text()).replace(/"id":(\d{16,})/gu, '"id":"$1"');
  return { data: JSON.parse(text) as T, next };
}

/** GitHub retains App deliveries for a limited time; page until the GUID. */
async function findDelivery(jwt: string, guid: string): Promise<Delivery> {
  let url: string | undefined = `${GITHUB}/app/hook/deliveries?per_page=100`;
  while (url !== undefined) {
    const page: { data: { id: string; guid: string }[]; next?: string } =
      await githubApp(jwt, url);
    const match = page.data.find((entry) => entry.guid === guid);
    if (match !== undefined)
      return (
        await githubApp<Delivery>(
          jwt,
          `${GITHUB}/app/hook/deliveries/${match.id}`,
        )
      ).data;
    url = page.next;
  }
  throw new Error("GitHub no longer retains this delivery");
}

async function cloudflare<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(
    `${CLOUDFLARE}/accounts/${required("CLOUDFLARE_ACCOUNT_ID")}${path}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${required("CLOUDFLARE_API_TOKEN")}`,
        "content-type": "application/json",
      },
    },
  );
  const body = (await response.json()) as { success: boolean; result: T };
  if (!response.ok || !body.success)
    throw new Error(`Cloudflare ${path} returned ${response.status}`);
  return body.result;
}

async function readD1<T>(sql: string, params: string[]): Promise<T[]> {
  const [result] = await cloudflare<{ results: T[] }[]>(
    `/d1/database/${DATABASE_ID}/query`,
    { method: "POST", body: JSON.stringify({ sql, params }) },
  );
  return result?.results ?? [];
}

async function main(args: string[]) {
  const guid = args[args.indexOf("--delivery") + 1];
  if (!args.includes("--delivery") || !guid)
    throw new Error("Usage: --delivery <guid> [--send]");
  const appId = required("SLOPBOT_APP_ID");
  const pem = Buffer.from(
    required("SLOPBOT_APP_PRIVATE_KEY_B64"),
    "base64",
  ).toString("utf8");
  const delivery = await findDelivery(await appJwt(appId, pem), guid);
  const payload = delivery.request.payload;
  const installationId = payload.installation?.id;
  const repository = payload.repository;
  const number = payload.issue?.number;
  const commentId = payload.comment?.id;
  if (!installationId || !repository || !number || !commentId)
    throw new Error("The delivery is not an issue comment");
  const github = await GitHubClient.forInstallation(appId, pem, installationId);
  const base = `/repos/${repository.owner.login}/${repository.name}`;
  const issue = await github.get<RecoveryState["issue"]>(
    `${base}/issues/${number}`,
  );
  const comment = await github.get<RecoveryState["comment"]>(
    `${base}/issues/comments/${commentId}`,
  );
  const [receipt] = await readD1<{ processed_at: string | null }>(
    "SELECT processed_at FROM slopbot_deliveries WHERE delivery_id = ?",
    [guid],
  );
  const [appeals] = await readD1<{ n: number }>(
    "SELECT COUNT(*) AS n FROM slopbot_appeals WHERE item_node_id = ?",
    [issue?.node_id ?? ""],
  );
  const job = recoverAppealJob(delivery, required("SLOPBOT_APP_USER_ID"), {
    issue,
    comment,
    deliveryProcessedAt: receipt?.processed_at,
    appealCount: Number(appeals?.n ?? Number.NaN),
  });
  console.log(JSON.stringify({ itemNodeId: issue?.node_id, job }));
  if (!args.includes("--send")) {
    console.log("Checks passed. Dry run: no job was queued.");
    return;
  }
  const queues = await cloudflare<{ queue_id: string; queue_name: string }[]>(
    `/queues?name=${QUEUE}`,
  );
  const queue = queues.find((entry) => entry.queue_name === QUEUE);
  if (queue === undefined) throw new Error(`Queue ${QUEUE} was not found`);
  await cloudflare(`/queues/${queue.queue_id}/messages`, {
    method: "POST",
    body: JSON.stringify({ body: job, content_type: "json" }),
  });
  console.log(`Queued one appeal job for delivery ${guid}.`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}
