/** Read the deployed runner's small readiness record before a scan starts. */
import { readBoundedJson } from "../../src/lib/browser-json";
import { signedVettingFetch, type VettingConnection } from "./service";

export const MAX_CONTROLLER_BRIDGE_BYTES = 4096;

export type ControllerBridgeHealth = {
  ok: boolean;
  revision: string | null;
  imageSha256: string | null;
};

/** The caller still checks the exact checkout revision and image digest. */
export async function readControllerBridgeHealth(
  connection: VettingConnection,
): Promise<ControllerBridgeHealth> {
  const response = await signedVettingFetch(connection, {
    method: "GET",
    path: "/api/v1/vetting/sandbox",
    timeoutMs: 30_000,
  });
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      // Preserve the readiness refusal if closing the body also fails.
    }
    throw new Error("Deployed scanner bridge is unavailable");
  }
  const value = await readBoundedJson(
    response,
    MAX_CONTROLLER_BRIDGE_BYTES,
    "Scanner bridge readiness",
  );
  // Keep structurally invalid but readable JSON in the wrapper's runner-
  // revision failure stage; transport and JSON failures remain bridge errors.
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { ok: false, revision: null, imageSha256: null };
  const health = value as Record<string, unknown>;
  return {
    ok: health.ok === true,
    revision: typeof health.revision === "string" ? health.revision : null,
    imageSha256:
      typeof health.imageSha256 === "string" ? health.imageSha256 : null,
  };
}
