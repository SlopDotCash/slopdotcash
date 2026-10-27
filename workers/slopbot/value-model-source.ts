import type { ValueEvidence } from "./value-evidence";
import type { WorkUnitEvidence } from "./value-work-unit";

const BINARY_SOURCE_NOTE = `

Added-binary proof metadata identifies retained bytes, not their visible content or usefulness. Binary bodies are omitted from this text-only request. The source collector has not viewed the media. Do not infer what a recording or image shows, successful execution, provider identity, or user acceptance from its filename, hashes, or unverified reports. Assess only supported source evidence. If an outcome or required before/after proof depends on viewing omitted media, leave that outcome unresolved and explain the missing observation. Do not assign a separate outcome merely for storing a recording.`;

/** Keep complete bytes in the source digest and private evidence, not in a
 * text-only model request. Text-only requests retain their existing bytes. */
export function valueModelSource(evidence: ValueEvidence | WorkUnitEvidence) {
  let binary = false;
  const item = JSON.stringify(evidence, (key: string, value: unknown) => {
    if (key !== "addedBinary" || value === null || typeof value !== "object")
      return value;
    binary = true;
    const metadata = { ...(value as Record<string, unknown>) };
    delete metadata.contentBase64;
    return { ...metadata, contentOmittedFromModel: true };
  });
  return { item, systemSuffix: binary ? BINARY_SOURCE_NOTE : "" };
}
