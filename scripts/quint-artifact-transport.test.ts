/** Generated retry trace runs through the actual artifact verifier transport. */
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("Quint artifact retry trace preserves origin credentials and terminal sibling verdict", async () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-artifact-quint-"));
  try {
    execFileSync(
      "node",
      [
        resolve("node_modules/@informalsystems/quint/dist/src/cli.js"),
        "test",
        "formal/models/artifact_transport.qnt",
        "--backend=typescript",
        "--seed=1",
        "--match=^transientRetryStartsAtAuthorityTest$",
        `--out-itf=${join(directory, "trace-{test}-{seq}.json")}`,
      ],
      { stdio: "pipe" },
    );
    const trace = JSON.parse(
      readFileSync(
        join(directory, "trace-transientRetryStartsAtAuthorityTest-0.json"),
        "utf8",
      ),
    ) as {
      states: { s: { calls: string[] } }[];
    };
    const { verifyReferencedArtifacts } = (await import(
      new URL("./pr-evidence-artifacts.mjs", import.meta.url).href
    )) as {
      verifyReferencedArtifacts(
        body: string,
        rows: { id: string; label: string }[],
        options: Record<string, unknown>,
      ): Promise<{
        ok: boolean;
        findings: { id: string; status: string; httpStatus?: number }[];
      }>;
    };
    const logUrl =
      "https://github.com/user-attachments/assets/11111111-1111-4111-8111-111111111111";
    const otherUrl =
      "https://github.com/user-attachments/assets/22222222-2222-4222-8222-222222222222";
    const cdn = "https://release-assets.githubusercontent.com/fixture/logs.txt";
    const calls: string[] = [];
    let cdnReads = 0;
    let terminalReads = 0;
    const result = await verifyReferencedArtifacts(
      `<!-- evidence-row:backend-logs -->\n[logs](${logUrl})\n\n<!-- evidence-row:domain-artifacts -->\n[artifact](${otherUrl})`,
      [
        { id: "backend-logs", label: "Logs" },
        { id: "domain-artifacts", label: "Artifact" },
      ],
      {
        token: "synthetic-test-token",
        concurrency: 1,
        transientRetries: 1,
        transientRetryDelayMs: 0,
        fetchImpl: async (
          url: string,
          options: { headers: Headers; redirect: string },
        ) => {
          expect(options.redirect).toBe("manual");
          if (url === otherUrl) {
            terminalReads += 1;
            return new Response("gone", { status: 404 });
          }
          if (url === logUrl) {
            expect(options.headers.get("Authorization")).toBe(
              "Bearer synthetic-test-token",
            );
            calls.push("github-token");
            return new Response(null, {
              status: 302,
              headers: { location: cdn },
            });
          }
          expect(url).toBe(cdn);
          expect(options.headers.has("Authorization")).toBe(false);
          calls.push("cdn-no-token");
          if (++cdnReads === 1)
            return new Response("unavailable", { status: 503 });
          return new Response(
            "INFO request GET /health status=200 complete\nINFO transaction verified at finalized head\nINFO workflow assertions passed without errors\n",
            { headers: { "content-type": "text/plain" } },
          );
        },
      },
    );
    const expectedCalls = trace.states.at(-1)?.s.calls;
    if (!expectedCalls)
      throw new Error("Quint omitted artifact transport calls");
    expect(calls).toEqual(expectedCalls);
    expect(terminalReads).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.findings).toMatchObject([
      { id: "backend-logs", status: "ok" },
      {
        id: "domain-artifacts",
        status: "artifact-http-error",
        httpStatus: 404,
      },
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
