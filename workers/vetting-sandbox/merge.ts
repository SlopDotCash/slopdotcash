import { WorkerEntrypoint } from "cloudflare:workers";
import { getSandbox } from "@cloudflare/sandbox";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { readBoundedJson } from "../../src/lib/browser-json";
import {
  MERGE_PROFILE,
  type ValueMergeInput,
  type ValueMergeVerifier,
} from "../slopbot/value-merge-profile";

/** Only Slopbot receives this named binding. There is no public fetch route. */
export class MergeVerifier
  extends WorkerEntrypoint<{ RUNNER: Parameters<typeof getSandbox>[0] }>
  implements ValueMergeVerifier
{
  async reconstruct(
    inputs: ValueMergeInput[],
    bundle: ReadableStream<Uint8Array>,
  ) {
    if (!Array.isArray(inputs) || !inputs.length)
      throw new Error("Merge reconstruction unavailable");
    const serialized = JSON.stringify(inputs);
    if (new TextEncoder().encode(serialized).length > 8 * 1024 * 1024)
      throw new Error("Merge reconstruction unavailable");
    const sandbox = getSandbox(this.env.RUNNER, crypto.randomUUID(), {
      transport: "rpc",
    });
    try {
      let bytes = 0;
      const hash = sha256.create();
      const stream = bundle.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            bytes += chunk.byteLength;
            if (bytes > 25 * 1024 * 1024) throw new Error("Merge bundle limit");
            hash.update(chunk);
            controller.enqueue(chunk);
          },
        }),
      );
      const written = await sandbox.writeFile("/analysis/merge.bundle", stream);
      if (!written.success || bytes === 0)
        throw new Error("Merge write refused");
      const input = await sandbox.writeFile(
        "/analysis/merge-input.json",
        JSON.stringify({
          profile: MERGE_PROFILE,
          inputs,
          bundleBytes: bytes,
          bundleSha256: bytesToHex(hash.digest()),
        }),
      );
      if (!input.success) throw new Error("Merge input refused");
      const setup = await sandbox.exec(
        "chmod 0444 /analysis/merge.bundle /analysis/merge-input.json",
        { timeout: 10_000 },
      );
      if (!setup.success) throw new Error("Merge setup refused");
      const executed = await sandbox.exec(
        "python3 /opt/slop/supervise.py merge",
        { timeout: 40_000 },
      );
      if (!executed.success) throw new Error("Merge supervisor refused");
      const status = JSON.parse(executed.stdout);
      if (
        status.status !== "exited" ||
        status.exitCode !== 0 ||
        status.outputComplete !== true
      )
        throw new Error("Merge reconstruction refused");
      const output = await sandbox.readFile(
        "/analysis/work/merge-result.json",
        { encoding: "none" },
      );
      const result = await readBoundedJson(
        new Response(output.content),
        8 * 1024 * 1024,
        "fixed merge result",
      );
      if (!Array.isArray(result) || result.length !== inputs.length)
        throw new Error("Merge result unavailable");
      return result as Awaited<ReturnType<ValueMergeVerifier["reconstruct"]>>;
    } catch {
      throw new Error("Merge reconstruction unavailable");
    } finally {
      // No journal write can occur until cleanup has acknowledged success.
      await sandbox.destroy();
    }
  }
}
