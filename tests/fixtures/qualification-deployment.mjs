/** Closed provider fixture: upload succeeds, consumer configuration exits nonzero. */
import { mock } from "bun:test";
import * as childProcess from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

if (process.env.CLOUDFLARE_API_TOKEN !== "qualification-fixture-token")
  throw new Error("Disposable test credentials required");
const execute = childProcess.execFileSync;
const state = {
  worker: false,
  bindings: [],
  databases: [],
  buckets: [],
  queues: [],
  actions: [],
};
let versionTag;
const version = "qualification-fixture-version";
process.on("exit", () =>
  writeFileSync(process.env.QUALIFICATION_FIXTURE_STATE, JSON.stringify(state)),
);
mock.module("node:child_process", () => ({
  ...childProcess,
  execFileSync(command, args, options) {
    if (basename(command) !== "wrangler")
      return execute(command, args, options);
    if (args[0] === "deploy") {
      const config = JSON.parse(
        readFileSync(args[args.indexOf("--config") + 1], "utf8"),
      );
      state.worker = true;
      versionTag =
        process.env.QUALIFICATION_FIXTURE_CASE === "foreign-source"
          ? "0".repeat(40)
          : process.env.GITHUB_SHA;
      state.bindings = [
        ...config.d1_databases.map((d) => ({
          type: "d1",
          name: d.binding,
          id: d.database_id,
        })),
        ...config.r2_buckets.map((b) => ({
          type: "r2_bucket",
          name: b.binding,
          bucket_name: b.bucket_name,
        })),
        ...config.queues.producers.map((q) => ({
          type: "queue",
          name: q.binding,
          queue_name: q.queue,
        })),
        ...Object.entries(config.vars).map(([name, text]) => ({
          type: "plain_text",
          name,
          text,
        })),
      ];
      throw Object.assign(new Error("PRIVATE_PROCESS_OUTPUT_CANARY"), {
        status: 1,
        stderr: Buffer.from("PRIVATE_PROCESS_OUTPUT_CANARY [code: 10021]"),
      });
    }
    if (
      args[0] === "deployments" &&
      process.env.QUALIFICATION_FIXTURE_CASE === "verification-child-failure"
    )
      return execute(
        process.execPath,
        [
          "--no-env-file",
          "-e",
          'process.stderr.write("PRIVATE_PROCESS_OUTPUT_CANARY [code: 10000]"); process.exit(7);',
        ],
        options,
      );
    if (args[0] === "deployments")
      return JSON.stringify({
        versions: [{ version_id: version, percentage: 100 }],
      });
    if (args[0] === "versions")
      return JSON.stringify([
        { id: version, annotations: { "workers/tag": versionTag } },
      ]);
    throw new Error("Unexpected Wrangler operation");
  },
}));
const response = (result, status = 200) =>
  Response.json({ success: status === 200, result }, { status });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const prefix = `/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/`;
  if (
    url.origin !== "https://api.cloudflare.com" ||
    !url.pathname.startsWith(prefix)
  )
    throw new Error("External transport refused");
  const path = url.pathname.slice(prefix.length),
    method = init.method ?? "GET";
  const body = init.body === undefined ? undefined : JSON.parse(init.body);
  if (path.startsWith("workers/scripts/")) {
    if (path.endsWith("/settings") && method === "GET")
      return state.worker
        ? response({ bindings: state.bindings })
        : response(null, 404);
    if (path.endsWith("/subdomain"))
      return response({ enabled: false, previews_enabled: false });
    if (method === "DELETE") {
      state.worker = false;
      state.actions.push("delete-worker");
      return response(null);
    }
  }
  if (path === "d1/database") {
    if (method === "GET")
      return response(
        state.databases.filter((d) => d.name === url.searchParams.get("name")),
      );
    const d = { uuid: "00000000-0000-0000-0000-000000000001", name: body.name };
    state.databases.push(d);
    return response(d);
  }
  if (path.startsWith("d1/database/")) {
    if (path.endsWith("/query"))
      return response([{ success: true, results: [] }]);
    const id = path.split("/")[2],
      d = state.databases.find((d) => d.uuid === id);
    if (method === "DELETE") {
      state.databases = state.databases.filter((d) => d.uuid !== id);
      return response(null);
    }
    return d ? response(d) : response(null, 404);
  }
  if (path === "r2/buckets" && method === "POST") {
    const b = { name: body.name, creation_date: "2026-10-26T00:00:00.000Z" };
    state.buckets.push(b);
    return response(b);
  }
  if (path.startsWith("r2/buckets/")) {
    const name = path.split("/")[2],
      b = state.buckets.find((b) => b.name === name);
    if (path.endsWith("/domains/managed")) return response({ enabled: false });
    if (path.endsWith("/domains/custom")) return response({ domains: [] });
    if (method === "DELETE") {
      state.buckets = state.buckets.filter((b) => b.name !== name);
      return response(null);
    }
    return b ? response(b) : response(null, 404);
  }
  if (path === "queues") {
    if (method === "GET")
      return response(
        state.queues.filter(
          (q) => q.queue_name === url.searchParams.get("name"),
        ),
      );
    const q = {
      queue_id: String(state.queues.length + 1).padStart(32, "0"),
      queue_name: body.queue_name,
    };
    state.queues.push(q);
    return response(q);
  }
  if (path.startsWith("queues/")) {
    const id = path.split("/")[1],
      q = state.queues.find((q) => q.queue_id === id);
    if (!q) return response(null, 404);
    const bound =
      state.worker &&
      state.bindings.some(
        (b) => b.type === "queue" && b.queue_name === q.queue_name,
      );
    if (method === "DELETE") {
      if (bound) return response(null, 409);
      state.queues = state.queues.filter((q) => q.queue_id !== id);
      state.actions.push("delete-queue");
      return response(null);
    }
    return response({ ...q, consumers: [], producers: bound ? [{}] : [] });
  }
  throw new Error("Unexpected provider operation");
};
