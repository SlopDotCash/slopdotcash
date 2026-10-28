/** Execute acquired native artifacts only through the private disposable runner. */
import { randomUUID } from "node:crypto";
import type { VettingScanResult } from "../../backend/vetting/scan-result";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import {
  executionInventory,
  type RepositoryInspection,
  type ScanInputFile,
} from "./bounded-scan";
import type { QueueConnection } from "./queue";
import { runIsolatedArtifact } from "./sandbox";

export async function inspectIsolatedArtifacts(input: {
  connection: QueueConnection;
  files: ScanInputFile[];
  inspection: RepositoryInspection;
}): Promise<{
  execution: VettingScanResult["execution"];
  reports: Uint8Array[];
}> {
  const { inspection } = input;
  const files = new Map<string, Uint8Array>();
  for (const file of input.files)
    files.set(await sha256Hex(file.bytes), file.bytes);
  const inventory = executionInventory(inspection);
  // The reviewer bounds visibility-gap entries. Keep repeated execution gaps
  // grouped by reason; the result retains every exact artifact record.
  const gaps = new Map<string, number>();
  const gap = (reason: string) => {
    gaps.set(reason, (gaps.get(reason) ?? 0) + 1);
    inspection.coverage.downloads.state = "partial";
  };
  const reports: Uint8Array[] = [];
  let execution: VettingScanResult["execution"] = null;
  for (const artifact of inspection.artifacts) {
    if (artifact.analysis !== "pending" || artifact.state !== "quarantined")
      continue;
    const bytes = files.get(artifact.sha256);
    // This runner supports Linux x86-64 executables. Other formats need their
    // own analysis, not an invented clean result from a failed exec call.
    if (
      !bytes ||
      bytes.length < 20 ||
      bytes.length > 2 * 1024 * 1024 ||
      bytes[0] !== 0x7f ||
      bytes[1] !== 0x45 ||
      bytes[2] !== 0x4c ||
      bytes[3] !== 0x46 ||
      bytes[4] !== 2 ||
      bytes[5] !== 1 ||
      bytes[18] !== 0x3e ||
      bytes[19] !== 0
    ) {
      gap("Isolated analysis does not yet support these artifacts");
      continue;
    }
    const result = await runIsolatedArtifact({
      connection: input.connection,
      bytes,
      interpreter: "binary",
    });
    const evidence = result.evidence;
    if (!evidence.imageSha256 || !evidence.sourceSha)
      throw new Error("Execution did not identify a released image");
    if (execution && execution.imageSha256 !== evidence.imageSha256)
      throw new Error("The execution image changed during the assessment");
    execution ??= {
      isolation: "sandbox",
      imageSha256: evidence.imageSha256,
      runId: `execution-${randomUUID()}`,
      reason: "Inspect acquired native artifacts in disposable sandboxes",
      startedAt: evidence.startedAt,
      completedAt: evidence.completedAt,
      secretsProvided: false,
      egress: "default-deny",
    };
    execution.completedAt = evidence.completedAt;
    artifact.requestedExecution = true;
    reports.push(result.bytes);
    // Running successfully does not release quarantine or establish safety.
    if (!evidence.outputComplete || evidence.exitCode !== 0)
      gap("Isolated execution was incomplete");
    let stdout: string;
    let stderr: string;
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      stdout = decoder.decode(Buffer.from(evidence.stdoutBase64, "base64"));
      stderr = decoder.decode(Buffer.from(evidence.stderrBase64, "base64"));
    } catch {
      gap("Isolated output was not UTF-8");
      continue;
    }
    inventory.add(
      `execution:${evidence.runId}`,
      JSON.stringify({ ...evidence, stdout, stderr }),
    );
  }
  inventory.finish(
    [...gaps].map(([reason, count]) => `${reason}: ${count} artifact records`),
  );
  return { execution, reports };
}
