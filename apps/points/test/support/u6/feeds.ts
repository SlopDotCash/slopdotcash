// spec/points/window.md, "Publication needs a verified complete census; a failure keeps the previous window"
import { createHash } from "node:crypto";
import type { Fetcher } from "@repo/platform/bindings";
import type { GitHubFake } from "@repo/platform/testing/github";
import type { PublicAccountBans } from "@repo/backend/client";
import type { PenaltyPage, PenaltyRow, ValueHistoryPage, WorkUnitHistoryPage, WorkUnitHistoryRow } from "@repo/ports/slopbot";

export type Reply =
  | { readonly status?: number; readonly json?: unknown; readonly text?: string; readonly bytes?: Uint8Array; readonly headers?: Readonly<Record<string, string>> }
  | "disconnect"
  | "interrupted"
  | "stall";

export interface Seen {
  readonly url: string;
  readonly authorized: boolean;
  readonly range: string | null;
}

export interface Scripted {
  readonly fetcher: Fetcher;
  readonly seen: ReadonlyArray<Seen>;
  readonly unexpected: ReadonlyArray<string>;
  /** @throws {never} */
  reply(match: string | RegExp, ...replies: ReadonlyArray<Reply>): void;
}

const encoder = new TextEncoder();

function answer(reply: Reply): Promise<Response> {
  if (reply === "disconnect") return Promise.reject(new TypeError("Network connection lost."));
  if (reply === "interrupted") return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ pull: (controller) => controller.error(new TypeError("Response body interrupted")) })));
  if (reply === "stall") return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start: (controller) => controller.enqueue(encoder.encode('{"schemaVersion":')) })));
  const headers = new Headers(reply.headers);
  if (reply.json !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  const body = reply.bytes !== undefined ? new Uint8Array(reply.bytes) : (reply.json !== undefined ? JSON.stringify(reply.json) : reply.text ?? null);
  return Promise.resolve(new Response(body, { status: reply.status ?? 200, headers }));
}

/** @throws {never} */
export function scripted(github?: GitHubFake): Scripted {
  const seen: Seen[] = [];
  const unexpected: string[] = [];
  const routes: { readonly match: string | RegExp; readonly replies: Reply[] }[] = [];
  const fetcher: Fetcher = {
    fetch: (request) => {
      const url = new URL(request.url);
      if (github !== undefined && url.hostname === "api.github.com") return github.fetch(request);
      seen.push({ url: request.url, authorized: request.headers.has("authorization"), range: request.headers.get("range") });
      const route = routes.find(({ match, replies }) => replies.length > 0 && (typeof match === "string" ? match === request.url : match.test(request.url)));
      const reply = route?.replies.shift();
      if (reply === undefined) {
        unexpected.push(request.url);
        return Promise.resolve(new Response("unexpected request", { status: 599 }));
      }
      return answer(reply);
    },
  };
  return {
    fetcher,
    seen,
    unexpected,
    reply: (match, ...replies) => {
      routes.push({ match, replies: [...replies] });
    },
  };
}

/** @throws {never} */
export function penaltyPage(project: string, records: ReadonlyArray<PenaltyRow>, nextAfter: string | null, schemaVersion = "slop-penalty-history:v1"): PenaltyPage {
  return { schemaVersion, project, records, nextAfter };
}

/** @throws {never} */
export function penaltyRow(item: string, author: string, category: string, debitThirds: number, recordedAt: string, reversedAt: string | null = null, reversal: string | null = null): PenaltyRow {
  return { item_node_id: item, repository_id: 7001, author_github_id: author, category, table_version: "slopbot-penalties-v1", debit_thirds: debitThirds, period: recordedAt.slice(0, 7), recorded_at: recordedAt, reversed_at: reversedAt, reversal };
}

/** @throws {never} */
export function valuePage(repositoryNodeId: string, pull: number, records: ReadonlyArray<unknown>, nextAfter: number | null): ValueHistoryPage {
  return { schemaVersion: "slop-value-history:v1", repositoryNodeId, pullRequestNumber: pull, records, nextAfter };
}

/** @throws {never} */
export function historyRow(sequence: number, record: unknown): WorkUnitHistoryRow {
  const json = JSON.stringify(record);
  return { sequence, record_digest: createHash("sha256").update(json).digest("hex"), record_json: json, recorded_at: "2026-11-02T08:00:00.000Z" };
}

/** @throws {never} */
export function jointPage(repositoryNodeId: string, pull: number, records: ReadonlyArray<WorkUnitHistoryRow>, nextAfter: number | null, throughSequence: number, totalRecords: number): WorkUnitHistoryPage {
  return { schemaVersion: "slop-work-unit-history:v1", repositoryNodeId, pullRequestNumber: pull, records, nextAfter, throughSequence, totalRecords };
}

/** @throws {never} */
export function banFeed(bans: ReadonlyArray<{ readonly githubId: string; readonly bannedAt: string }>): PublicAccountBans {
  return { schemaVersion: "slop-account-bans:v1", bans };
}
