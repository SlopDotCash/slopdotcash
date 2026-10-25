/** Local Linux qualification only. No assessment, identity, D1 or journal. */
/// <reference path="../../workers/slopbot/cloudflare-workers.d.ts" />
import { WorkerEntrypoint } from "cloudflare:workers";
import { handleHistoricalValueImport } from "../../backend/slopbot/value-import";
import type { ValueMergeVerifier } from "../../workers/slopbot/value-merge-profile";

interface Env {
  MERGE: ValueMergeVerifier;
  PUBLISHER: {
    publishSubscription(
      input: unknown,
      bundle?: ReadableStream<Uint8Array>,
    ): Promise<{
      recordDigest: string;
      sequence: number;
    }>;
  };
}

export class ControlPublisher extends WorkerEntrypoint<Env> {
  async publishSubscription(
    input: unknown,
    bundle?: ReadableStream<Uint8Array>,
  ) {
    const control = input as {
      schema?: string;
      inputs?: Parameters<ValueMergeVerifier["reconstruct"]>[0];
    };
    if (
      control.schema !== "public-merge-control-not-an-assessment" ||
      !Array.isArray(control.inputs) ||
      !bundle
    )
      throw new Error("Invalid public control");
    const result = await this.env.MERGE.reconstruct(control.inputs, bundle);
    // Only metadata/hashes leave this fixture. No reconstructed source is logged.
    return {
      recordDigest: "test-only-no-journal",
      sequence: 0,
      results: result.map(({ inputSha256, mergeResolutions }) => ({
        inputSha256,
        resolutions: mergeResolutions.map(({ patch, ...rest }) => ({
          ...rest,
          patchBytes: new TextEncoder().encode(patch).length,
        })),
      })),
      destroyAcknowledged: true,
    };
  }
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method === "GET" && new URL(request.url).pathname === "/health")
      return Response.json({ service: "merge-sdk-qualification-only" });
    if (new URL(request.url).pathname !== "/api/v1/slopbot/value-import")
      return new Response("Not found", { status: 404 });
    const actor = request.headers.get("x-fixture-actor");
    // The real Pages/session boundary has separate native D1 evidence. This
    // control uses the real bounded multipart handler and named SDK operation.
    return handleHistoricalValueImport(request, {
      adminGithubIds: new Set(["fixture-admin"]),
      sessionActor: async () => (actor ? { githubId: actor } : null),
      publisher: env.PUBLISHER,
    });
  },
};
