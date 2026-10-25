/** Harmless deployed probes only. No scan, evidence, model or controller calls. */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  signedServiceHeaders,
  vettingServiceSigner,
} from "../workers/vetting/service";
import { qualifySandbox } from "../workers/vetting-sandbox/probes";
import {
  type PagesMetadata,
  publicScannerKey,
  verifyScannerPublicKey,
} from "./prepare-vetting-public-key";
import { selectSuccessfulProductionDeployment } from "./select-pages-deployment.mjs";

const origin = "https://staging.slop.cash",
  worker = "slop-vetting-sandbox-staging";
const path = "/api/v1/vetting/sandbox";
type Binding = {
  name: string;
  type: string;
  text?: string;
  namespace_id?: string;
  class_name?: string;
};
type Project = PagesMetadata & {
  canonical_deployment?: { id?: string };
  deployment_configs: PagesMetadata["deployment_configs"] & {
    production: { services?: Record<string, { service: string }> };
  };
};
async function main() {
  if (!process.argv.includes("--execute")) {
    console.log(
      JSON.stringify({
        mode: "plan",
        origin,
        worker,
        probes: [
          "authorization",
          "digest",
          "uid-environment",
          "fresh-filesystem",
          "python-node",
          "egress",
          "output-limit",
          "timeout",
          "fresh-after-timeout",
        ],
        changes:
          "Only harmless disposable sandbox executions; no model, case or evidence publication",
      }),
    );
    return;
  }
  const env = process.env,
    sha = env.GITHUB_SHA ?? "";
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/development" ||
    env.GITHUB_REPOSITORY !== "SlopDotCash/slopdotcash" ||
    env.GITHUB_WORKFLOW_REF !==
      "SlopDotCash/slopdotcash/.github/workflows/vetting-sandbox-qualification.yml@refs/heads/development" ||
    env.VETTING_QUALIFICATION_MODE !== "execute" ||
    !/^[a-f0-9]{40}$/.test(sha ?? "") ||
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !==
      sha ||
    !env.RUNNER_TEMP
  )
    throw new Error("The protected staging qualification checkout is required");
  if (
    !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
    !env.CLOUDFLARE_API_TOKEN
  )
    throw new Error("Protected metadata access is required");
  const report: Record<string, unknown> = {
    sourceSha: sha,
    target: "staging",
    success: false,
    phase: "metadata",
    modelCalls: 0,
    evidenceWrites: 0,
    scanPublications: 0,
  };
  const directory = join(env.RUNNER_TEMP, "vetting-sandbox-qualification");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const signer = await vettingServiceSigner(env.SLOP_VETTING_SIGNING_JWK);
    const publicKey = await publicScannerKey(
      env.SLOP_VETTING_SIGNING_JWK,
      "staging",
      sha,
    );
    async function api<T>(route: string): Promise<T> {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/${route}`,
        {
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
          headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
        },
      );
      if (!response.ok) throw new Error("Deployment metadata read failed");
      const body = (await response.json()) as { success?: boolean; result?: T };
      if (body.success !== true || body.result === undefined)
        throw new Error("Deployment metadata is unavailable");
      return body.result;
    }
    async function metadata() {
      const project = await api<Project>("pages/projects/slop-staging");
      verifyScannerPublicKey(project, publicKey);
      if (
        project.deployment_configs.production.services?.VETTING_SANDBOX
          ?.service !== worker
      )
        throw new Error("Wrong private sandbox binding");
      const deployments = await api<unknown[]>(
        "pages/projects/slop-staging/deployments?env=production&per_page=25",
      );
      const deployment = selectSuccessfulProductionDeployment(
        { success: true, result: deployments },
        {
          commitHash: sha,
          notBefore: 0,
          branch: "development",
          environment: "production",
          project: "slop-staging",
        },
      );
      if (!deployment || project.canonical_deployment?.id !== deployment.id)
        throw new Error("The exact Pages revision is not active");
      const domain = await api<{ status: string }>(
        "pages/projects/slop-staging/domains/staging.slop.cash",
      );
      if (domain.status !== "active")
        throw new Error("Staging domain is unavailable");
      const deployed = await api<{
        deployments: {
          versions: { version_id: string; percentage: number }[];
        }[];
      }>(`workers/scripts/${worker}/deployments`);
      const active = deployed.deployments?.[0]?.versions;
      if (active?.length !== 1 || active[0].percentage !== 100)
        throw new Error("Sandbox version is not pinned");
      const version = await api<{ resources: { bindings: Binding[] } }>(
        `workers/scripts/${worker}/versions/${active[0].version_id}`,
      );
      const bindings = version.resources.bindings;
      const value = (name: string) => bindings.find((b) => b.name === name);
      const image = value("RUNNER_IMAGE_SHA256")?.text;
      if (
        value("SLOP_RELEASE_SHA")?.text !== sha ||
        !/^[a-f0-9]{64}$/.test(image ?? "") ||
        value("RUNNER")?.class_name !== "OfflineSandbox"
      )
        throw new Error("Sandbox source/image identity does not match");
      if (
        bindings.some(
          (b) =>
            !["RUNNER", "RUNNER_IMAGE_SHA256", "SLOP_RELEASE_SHA"].includes(
              b.name,
            ),
        )
      )
        throw new Error("Unexpected sandbox binding");
      const subdomain = await api<{
        enabled?: boolean;
        previews_enabled?: boolean;
      }>(`workers/scripts/${worker}/subdomain`);
      if (subdomain.enabled !== false || subdomain.previews_enabled !== false)
        throw new Error("Sandbox public access must be disabled");
      const domains = await api<{ service: string }[]>("workers/domains");
      if (domains.some((d) => d.service === worker))
        throw new Error("Sandbox has a public domain");
      const applications = await api<
        {
          name: string;
          configuration: {
            image: string;
            network: { mode: string; assign_ipv4: string; assign_ipv6: string };
          };
          durable_objects: { namespace_id: string };
        }[]
      >(`containers/applications?name=${worker}-offlinesandbox`);
      const containers = applications.filter(
        (a) => a.name === `${worker}-offlinesandbox`,
      );
      if (
        containers.length !== 1 ||
        !containers[0].configuration.image.endsWith(`@sha256:${image}`) ||
        containers[0].durable_objects.namespace_id !==
          value("RUNNER")?.namespace_id ||
        containers[0].configuration.network.mode !== "private" ||
        containers[0].configuration.network.assign_ipv4 !== "none" ||
        containers[0].configuration.network.assign_ipv6 !== "none"
      )
        throw new Error("Container identity or private network differs");
      const response = await fetch(`${origin}${path}`, {
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: await signedServiceHeaders({
          signer,
          method: "GET",
          pathAndQuery: path,
          body: new Uint8Array(),
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("Signed sandbox health is unavailable");
      }
      const health = (await response.json()) as {
        ok?: boolean;
        service?: string;
        revision?: string;
        imageSha256?: string;
      };
      if (
        health.ok !== true ||
        health.service !== "vetting-sandbox" ||
        health.revision !== sha ||
        health.imageSha256 !== image
      )
        throw new Error("Deployed health identity differs");
      return {
        pagesDeploymentId: deployment.id,
        workerVersionId: active[0].version_id,
        sourceSha: sha,
        imageSha256: image,
        publicKeySha256: publicKey.sha256,
      };
    }
    const before = await metadata();
    report.deployment = before;
    report.phase = "harmless-probes";
    report.probes = await qualifySandbox({
      connection: { origin, ...signer },
      checkIdentity: (evidence) => {
        if (
          evidence.sourceSha !== before.sourceSha ||
          evidence.imageSha256 !== before.imageSha256
        )
          throw new Error("Execution identity changed");
      },
      send: async (body, signed = true) =>
        fetch(`${origin}${path}`, {
          method: "POST",
          body: new Uint8Array(body),
          redirect: "error",
          signal: AbortSignal.timeout(120_000),
          headers: {
            "content-type": "application/json",
            ...(signed
              ? await signedServiceHeaders({
                  signer,
                  method: "POST",
                  pathAndQuery: path,
                  body,
                })
              : {}),
          },
        }),
    });
    report.phase = "identity-readback";
    if (JSON.stringify(await metadata()) !== JSON.stringify(before))
      throw new Error("Deployment changed during qualification");
    report.success = true;
    report.phase = "complete";
  } finally {
    await writeFile(
      join(directory, "result.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      { mode: 0o600 },
    );
  }
}
if (import.meta.main)
  await main().catch(() => {
    console.error(
      "Sandbox qualification failed; request, signature and output bytes are not logged.",
    );
    process.exitCode = 1;
  });
