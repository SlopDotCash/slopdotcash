import { createHmac } from "node:crypto";
import type { Job } from "../workers/slopbot/contracts";
import worker from "../workers/slopbot/index";
import type { ReopenItem } from "../workers/slopbot/reopen-source";

/** A real signed webhook on local fixture storage; no GitHub request. */
export async function enqueueReopen(
  env: Parameters<typeof worker.fetch>[1],
  job: Extract<Job, { kind: "human_reopen" | "appeal" }>,
  item: ReopenItem,
): Promise<Response> {
  const body = JSON.stringify({
    action: "reopened",
    installation: { id: job.installationId },
    repository: {
      id: job.repositoryId,
      name: job.repo,
      owner: { login: job.owner },
      private: false,
    },
    sender: { id: job.senderId, type: "User" },
    [job.itemKind === "pull_request" ? "pull_request" : "issue"]: {
      ...item,
      number: job.number,
    },
  });
  return worker.fetch(
    new Request("https://slopbot.test/github/webhook", {
      method: "POST",
      headers: {
        "x-github-event":
          job.itemKind === "pull_request" ? "pull_request" : "issues",
        "x-github-delivery": job.deliveryId,
        "x-hub-signature-256": `sha256=${createHmac("sha256", env.SLOPBOT_WEBHOOK_SECRET).update(body).digest("hex")}`,
      },
      body,
    }),
    env,
  );
}
