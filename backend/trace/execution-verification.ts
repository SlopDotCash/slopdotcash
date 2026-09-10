/** Observation of one reviewed plan. Finalized settlement remains payment authority. */
import { findProject } from "../../src/lib/projects.mjs";
import {
  executionSha256,
  type SquadsExecutionObservation,
} from "../../src/lib/squads-execution";
import {
  decodeExecutionBytes,
  parseExecutionRegistry,
} from "../../src/lib/squads-execution-registry";
import { SQUADS_EXECUTION_REGISTRY_JSON } from "../../src/lib/squads-execution-registry.generated";
import { verifySquadsExecution } from "../../src/lib/squads-execution-verifier";
import {
  type VerificationAdmission,
  verificationAdmissionUnavailable,
} from "./verification-admission";

export type ExecutionVerificationResponse = SquadsExecutionObservation;
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
export async function readExecutionVerification(
  request: Request,
  projectId: string,
  cycleId: string,
  admit: VerificationAdmission = async () => verificationAdmissionUnavailable(),
): Promise<Response> {
  if (new URL(request.url).search)
    return json(400, {
      error: "invalid_request",
      message: "Query parameters are not supported",
    });
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(projectId) ||
    !/^\d{4}-(0[1-9]|1[0-2])$/u.test(cycleId) ||
    findProject(projectId)?.id !== projectId
  )
    return json(404, { error: "execution_binding_not_found" });
  try {
    const registry = parseExecutionRegistry(SQUADS_EXECUTION_REGISTRY_JSON);
    const context = registry.contexts.find(
      (row) => row.projectId === projectId && row.cycleId === cycleId,
    );
    if (!context) return json(404, { error: "execution_binding_not_found" });
    const allocationBytes = decodeExecutionBytes(context.allocationBase64);
    const planBytes = decodeExecutionBytes(context.planBase64);
    if (
      (await executionSha256(allocationBytes)) !== context.allocationSha256 ||
      (await executionSha256(planBytes)) !== context.planSha256
    )
      throw new TypeError("Compiled execution bytes do not match digests");
    const denied = await admit();
    if (denied) return denied;
    const observation = await verifySquadsExecution({
      projectId,
      allocationBytes,
      planBytes,
      baseLedger: registry.ledger,
      ledger: registry.ledger,
    });
    return json(
      observation.instructionVerification === "verified" ? 200 : 503,
      observation,
    );
  } catch {
    return json(503, {
      error: "execution_verification_unavailable",
      instructionVerification: "unverified",
      paymentVerified: false,
      retirementVerified: false,
    });
  }
}
