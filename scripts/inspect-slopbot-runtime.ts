/** PRD 9: read fixed production metadata; never retain bindings or log bodies. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBoundedJson } from "../src/lib/browser-json";

const worker = "slop-slopbot";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const sha = /^[a-f0-9]{40}$/u;
const usageModels = new Set(["standard", "bundled", "unbound"]);
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

type Stage =
  | "authority"
  | "expected-source"
  | "tls"
  | "deployment-read"
  | "version-read"
  | "version-identity"
  | "version-source"
  | "runtime-shape"
  | "deployment-recheck";
class MetadataUnavailable extends Error {
  constructor(
    readonly stage: Stage,
    readonly httpStatus?: number,
  ) {
    super("Slopbot runtime metadata unavailable");
  }
}

function active(value: unknown, stage: Stage) {
  const deployments = object(value)?.deployments;
  const current = Array.isArray(deployments) ? object(deployments[0]) : null;
  const versions = current?.versions;
  const selected =
    Array.isArray(versions) && versions.length === 1
      ? object(versions[0])
      : null;
  if (
    typeof current?.id !== "string" ||
    !uuid.test(current.id) ||
    typeof selected?.version_id !== "string" ||
    !uuid.test(selected.version_id) ||
    selected.percentage !== 100
  )
    throw new MetadataUnavailable(stage);
  return { deploymentId: current.id, versionId: selected.version_id };
}

/** The caller can supply authority and the expected SHA, never a Worker or path. */
export async function inspectSlopbotRuntime(input: {
  account: string;
  token: string;
  expectedSource: string;
  request?: typeof fetch;
}) {
  const base = {
    schemaVersion: 1,
    worker,
    checkedAt: new Date().toISOString(),
    expectedSource: sha.test(input.expectedSource)
      ? input.expectedSource
      : null,
  };
  try {
    if (!/^[a-f0-9]{32}$/u.test(input.account) || !input.token.trim())
      throw new MetadataUnavailable("authority");
    if (!sha.test(input.expectedSource))
      throw new MetadataUnavailable("expected-source");
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
      throw new MetadataUnavailable("tls");
    const request = input.request ?? fetch;
    const get = async (path: string, stage: Stage) => {
      let response: Response;
      try {
        response = await request(
          `https://api.cloudflare.com/client/v4/accounts/${input.account}/workers/scripts/${worker}/${path}`,
          {
            method: "GET",
            redirect: "error",
            cache: "no-store",
            headers: {
              authorization: `Bearer ${input.token}`,
              "cache-control": "no-cache",
            },
            signal: AbortSignal.timeout(20_000),
          },
        );
      } catch {
        throw new MetadataUnavailable(stage);
      }
      if (!response.ok) {
        try {
          await response.body?.cancel();
        } catch {
          /* Only the fixed HTTP status is retained. */
        }
        throw new MetadataUnavailable(stage, response.status);
      }
      let body: Record<string, unknown> | null;
      try {
        body = object(await readBoundedJson(response, 1_048_576, "metadata"));
      } catch {
        throw new MetadataUnavailable(stage, response.status);
      }
      if (body?.success !== true)
        throw new MetadataUnavailable(stage, response.status);
      return body.result;
    };
    const before = active(
      await get("deployments", "deployment-read"),
      "deployment-read",
    );
    const version = object(
      await get(`versions/${before.versionId}`, "version-read"),
    );
    if (version?.id !== before.versionId)
      throw new MetadataUnavailable("version-identity");
    const sourceCommit = object(version.annotations)?.["workers/tag"];
    if (sourceCommit !== input.expectedSource)
      throw new MetadataUnavailable("version-source");
    const runtime = object(object(version.resources)?.script_runtime);
    const cpuMs = object(runtime?.limits)?.cpu_ms;
    const usageModel = runtime?.usage_model;
    if (
      typeof cpuMs !== "number" ||
      !Number.isSafeInteger(cpuMs) ||
      cpuMs < 1 ||
      cpuMs > 300_000 ||
      typeof usageModel !== "string" ||
      !usageModels.has(usageModel)
    )
      throw new MetadataUnavailable("runtime-shape");
    const after = active(
      await get("deployments", "deployment-recheck"),
      "deployment-recheck",
    );
    if (
      before.deploymentId !== after.deploymentId ||
      before.versionId !== after.versionId
    )
      throw new MetadataUnavailable("deployment-recheck");
    return {
      ...base,
      status: "observed" as const,
      observation: {
        sourceCommit,
        versionId: before.versionId,
        cpuMs,
        usageModel,
        deploymentStable: true,
      },
    };
  } catch (error) {
    const failure =
      error instanceof MetadataUnavailable
        ? error
        : new MetadataUnavailable("version-read");
    return {
      ...base,
      status: "unavailable" as const,
      observation: null,
      failure: {
        stage: failure.stage,
        ...(failure.httpStatus === undefined
          ? {}
          : { httpStatus: failure.httpStatus }),
      },
    };
  }
}

if (import.meta.main) {
  if (
    process.env.GITHUB_REF !== "refs/heads/main" ||
    !process.env.RUNNER_TEMP
  ) {
    process.stderr.write("Protected main runner required.\n");
    process.exitCode = 1;
  } else {
    const report = await inspectSlopbotRuntime({
      account: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
      token: process.env.CLOUDFLARE_API_TOKEN ?? "",
      expectedSource: process.env.SLOP_SLOPBOT_EXPECTED_SOURCE ?? "",
    });
    writeFileSync(
      join(process.env.RUNNER_TEMP, "slopbot-runtime.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      { mode: 0o600 },
    );
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (report.status !== "observed") process.exitCode = 1;
  }
}
