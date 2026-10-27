/** Run only with actual retained component outputs; never fabricates VM/analyzer evidence. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { assembleEvidence } from "../workers/vetting/assembly";
import { indexSyscalls, syscallEvidence } from "../workers/vetting/events";

const [
  acquisitionDirectory,
  artifactDirectory,
  vmDirectory,
  outputDirectory,
  guestProfile,
  dependencyDirectory,
  dependencyFailureDirectory,
  provenanceDirectory,
] = process.argv.slice(2);
if (
  !acquisitionDirectory ||
  !artifactDirectory ||
  !vmDirectory ||
  !outputDirectory
)
  throw new Error(
    "usage: bun scripts/vetting-assembly-workflow.ts ACQUISITION ARTIFACT_REPORTS VM_OUTPUT PRIVATE_OUTPUT_PARENT [APPROVED_GUEST_PROFILE_OR_DASH] [DEPENDENCY_DIRECTORY] [FAILED_DEPENDENCY_DIRECTORY] [PROVENANCE_DIRECTORY]",
  );
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const artifactInventories = await Promise.all(
  (await readdir(join(acquisitionDirectory, "objects"))).map(
    async (sourceSha256) => {
      const path = join(artifactDirectory, `${sourceSha256}.json`);
      return { sourceSha256, path, sha256: digest(await readFile(path)) };
    },
  ),
);
const input = {
  acquisitionDirectory,
  queuedInputsSha256: digest(
    await readFile(join(acquisitionDirectory, "queued-inputs.json")),
  ),
  artifactInventories,
  vmEvidence: {
    directory: vmDirectory,
    sha256: digest(await readFile(join(vmDirectory, "evidence.json"))),
  },
  outputDirectory,
  provenanceEvidence: provenanceDirectory
    ? {
        directory: provenanceDirectory,
        reportSha256: digest(
          await readFile(join(provenanceDirectory, "report.json")),
        ),
      }
    : undefined,
  dependencyEvidence: dependencyDirectory
    ? {
        directory: dependencyDirectory,
        inventorySha256: digest(
          await readFile(join(dependencyDirectory, "inventory.json")),
        ),
        profileSha256: digest(
          await readFile(join(dependencyDirectory, "profile.json")),
        ),
      }
    : undefined,
  guestEvidence:
    guestProfile && guestProfile !== "-"
      ? {
          profilePath: guestProfile,
          profileSha256: digest(await readFile(guestProfile)),
          collectorSha256: digest(
            await readFile(
              new URL("../workers/vetting/guest.py", import.meta.url),
            ),
          ),
          receiptSha256: digest(
            await readFile(join(vmDirectory, "guest-source-evidence.json")),
          ),
        }
      : undefined,
};
const result = await assembleEvidence(input);
const manifestBytes = await readFile(join(result.directory, "manifest.json"));
const reviewBytes = await readFile(join(result.directory, "review-input.json"));
assert.equal(digest(manifestBytes), result.manifestSha256);
assert.equal(digest(reviewBytes), result.inputManifestSha256);
const manifest = JSON.parse(manifestBytes.toString());
const review = JSON.parse(reviewBytes.toString());
assert.equal(manifest.state, "incomplete");
assert.equal(manifest.providerCallsAuthorized, false);
assert.equal(manifest.publicationAuthorized, false);
assert(
  review.visibilityGaps.includes(
    input.guestEvidence
      ? "only-approved-harmless-fixture-command-executed"
      : "acquired-source-not-executed",
  ),
);
assert(review.visibilityGaps.includes("complete-collector-not-attached"));
if (input.guestEvidence) {
  const raw = await readFile(join(vmDirectory, "guest-events.log"));
  const guest = JSON.parse(
    (
      await readFile(join(vmDirectory, "guest-source-evidence.json"))
    ).toString(),
  );
  const vm = JSON.parse(
    (await readFile(join(vmDirectory, "evidence.json"))).toString(),
  );
  const context = {
    expectedSha256: guest.traceSha256,
    collectorExitCode: guest.exitCode,
    collectorTermination: guest.termination,
    vmTermination: vm.termination,
  };
  const indexed = indexSyscalls(raw, context);
  const structured = syscallEvidence(indexed);
  assert.equal(digest(structured.bytes), structured.indexSha256);
  assert.deepEqual(
    await readFile(join(result.directory, "syscall-index.json")),
    structured.bytes,
  );
  assert.equal(
    manifest.files.find(
      (file: { role: string }) => file.role === "syscall-index",
    ).sha256,
    structured.indexSha256,
  );
  assert.equal(
    review.items.find((item: { id: string }) => item.id === "syscall-review")
      .text,
    structured.review.toString("utf8"),
  );
  assert(structured.review.length <= 64 * 1024);
  const summary = JSON.parse(structured.review.toString());
  assert.equal(summary.indexSha256, structured.indexSha256);
  assert.equal(
    summary.omittedEvents,
    indexed.events.length - summary.events.length,
  );
  assert(
    summary.visibilityGaps.includes(
      "structured-index-not-fully-in-model-review",
    ),
  );
  assert.equal(indexed.state, "incomplete");
  assert.equal(indexed.kernelLostEventCount, null);
  assert.equal(indexed.publicationAuthorized, false);
  assert.equal(indexed.indexedBytes, raw.length);
  assert(indexed.events.some((event) => event.operation === "execve"));
  assert(indexed.events.some((event) => event.family === "file"));
  assert(indexed.events.some((event) => event.family === "memoryMap"));
  assert(indexed.childObservations.length > 0);
  let end = 0;
  for (const event of indexed.events) {
    assert.equal(event.spans[0].start, end);
    end = event.spans[0].end;
    assert(end <= raw.length);
    if (event.pairedOrdinal !== undefined) {
      const other = indexed.events[event.pairedOrdinal];
      assert.equal(other.pid, event.pid);
      assert.equal(other.operation, event.operation);
      assert.equal(other.pairedOrdinal, event.ordinal);
    }
  }
  assert.equal(end, raw.length);
  console.log(
    JSON.stringify({
      structuredTrace: {
        rawBytes: raw.length,
        events: indexed.events.length,
        privateIndexBytes: structured.bytes.length,
        reviewBytes: structured.review.length,
        state: "incomplete",
      },
    }),
  );
}
for (const item of review.items)
  assert.equal(digest(Buffer.from(item.text)), item.sha256);
if (provenanceDirectory && input.provenanceEvidence) {
  assert(
    manifest.files.some(
      (file: { role: string }) => file.role === "source-release-comparison",
    ),
  );
  const copy = await mkdtemp(join(outputDirectory, "provenance-negative-"));
  try {
    await cp(provenanceDirectory, copy, { recursive: true });
    await rm(join(copy, "release.tar"));
    await assert.rejects(
      assembleEvidence({
        ...input,
        provenanceEvidence: { ...input.provenanceEvidence, directory: copy },
      }),
    );
    await writeFile(join(copy, "release.tar"), "changed retained bytes");
    await assert.rejects(
      assembleEvidence({
        ...input,
        provenanceEvidence: { ...input.provenanceEvidence, directory: copy },
      }),
    );
  } finally {
    await rm(copy, { recursive: true, force: true });
  }
}
const before = (await readdir(outputDirectory)).sort();
let filesystemRefusals = 0;
if (input.dependencyEvidence) {
  assert(
    review.visibilityGaps.includes(
      "dependency-prefetch-is-not-runtime-proxy-coverage",
    ),
  );
  assert(
    review.visibilityGaps.includes("dependencies-not-authorized-for-execution"),
  );
  assert(
    manifest.files.some(
      (file: { role: string }) => file.role === "dependency-inventory",
    ),
  );
  const supplied = input.dependencyEvidence;
  for (const key of ["inventorySha256", "profileSha256"] as const)
    await assert.rejects(
      assembleEvidence({
        ...input,
        dependencyEvidence: { ...supplied, [key]: "0".repeat(64) },
      }),
    );
  // Start from real retained fetch outputs; corrupt the copies only.
  const tampered = await mkdtemp(join(outputDirectory, "dependency-negative-"));
  try {
    const copy = join(tampered, "fetch");
    await cp(supplied.directory, copy, { recursive: true });
    const inventoryPath = join(copy, "inventory.json");
    const inventory = JSON.parse((await readFile(inventoryPath)).toString());
    const object = join(copy, inventory.records[0].objectPath);
    await rm(object);
    await writeFile(object, "changed captured dependency");
    await assert.rejects(
      assembleEvidence({
        ...input,
        dependencyEvidence: { ...supplied, directory: copy },
      }),
    );
    await rm(copy, { recursive: true });
    await cp(supplied.directory, copy, { recursive: true });
    const inspection = join(copy, inventory.records[0].inspectionPath);
    await rm(inspection);
    await assert.rejects(
      assembleEvidence({
        ...input,
        dependencyEvidence: { ...supplied, directory: copy },
      }),
    );
    await rm(copy, { recursive: true });
    await cp(supplied.directory, copy, { recursive: true });
    inventory.sourceInventorySha256 = "0".repeat(64);
    const altered = Buffer.from(JSON.stringify(inventory));
    await rm(inventoryPath);
    await writeFile(inventoryPath, altered);
    await assert.rejects(
      assembleEvidence({
        ...input,
        dependencyEvidence: {
          ...supplied,
          directory: copy,
          inventorySha256: digest(altered),
        },
      }),
    );
    if (dependencyFailureDirectory) {
      const failure = await readFile(
        join(dependencyFailureDirectory, "failure.json"),
      );
      assert.equal(JSON.parse(failure.toString()).state, "incomplete");
      await assert.rejects(
        assembleEvidence({
          ...input,
          dependencyEvidence: {
            ...supplied,
            directory: dependencyFailureDirectory,
            inventorySha256: digest(failure),
          },
        }),
      );
    }
  } finally {
    await rm(tampered, { recursive: true, force: true });
  }
}
await assert.rejects(
  assembleEvidence({ ...input, queuedInputsSha256: "0".repeat(64) }),
);
if (input.guestEvidence) {
  const receipt = JSON.parse(
    await readFile(join(vmDirectory, "guest-source-evidence.json"), "utf8"),
  );
  if (receipt.filesystemSha256) {
    assert(
      review.visibilityGaps.includes(
        "captured-filesystem-artifacts-not-inspected-or-released",
      ),
    );
    assert(
      manifest.files.some((file: { role: string }) =>
        file.role.startsWith("captured-filesystem-object:"),
      ),
    );
    const negative = await mkdtemp(
      join(outputDirectory, "filesystem-negative-"),
    );
    try {
      const copy = join(negative, "vm");
      await cp(vmDirectory, copy, { recursive: true });
      const capture = JSON.parse(
        await readFile(join(copy, "guest-filesystem.json"), "utf8"),
      );
      const sha = Object.keys(capture.objects)[0];
      await rm(join(copy, `filesystem-object-${sha}`));
      await assert.rejects(
        assembleEvidence({
          ...input,
          vmEvidence: { ...input.vmEvidence, directory: copy },
        }),
      );
      await cp(
        join(vmDirectory, `filesystem-object-${sha}`),
        join(copy, `filesystem-object-${sha}`),
      );
      // Change a declared phase reference while retaining actual object bytes.
      // Rebind outer hashes so this specifically tests content-reference closure.
      for (const alteration of ["unknown", "missing"]) {
        if (alteration === "missing")
          delete capture.phases[1].entries[0].sha256;
        else capture.phases[1].entries[0].sha256 = "0".repeat(64);
        const captureBytes = Buffer.from(JSON.stringify(capture));
        const serial = await readFile(join(copy, "serial.log"), "utf8");
        const prefix = "SLOP_GUEST_EVIDENCE_V1:";
        const frameLine = serial
          .split("\n")
          .find((line) => line.startsWith(prefix));
        assert(frameLine);
        const frame = JSON.parse(
          Buffer.from(
            frameLine.slice(prefix.length).trim(),
            "base64",
          ).toString(),
        );
        frame.filesystem = captureBytes.toString();
        frame.filesystemSha256 = digest(captureBytes);
        const changedSerial = Buffer.from(
          serial.replace(
            frameLine,
            prefix + Buffer.from(JSON.stringify(frame)).toString("base64"),
          ),
        );
        const vm = JSON.parse(
          await readFile(join(copy, "evidence.json"), "utf8"),
        );
        vm.serialSha256 = digest(changedSerial);
        const vmBytes = Buffer.from(JSON.stringify(vm));
        const changedReceipt = {
          ...receipt,
          filesystemSha256: frame.filesystemSha256,
          serialSha256: vm.serialSha256,
          vmEvidenceSha256: digest(vmBytes),
        };
        const receiptBytes = Buffer.from(JSON.stringify(changedReceipt));
        for (const [name, body] of [
          ["guest-filesystem.json", captureBytes],
          ["serial.log", changedSerial],
          ["evidence.json", vmBytes],
          ["guest-source-evidence.json", receiptBytes],
        ] as const) {
          await rm(join(copy, name));
          await writeFile(join(copy, name), body);
        }
        await assert.rejects(
          assembleEvidence({
            ...input,
            vmEvidence: { directory: copy, sha256: digest(vmBytes) },
            guestEvidence: {
              ...input.guestEvidence,
              receiptSha256: digest(receiptBytes),
            },
          }),
          /Filesystem entry refers to missing content/,
        );
      }
      filesystemRefusals = 3;
    } finally {
      await rm(negative, { recursive: true, force: true });
    }
  }
  for (const key of [
    "profileSha256",
    "collectorSha256",
    "receiptSha256",
  ] as const) {
    await assert.rejects(
      assembleEvidence({
        ...input,
        guestEvidence: { ...input.guestEvidence, [key]: "0".repeat(64) },
      }),
    );
  }
  assert(
    review.visibilityGaps.includes(
      "guest-receipt-not-independent-kernel-or-host-proof",
    ),
  );
  assert(
    review.visibilityGaps.includes(
      "complete-interpreter-jit-memory-and-proxy-interception-not-proven",
    ),
  );
}
await assert.rejects(assembleEvidence({ ...input, artifactInventories: [] }));
await assert.rejects(
  assembleEvidence({
    ...input,
    artifactInventories: artifactInventories.map((entry, index) =>
      index ? entry : { ...entry, sha256: "0".repeat(64) },
    ),
  }),
);
await assert.rejects(
  assembleEvidence({
    ...input,
    vmEvidence: { ...input.vmEvidence, sha256: "0".repeat(64) },
  }),
);
assert.deepEqual((await readdir(outputDirectory)).sort(), before);
console.log(
  JSON.stringify({
    ...result,
    state: "incomplete",
    providerCalls: 0,
    publications: 0,
    rejectedCorruptOrMissingInputs:
      filesystemRefusals +
      (provenanceDirectory ? 2 : 0) +
      (input.guestEvidence ? 7 : 4) +
      (dependencyDirectory
        ? 5 + Number(Boolean(dependencyFailureDirectory))
        : 0),
  }),
);
