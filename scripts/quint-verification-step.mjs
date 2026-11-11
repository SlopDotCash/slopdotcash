/** Explicit, source-bound safety abstractions; ordinary checks use step. */
import { createHash } from "node:crypto";

const owner = "formal/models/api/api_owner_vault_lifecycle.qnt";
const reviewedSource =
  "68da3beb9833d621fd150cba1642b0b82739bba614ca4a5132e953b629cea378";

export function verificationTransition(model, source) {
  if (model !== owner) return null;
  const sha256 = createHash("sha256").update(source).digest("hex");
  if (sha256 !== reviewedSource || /^\s*temporal\s+/mu.test(source))
    throw new Error(
      "Owner delayed-input safety abstraction needs source review",
    );
  return {
    step: "verificationStep",
    kind: "forward-safety-simulation-delayed-inputs",
    sourceSha256: sha256,
    concreteStep: "step",
  };
}
