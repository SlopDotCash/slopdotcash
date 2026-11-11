/** PRD 5/7: the real publication verifier must bind selected context bytes to
 * the immutable Git blob. The local HTTP server returns synthetic Git bytes,
 * never a model verdict or recorded provider output. */
import { expect, test } from "bun:test";
import {
  collect,
  fixture,
  policy,
  repository,
} from "../../tests/value-binary-fixture";
import { collectValueContext } from "./value-context";
import { verifyCurrentValueSource } from "./value-publication";
import { valueSourceDigest } from "./value-review";

for (const corrupt of [false, true]) {
  test(`publication ${corrupt ? "refuses changed bytes under" : "accepts bytes matching"} the claimed context blob`, async () => {
    const source = fixture({ direct: true, textOnly: true });
    const evidence = await collect(source);
    const path = "fix.ts";
    const ref = evidence.pull.head.sha;
    const entry = source.contents.get(`${path}?ref=${ref}`);
    if (!entry) throw new Error("Missing synthetic context fixture");
    const genuine = Buffer.from(entry.content, "base64").toString();
    const returned = corrupt ? genuine.replace("true", "evil") : genuine;
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname.endsWith(`/contents/${path}`))
          return Response.json({
            ...entry,
            content: Buffer.from(returned).toString("base64"),
          });
        return Response.json(
          await source.client.get(url.pathname + url.search),
        );
      },
    });
    try {
      const client = {
        ...source.client,
        async get<T>(requestPath: string): Promise<T | null> {
          const response = await fetch(new URL(requestPath, server.url));
          if (!response.ok)
            throw new Error(`Git fixture HTTP ${response.status}`);
          return (await response.json()) as T | null;
        },
      };
      // This is the retained input whose exact bytes an older collection
      // accepted. Checking only repeated API bytes must not bless the claim.
      const selected = {
        ...evidence,
        contextFiles: [
          {
            path,
            ref,
            blobSha: entry.sha,
            text: returned,
            url: `https://github.com/${repository.id}/blob/${ref}/${path}`,
          },
        ],
        evidenceUrls: [
          ...new Set([
            ...evidence.evidenceUrls,
            `https://github.com/${repository.id}/blob/${ref}/${path}`,
          ]),
        ],
      };
      const result = {
        policySha: policy.sha,
        sourceDigest: await valueSourceDigest(selected, policy),
      };
      if (corrupt) {
        await expect(
          verifyCurrentValueSource(client, selected, result, [repository]),
        ).rejects.toThrow("Complete context file unavailable");
        await expect(
          collectValueContext(client, evidence, [path]),
        ).rejects.toThrow("Complete context file unavailable");
      } else {
        const verified = await verifyCurrentValueSource(
          client,
          selected,
          result,
          [repository],
        );
        expect(verified.evidence.contextFiles).toEqual(selected.contextFiles);
      }
    } finally {
      await server.stop(true);
    }
  });
}
